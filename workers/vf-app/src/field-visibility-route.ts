import type { RouteResult } from "./org-route.js";
import { resolveFieldVisibilityForStage } from "./unit-config.js";
import {
  INVOICE_FIELDS,
  DERIVED_FIELD_DESCRIPTIONS,
  FIELD_DESCRIPTIONS,
  INVOICE_FIELD_TYPES,
  INVOICE_LINE_FIELDS,
} from "@vibefinance/shared";

/**
 * Which fields a person sees, and what they may do with them —
 * decision 0114.
 *
 * The vocabulary now carries every mandatory term of an invoice
 * (decisions 0110, 0112). Putting all of them on a screen would be
 * unusable, and most are irrelevant to the person keying it.
 *
 * **Three states, not two.** The middle one is the point: BT-126 is a
 * line identifier somebody refers to when talking to a colleague and
 * never types, and hiding it entirely loses that.
 */
export type Visibility = "edit" | "read" | "hidden";

/**
 * What a field does when nobody has configured it.
 *
 * **Absence means the default**, so a customer who configures nothing
 * gets a working screen. The defaults are chosen from the standard
 * rather than invented: a term BIS Billing 3.0 marks mandatory is one
 * a person keying an unreadable document has to be able to supply.
 */
const DEFAULT_VISIBILITY: Record<string, Visibility> = {
  // Mandatory on the header, and what a person actually keys.
  "BT-1": "edit",
  "BT-2": "edit",
  "BT-5": "edit",
  "BT-31": "edit",
  "BT-106": "edit",
  "BT-109": "edit",
  "BT-110": "edit",
  "BT-112": "edit",
  "BT-115": "edit",
  // Mandatory on a line.
  "BT-129": "edit",
  "BT-130": "edit",
  "BT-131": "edit",
  "BT-146": "edit",
  "BT-153": "edit",
  "BT-151": "edit",

  // **Read, not hidden.** Identifiers and codes a person refers to and
  // does not type — the case that makes three states worth having.
  "BT-126": "read",
  "BT-24": "read",
  "BT-23": "read",

  /**
   * The parties — decision 0115.
   *
   * A seller and buyer panel showing two fields each would be a panel
   * not worth its heading, so the terms that identify a party are
   * visible by default. **Both sides treated alike**: the seller's VAT
   * identifier being editable while the buyer's was hidden was an
   * inconsistency nobody chose.
   *
   * `read` rather than `edit`, because these come from the document and
   * a person keying an unreadable one is far more likely to be
   * correcting an amount than a counterparty's country.
   */
  "BT-27": "read",
  "BT-34": "read",
  "BT-40": "read",
  "BT-44": "read",
  "BT-48": "read",
  "BT-49": "read",
  "BT-55": "read",
  "BT-10": "read",
};

/**
 * Everything else is hidden by default.
 *
 * The safer direction: a field nobody chose to show is one nobody has
 * to scan past. A customer who wants it says so, which is cheaper than
 * every customer hiding forty fields they never asked for.
 */
const UNCONFIGURED: Visibility = "hidden";

export interface ResolvedField {
  field: string;
  visibility: Visibility;
  /** What the field is, from the vocabulary's own description. */
  description: string;
  /**
   * `text`, `number`, `date` or `boolean` — so a screen renders the
   * right control without a second table of its own (decision 0041).
   */
  type: string;
  /**
   * Whether it belongs to a line rather than the header — BG-25.
   *
   * A property of the standard, so the interface groups by it instead
   * of keeping a list that would drift.
   */
  line: boolean;
  sortOrder: number;
  /**
   * Why it is what it is — `default`, `customer` or `stage`.
   *
   * A person asking "why can I not edit this" deserves an answer, and
   * "the Approval stage restricts it" is a different answer from
   * "nobody has configured it".
   */
  decidedBy: "default" | "customer" | "stage";
}

/**
 * The order the three sources are applied.
 *
 * A stage may only ever **restrict**. A customer setting a field to
 * `read` and a stage promoting it to `edit` would quietly undo a
 * control; a stage tightening `edit` to `read` is the approval case.
 *
 * `hidden` is stricter than `read`, which is stricter than `edit`.
 */
const STRICTNESS: Record<Visibility, number> = { edit: 0, read: 1, hidden: 2 };

