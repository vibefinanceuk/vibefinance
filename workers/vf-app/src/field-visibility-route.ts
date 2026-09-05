import type { RouteResult } from "./org-route.js";
import {
  INVOICE_FIELDS,
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
  stageId: string | null
): Promise<ResolvedField[]> {
  const customerRows = await db
    .prepare("SELECT field, visibility, sort_order FROM field_visibility")
    .all<{ field: string; visibility: Visibility; sort_order: number }>();

  const customer = new Map(customerRows.results.map((r) => [r.field, r]));

  const stage = new Map<string, Visibility>();
  if (stageId) {
    const stageRows = await db
      .prepare("SELECT field, visibility FROM stage_field_visibility WHERE stage_id = ?")
      .bind(stageId)
      .all<{ field: string; visibility: Visibility }>();
    for (const row of stageRows.results) stage.set(row.field, row.visibility);
  }

  const resolved: ResolvedField[] = [];

  for (const field of INVOICE_FIELDS) {
    const configured = customer.get(field);
    let visibility: Visibility = configured?.visibility ?? DEFAULT_VISIBILITY[field] ?? UNCONFIGURED;
    let decidedBy: ResolvedField["decidedBy"] = configured ? "customer" : "default";

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

  // Configured order first, then the vocabulary's own — which follows
  // the specification, so an unconfigured screen reads in the order the
  // standard lists things.
  return resolved.sort((a, b) => a.sortOrder - b.sortOrder);
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
  stageId: string | null
): Promise<RouteResult> {
  const all = await resolveFieldVisibility(db, stageId);
  return {
    status: 200,
    body: {
      stageId,
      fields: all.filter((f) => f.visibility !== "hidden"),
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
