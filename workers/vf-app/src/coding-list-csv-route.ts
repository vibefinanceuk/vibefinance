import type { RouteResult } from "./org-route.js";
import { parseCsv } from "./load-suppliers.js";
import { declaredFiltersFor, handleCreateCodingListEntry, handleUpdateCodingListEntry } from "./coding-list-route.js";
import { handleCreateCostCentre } from "./cost-centre-route.js";
import { handleUpdateCostCentre } from "./ledger-route.js";

/**
 * CSV Template and Load for Account Coding — decision 0445.
 *
 * *"For Cost Center, Project, Commodity Code and General Ledger Code
 * we introduce a CSV Template, and Load CSV icons and capability,
 * similar to how we have done for Loading purchase orders."* Company
 * code is deliberately excluded — it is `org_units`, generated from
 * the org structure, confirmed directly with the operator rather than
 * assumed from decision 0444's own read-only treatment of it.
 *
 * **The exact same mechanism as `purchase-order-route.ts`'s own CSV
 * load** (decisions 0370/0373): one `GET .../csv-format` a screen
 * builds its own template from, one `POST .../csv-load` that refuses
 * per-row rather than per-file, and a `CsvFieldSpec[]` the parser and
 * the format response are both derived from — so the documentation can
 * never say something the parser does not actually accept.
 *
 * **One route, not four** — a single `:type` parameter the same way
 * `coding-list-route.ts`'s own `GET/POST /coding-lists/:type` already
 * works, except this type set includes `cost_centre` (which that route
 * does not: Cost Centre keeps its own table, per 0016/0444). Every row
 * is dispatched to whichever create/update handler already owns that
 * type's own storage and validation — `handleCreateCostCentre`/
 * `handleUpdateCostCentre` for Cost Centre, `handleCreateCodingListEntry`/
 * `handleUpdateCodingListEntry` for the other three — so a row loaded
 * via CSV is validated by exactly the same code a row entered by hand
 * already is, not a second copy of the same rules.
 *
 * **Full field replace per row, not merge — the same "the file is the
 * source of truth for what it manages" semantics `purchase-order-
 * route.ts`'s own CSV load already established**, implemented as an
 * update touching every field the file describes rather than PO's own
 * delete-and-reinsert, since these are single rows with no child lines
 * to replace underneath them. **Never destructive across rows**: an
 * id absent from this file is untouched, exactly like a purchase order
 * absent from a re-upload — this is reference data a person may also
 * still maintain by hand between loads (the operator's own words:
 * "manual changes this way will be minimal," not "never"), so a load
 * is never read as "delete everything else."
 *
 * **Two passes, so a file's own row order never matters for
 * hierarchy.** Phase one creates or updates every row's own fields
 * with no parent set (explicitly cleared, honouring "blank clears
 * it" even for a pre-existing parent); phase two then sets whatever
 * parent each row actually named, once every id in the file is
 * guaranteed to already exist — a child listed before its own parent
 * in the file loads correctly either way, and `handleUpdateCodingList
 * Entry`'s/`handleUpdateCostCentre`'s own existing cycle detection
 * still catches a genuine cycle, since it reads live database state at
 * the moment each phase-two row runs.
 *
 * **"Approver," not "Owner," in every column name** — matching
 * `coding-lists.js`'s own header comment: the operator's own example
 * exports use "Approver" for all five lists including Cost Centre.
 * Resolved to `cost_centres.owner_user_id` or
 * `coding_list_entries.approver_user_id` depending on type, same word
 * on screen and in the file either way.
 *
 * **Cost Centre's own two real differences from the other three,
 * confirmed directly with the operator rather than assumed:** it has
 * no `is_default` column at all (decision 0444's own migration never
 * added one) — a Default column value is silently ignored for this
 * type, not refused, the same "ignore what does not apply" choice the
 * operator picked directly; and its own name is immutable after
 * creation (`handleUpdateCostCentre` has never taken a `name` field) —
 * a re-loaded row whose file name disagrees with the stored name is
 * refused with that fact stated plainly, never silently dropped.
 */

const CSV_CODING_LIST_TYPES = ["cost_centre", "project", "commodity_code", "gl_code"] as const;
type CsvCodingListType = (typeof CSV_CODING_LIST_TYPES)[number];

function isCsvCodingListType(value: string): value is CsvCodingListType {
  return (CSV_CODING_LIST_TYPES as readonly string[]).includes(value);
}

export interface CodingListCsvFieldSpec {
  /** The internal key the parser uses — never shown to a person. */
  key: string;
  /** Every accepted spelling, lower-case, in order — the first is the recommended header for a template. */
  columns: string[];
  required: boolean;
  description: string;
}