export async function resolveFieldVisibility(
  db: D1Database,
  stageId: string | null,
  /**
   * Which unit is asking — decision 0197.
   *
   * **Optional, and absent means the group's answer**, which is what
   * every caller got before this existed. A caller that knows the
   * document's unit passes it; one that does not gets what it always
   * got.
   *
   * Decision 0192's risk lives here: omitting this does not fail, it
   * quietly returns the group's configuration. Which is why the walk is
   * in one place and this parameter is the only way to reach it.
   */
  unitId: string | null = null
): Promise<ResolvedField[]> {
  const customerRows = await db
    .prepare("SELECT field, visibility, sort_order FROM field_visibility")
    .all<{ field: string; visibility: Visibility; sort_order: number }>();

  const customer = new Map(customerRows.results.map((r) => [r.field, r]));

  const stage = new Map<string, Visibility>();
  /**
   * A stage that is read-only as a **property**, not as a list —
   * decision 0143.
   *
   * Decision 0114 let a stage restrict a field, and that is per field.
   * An approval stage is not per field: *"approvers should approve
   * data, not edit data"* is a statement about the stage.
   *
   * Expressed as a list it fails twice. Somebody has to name every
   * field — the operator named three header fields and no line fields,
   * so lines stayed editable and a Save button appeared on an approval
   * screen. And **a field added to the vocabulary next month is
   * editable there**, because a list cannot know about a field that did
   * not exist when it was written.
   *
   * The same shape decision 0107 records: a hand-maintained list
   * decays, and the fix is to derive rather than enumerate.
   */
  let stageIsReadOnly = false;

  if (stageId) {
    const stageRow = await db
      .prepare("SELECT read_only FROM process_stages WHERE id = ?")
      .bind(stageId)
      .first<{ read_only: number }>();
    stageIsReadOnly = stageRow?.read_only === 1;

    // The stage's own rows, plus whatever this unit overrides — one
    // walk, in `unit-config.ts`, and nowhere else (decision 0196).
    const resolved = await resolveFieldVisibilityForStage(db, stageId, unitId);
    for (const [field, visibility] of resolved) {
      stage.set(field, visibility as Visibility);
    }
  }

  const resolved: ResolvedField[] = [];

  for (const field of INVOICE_FIELDS) {
    const configured = customer.get(field);
    let visibility: Visibility = configured?.visibility ?? DEFAULT_VISIBILITY[field] ?? UNCONFIGURED;
    let decidedBy: ResolvedField["decidedBy"] = configured ? "customer" : "default";

    /**
     * **The stage's own answer, and it applies to everything** —
     * decision 0143.
     *
     * Still restrictive-only: a hidden field stays hidden, because a
     * stage may tighten and never loosen (decision 0114). This turns
     * `edit` into `read` and leaves the rest alone.
     */
    if (stageIsReadOnly && visibility === "edit") {
      visibility = "read";
      decidedBy = "stage";
    }

    const restriction = stage.get(field);
    if (restriction && STRICTNESS[restriction] > STRICTNESS[visibility]) {
      // Only when it is genuinely stricter. A stage saying `read` about
      // a field already hidden should not make it visible.
      visibility = restriction;
      decidedBy = "stage";
    }

    resolved.push({
      field,
      visibility,
      description: FIELD_DESCRIPTIONS[field] ?? field,
      type: INVOICE_FIELD_TYPES[field] ?? "text",
      line: INVOICE_LINE_FIELDS.includes(field),
      sortOrder: configured?.sort_order ?? 0,
      decidedBy,
    });
  }

  /**
   * A line's description — decision 0171.
   *
   * Stored under a plain `description` key rather than `BT-153`,
   * deliberately: decision 0052 refused to widen the closed vocabulary
   * *"purely to carry text no rule tests"*, and `invoice_lines` has its
   * own column for it.
   *
   * **That reasoning holds and its premise changed.** The operator
   * asked for it as a column, and the viewer renders only what this
   * resolver lists — so a description extracted from every line was
   * displayed on none of them.
   *
   * A **displayable field, not a vocabulary one**: no rule can test it,
   * and a person can read it.
   *
   * Read, not edit: keying refuses anything outside the closed
   * vocabulary (decision 0144), so an editable description would render
   * as a text box and fail on save — worse than not offering it.
   */
  resolved.push({
    field: "description",
    description: "Description",
    visibility: "read",
    type: "text",
    line: true,
    decidedBy: "default",
    sortOrder: 0,
  });

  /**
   * The order somebody reads a line in — decision 0171.
   *
   * Business Term order is **the standard's numbering, not a reading
   * order**: quantity before unit, line total before unit price, item
   * name last. The operator asked for the order an invoice prints:
   *
   * > Line No, Description, UOM, Unit Price, Quantity, Total Price.
   *
   * A field not named keeps its place after these, so adding one to the
   * vocabulary does not silently disappear.
   */
  const LINE_READING_ORDER = [
    "BT-126",
    "description",
    "BT-130",
    "BT-146",
    "BT-129",
    "BT-131",
  ];

  const linePlace = (field: string) => {
    const index = LINE_READING_ORDER.indexOf(field);
    return index === -1 ? LINE_READING_ORDER.length : index;
  };

  // Configured order first, then the vocabulary's own — which follows
  // the specification, so an unconfigured screen reads in the order the
  // standard lists things. Line fields are the exception, and say why
  // above.
  return resolved.sort((a, b) => {
    if (a.line && b.line) {
      const byReading = linePlace(a.field) - linePlace(b.field);
      if (byReading !== 0) return byReading;
    }
    return a.sortOrder - b.sortOrder;
  });
}