const BASE_FIELD_SPECS: CodingListCsvFieldSpec[] = [
  {
    key: "id",
    columns: ["id"],
    required: true,
    description: "The list's own code for this entry — becomes its permanent identifier, and what Parent Entry ID and any \"Filter by\" column referencing this list points at.",
  },
  {
    key: "name",
    columns: ["name", "path"],
    required: true,
    description: "Display name. For Cost Centre only: set on creation and immutable afterwards — a later row that disagrees with the stored name is refused, not silently ignored.",
  },
  {
    key: "is_default",
    columns: ["default", "is default", "is_default"],
    required: false,
    description: "Y/N (also true/false, 1/0) — whether this is the default entry for the list. Not applicable to Cost Centre, which has no such concept; ignored there if present.",
  },
  {
    key: "approver_email",
    columns: ["approver", "approver email", "owner", "owner email"],
    required: false,
    description: "The approver's (Cost Centre: owner's) email address, matched against an existing person. Blank clears it.",
  },
  {
    key: "parent_entry_id",
    columns: ["parent entry id", "parent id", "parent"],
    required: false,
    description: "Another entry's own ID in this same list, for hierarchy. Blank clears it. May appear anywhere in the file relative to its own parent's own row.",
  },
];

const FILTER_LABELS: Record<string, string> = {
  company_code: "Company code",
  commodity_code: "Commodity Code",
};

function filterFieldSpec(filterListTypeId: string): CodingListCsvFieldSpec {
  const label = FILTER_LABELS[filterListTypeId] ?? filterListTypeId;
  return {
    key: `filter_${filterListTypeId}`,
    columns: [`filter by - ${label.toLowerCase()}`, `filter ${filterListTypeId.replace(/_/g, " ")}`, filterListTypeId.replace(/_/g, " ")],
    required: false,
    description: `${label}'s own ID, to scope this entry by ${label.toLowerCase()}. Blank clears it.`,
  };
}

async function fieldSpecsFor(db: D1Database, listType: CsvCodingListType): Promise<CodingListCsvFieldSpec[]> {
  const declared = await declaredFiltersFor(db, listType);
  return [...BASE_FIELD_SPECS, ...declared.map(filterFieldSpec)];
}

/** Every spec's own columns, lower-cased, mapped to its internal key — the same shape `purchase-order-route.ts`'s own `toColumnMap` already establishes. */
function toColumnMap(specs: CodingListCsvFieldSpec[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const spec of specs) {
    for (const column of spec.columns) map[column] = spec.key;
  }
  return map;
}

/**
 * The format itself, for a person preparing a file — mirrors
 * `handleGetPurchaseOrderCsvFormat`. Fields are declared once and
 * returned verbatim, so what a person sees here can never say
 * something `handleLoadCodingListCsv` does not actually accept.
 */
export async function handleGetCodingListCsvFormat(db: D1Database, listType: string): Promise<RouteResult> {
  if (!isCsvCodingListType(listType)) {
    return { status: 404, body: { error: `unknown coding list ${listType}` } };
  }
  const fields = await fieldSpecsFor(db, listType);
  return { status: 200, body: { listType, fields } };
}

function parseBoolean(raw: string): { ok: true; value: boolean } | { ok: false } {
  const v = raw.trim().toLowerCase();
  if (v === "") return { ok: true, value: false };
  if (["true", "yes", "y", "1"].includes(v)) return { ok: true, value: true };
  if (["false", "no", "n", "0"].includes(v)) return { ok: true, value: false };
  return { ok: false };
}

export interface CodingListCsvLoadResult {
  loadId: string;
  listType: string;
  entriesCreated: number;
  entriesUpdated: number;
  /**
   * Refused per row, never the whole file — decision 0162's argument,
   * the same one `purchase-order-route.ts`'s own CSV load and
   * `load-suppliers.ts`'s own loader already follow: a customer whose
   * export is half wrong should learn that from the load rather than
   * discover it one entry at a time.
   */
  refused: { id: string; reason: string }[];
}