/**
 * What a screen asks for: the fields to show, at one stage.
 *
 * Hidden fields are **omitted rather than returned as hidden**. A
 * client that received them could render them by mistake, and there is
 * nothing a screen can do with a field it must not show.
 */
export async function handleFieldVisibility(
  db: D1Database,
  stageId: string | null,
  /**
   * Which unit is asking — decision 0198.
   *
   * **Decision 0197 left the screen behind the route.** The route
   * enforced a unit's overrides and this reported the group's answer,
   * so a French keyer saw an editable field and got a 403 on save.
   *
   * That is decision 0144 **inverted** — the route stricter than the
   * screen. Safe, and a trap: a person types into a box the system will
   * refuse.
   */
  unitId: string | null = null
): Promise<RouteResult> {
  const all = await resolveFieldVisibility(db, stageId, unitId);
  return {
    status: 200,
    body: {
      stageId,
      // Already in reading order: the resolver sorts (decision 0171).
      fields: all.filter((f) => f.visibility !== "hidden"),
      /**
       * What a derived field is called — decision 0159.
       *
       * **Not a visibility concern**, which is why they were absent:
       * the platform computes them and nobody keys them, so a screen
       * about what may be edited had no reason to mention them.
       *
       * A screen about **rules** does. `invoice.duplicate_confidence`
       * rendered raw beside `BT-112` reading *"total with VAT"*, and a
       * rule a customer cannot read is a rule they cannot confirm
       * (decision 0153).
       *
       * Carried here rather than on a route of their own, because a
       * screen that needs one needs both and a second call is a second
       * thing to fail.
       */
      derived: DERIVED_FIELD_DESCRIPTIONS,
    },
  };
}

/**
 * Setting the customer's baseline for one field.
 *
 * **Not `PUT /field-visibility/:field` with a body of one value**,
 * because configuring a screen is an act of arranging several fields
 * relative to each other, and a caller doing it one request at a time
 * cannot see the result until the last one lands.
 */