export async function handleLoadCodingListCsv(db: D1Database, listType: string, csv: string): Promise<RouteResult> {
  if (!isCsvCodingListType(listType)) {
    return { status: 404, body: { error: `unknown coding list ${listType}` } };
  }

  const rows = parseCsv(csv);
  if (rows.length < 2) {
    return { status: 400, body: { error: "the file needs a header row and at least one entry", reason: "no_rows" } };
  }

  const declared = await declaredFiltersFor(db, listType);
  const specs = [...BASE_FIELD_SPECS, ...declared.map(filterFieldSpec)];
  const columnMap = toColumnMap(specs);
  const cols = rows[0].map((h) => columnMap[h.trim().toLowerCase()] ?? null);

  if (!cols.includes("id")) {
    return { status: 400, body: { error: "the file needs an id column", reason: "no_id_column" } };
  }
  if (!cols.includes("name")) {
    return { status: 400, body: { error: "the file needs a name column", reason: "no_name_column" } };
  }

  // One row per entry, keyed by id — refused whole-file if the same id
  // appears twice, rather than silently letting the last one win.
  const seenAtRow = new Map<string, number>();
  const parsedRows: { row: number; values: Record<string, string> }[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values: Record<string, string> = {};
    cols.forEach((col, idx) => {
      if (col) values[col] = (rows[i][idx] ?? "").trim();
    });
    if (!values.id) continue; // refused below, once every real row is known
    if (seenAtRow.has(values.id)) {
      return {
        status: 400,
        body: {
          error: `id "${values.id}" appears more than once, on rows ${seenAtRow.get(values.id)} and ${i + 1}`,
          reason: "duplicate_id",
        },
      };
    }
    seenAtRow.set(values.id, i + 1);
    parsedRows.push({ row: i + 1, values });
  }

  const loadId = crypto.randomUUID();
  const refused: { id: string; reason: string }[] = [];
  let entriesCreated = 0;
  let entriesUpdated = 0;
  // Which rows actually loaded in phase one, and whether they were new
  // — phase two only sets a parent for a row that survived phase one.
  const loaded = new Map<string, { row: number; values: Record<string, string> }>();

  // Phase one: every row's own fields, parent always cleared first —
  // see this file's own header comment for why.
  for (const { row, values } of parsedRows) {
    const id = values.id;
    const name = values.name;
    if (!name) {
      refused.push({ id, reason: "name is required" });
      continue;
    }

    let approverUserId: string | null = null;
    if (values.approver_email) {
      const person = await db
        .prepare("SELECT id FROM org_users WHERE email = ?")
        .bind(values.approver_email)
        .first<{ id: string }>();
      if (!person) {
        refused.push({
          id,
          reason: `${listType === "cost_centre" ? "owner" : "approver"} email ${values.approver_email} does not exist`,
        });
        continue;
      }
      approverUserId = person.id;
    }

    const filters: Record<string, string | null> = {};
    for (const filterListTypeId of declared) {
      filters[filterListTypeId] = values[`filter_${filterListTypeId}`] || null;
    }

    if (listType === "cost_centre") {
      const existing = await db.prepare("SELECT id, name FROM cost_centres WHERE id = ?").bind(id).first<{ id: string; name: string }>();
      if (!existing) {
        const createResult = await handleCreateCostCentre(db, { id, name });
        if (createResult.status !== 201) {
          refused.push({ id, reason: (createResult.body as { error?: string }).error ?? "could not create" });
          continue;
        }
      } else if (existing.name !== name) {
        // **Refused, not silently ignored** — a cost centre's own name
        // cannot be changed after creation (`handleUpdateCostCentre`
        // has no `name` field), so a file that disagrees with what is
        // stored needs to say so rather than pretend it applied.
        refused.push({
          id,
          reason: `cost centre name cannot be changed after creation (stored: "${existing.name}", file: "${name}")`,
        });
        continue;
      }
      const updateResult = await handleUpdateCostCentre(db, id, {
        ownerUserId: approverUserId,
        parentCostCentreId: null,
        filters,
      });
      if (updateResult.status !== 200) {
        refused.push({ id, reason: (updateResult.body as { error?: string }).error ?? "could not update" });
        continue;
      }
      loaded.set(id, { row, values });
      if (existing) entriesUpdated++;
      else entriesCreated++;
    } else {
      // Already known not to be cost_centre — the other branch of this
      // if/else handles that type entirely, which has no is_default
      // concept at all.
      const isDefaultResult = parseBoolean(values.is_default ?? "");
      if (!isDefaultResult.ok) {
        refused.push({ id, reason: `default must be true/false, yes/no, y/n, or 1/0 — got "${values.is_default}"` });
        continue;
      }

      const existing = await db
        .prepare("SELECT id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
        .bind(listType, id)
        .first();
      const body = { name, parentEntryId: null, isDefault: isDefaultResult.value, approverUserId, filters };
      const result = existing
        ? await handleUpdateCodingListEntry(db, listType, id, body)
        : await handleCreateCodingListEntry(db, listType, { id, ...body });
      if (existing ? result.status !== 200 : result.status !== 201) {
        refused.push({ id, reason: (result.body as { error?: string }).error ?? "could not save" });
        continue;
      }
      loaded.set(id, { row, values });
      if (existing) entriesUpdated++;
      else entriesCreated++;
    }
  }

  // Phase two: parents, now that every id in the file is guaranteed to
  // exist regardless of which order they appeared in.
  for (const [id, { values }] of loaded) {
    const parentEntryId = values.parent_entry_id;
    if (!parentEntryId) continue; // already cleared in phase one

    const result =
      listType === "cost_centre"
        ? await handleUpdateCostCentre(db, id, { parentCostCentreId: parentEntryId })
        : await handleUpdateCodingListEntry(db, listType, id, { parentEntryId });
    if (result.status !== 200) {
      refused.push({ id, reason: (result.body as { error?: string }).error ?? "could not set parent" });
    }
  }

  const body: CodingListCsvLoadResult = { loadId, listType, entriesCreated, entriesUpdated, refused };
  return { status: 200, body: { ...body } };
}