export async function handleSetFieldVisibility(
  db: D1Database,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const { fields } = body;
  if (!Array.isArray(fields) || fields.length === 0) {
    return { status: 400, body: { error: "fields (a non-empty array) is required" } };
  }

  const known = new Set<string>(INVOICE_FIELDS as readonly string[]);
  const rows: { field: string; visibility: Visibility; sortOrder: number }[] = [];

  for (const [index, raw] of fields.entries()) {
    const entry = raw as Record<string, unknown>;
    const field = entry.field;
    const visibility = entry.visibility;

    if (typeof field !== "string" || !known.has(field)) {
      // A field the vocabulary does not declare is one no document can
      // carry, so configuring it would produce a box nothing fills.
      return { status: 422, body: { error: `${String(field)} is not a field this system knows` } };
    }
    if (visibility !== "edit" && visibility !== "read" && visibility !== "hidden") {
      return { status: 422, body: { error: `${field}: visibility must be edit, read or hidden` } };
    }

    rows.push({
      field,
      visibility,
      // Position in the request, unless one is given — so a caller can
      // express order simply by listing fields in the order they want.
      sortOrder: typeof entry.sortOrder === "number" ? entry.sortOrder : index,
    });
  }

  await db.batch(
    rows.map((row) =>
      db
        .prepare(
          `INSERT INTO field_visibility (field, visibility, sort_order, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (field) DO UPDATE SET
             visibility = excluded.visibility,
             sort_order = excluded.sort_order,
             updated_at = excluded.updated_at`
        )
        .bind(row.field, row.visibility, row.sortOrder, new Date().toISOString())
    )
  );

  return { status: 200, body: { configured: rows.length } };
}

/**
 * A stage's restrictions.
 *
 * The schema refuses `edit` here, so this route cannot grant editing
 * however it is called — checked again for the caller's benefit rather
 * than relied upon.
 */
export async function handleSetStageFieldVisibility(
  db: D1Database,
  stageId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const stage = await db.prepare("SELECT id FROM process_stages WHERE id = ?").bind(stageId).first();
  if (!stage) {
    return { status: 404, body: { error: `stage ${stageId} does not exist` } };
  }

  const { fields } = body;
  if (!Array.isArray(fields)) {
    return { status: 400, body: { error: "fields (an array) is required" } };
  }

  const known = new Set<string>(INVOICE_FIELDS as readonly string[]);
  for (const raw of fields) {
    const entry = raw as Record<string, unknown>;
    if (typeof entry.field !== "string" || !known.has(entry.field)) {
      return { status: 422, body: { error: `${String(entry.field)} is not a field this system knows` } };
    }
    if (entry.visibility !== "read" && entry.visibility !== "hidden") {
      return {
        status: 422,
        body: {
          error: `${entry.field}: a stage may restrict to read or hidden, never grant edit`,
          detail:
            "a stage promoting a field to editable would undo a control the customer set — " +
            "remove the restriction instead",
        },
      };
    }
  }

  // Replaced wholesale, so removing a restriction is expressed by
  // leaving it out rather than by a separate delete.
  const statements = [
    db.prepare("DELETE FROM stage_field_visibility WHERE stage_id = ?").bind(stageId),
    ...fields.map((raw) => {
      const entry = raw as Record<string, unknown>;
      return db
        .prepare(
          "INSERT INTO stage_field_visibility (stage_id, field, visibility, updated_at) VALUES (?, ?, ?, ?)"
        )
        .bind(stageId, entry.field as string, entry.visibility as string, new Date().toISOString());
    }),
  ];

  await db.batch(statements);
  return { status: 200, body: { stageId, restrictions: fields.length } };
}

/**
 * Make a stage read-only, or not — decision 0143.
 *
 * **A property of the stage, not a list of fields.** Setting it covers
 * every field the vocabulary has and every one it grows, which a list
 * cannot: the operator listed three header fields and no line fields,
 * and a Save button appeared on an approval screen.
 */
export async function handleSetStageReadOnly(
  db: D1Database,
  stageId: string,
  readOnly: unknown
): Promise<RouteResult> {
  if (typeof readOnly !== "boolean") {
    return { status: 400, body: { error: "readOnly (true or false) is required" } };
  }

  const stage = await db
    .prepare("SELECT id, name FROM process_stages WHERE id = ?")
    .bind(stageId)
    .first<{ id: string; name: string }>();

  if (!stage) {
    return { status: 404, body: { error: `stage ${stageId} does not exist` } };
  }

  await db
    .prepare("UPDATE process_stages SET read_only = ? WHERE id = ?")
    .bind(readOnly ? 1 : 0, stageId)
    .run();

  // **What it actually did**, counted rather than asserted: a person
  // making a stage read-only wants to know it covered everything.
  const fields = await resolveFieldVisibility(db, stageId);

  return {
    status: 200,
    body: {
      stageId,
      readOnly,
      editableFields: fields.filter((f) => f.visibility === "edit").length,
      readOnlyFields: fields.filter((f) => f.visibility === "read").length,
    },
  };
}
