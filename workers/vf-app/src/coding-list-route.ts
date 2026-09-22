import type { RouteResult } from "./org-route.js";

/**
 * Account Coding — decision 0444.
 *
 * *"Cost-Center Lists should be maintained under the Account Coding
 * tab, with other valid coding lists. This would include Company code
 * (Org), Cost-Center; Project, Commodity Code, General Ledger Code for
 * example."* Five example exports later, all five shared one shape —
 * see migration 0076's own header comment for the full reasoning. This
 * is the CRUD for the three genuinely greenfield lists this migration
 * added a real table for: Project, Commodity Code, and General Ledger
 * Code. Company code stays a read-only reference into `org_units`
 * (already fully managed via Access → Org Units); Cost Centre keeps
 * its own dedicated table and routes (`cost-centre-route.ts`,
 * `ledger-route.ts`) entirely unchanged, per 0016's own explicit
 * reasons not to merge it with `org_units` — its "Filter by company
 * code" support is added directly to `ledger-route.ts`'s own
 * `handleUpdateCostCentre`, reusing the exported helpers below rather
 * than duplicating them.
 *
 * **Manageable lists only** — the same declined scope decisions 0023/
 * 0024/0031 already established. Nothing here is wired into rule
 * validation, invoice-line capture, or BT-code mapping.
 */

export const CODING_LIST_TYPES = ["project", "commodity_code", "gl_code"] as const;
type CodingListType = (typeof CODING_LIST_TYPES)[number];

function isCodingListType(value: string): value is CodingListType {
  return (CODING_LIST_TYPES as readonly string[]).includes(value);
}

interface EntryRow {
  id: string;
  name: string;
  is_default: number;
  approver_user_id: string | null;
  approver_name: string | null;
  parent_entry_id: string | null;
  parent_name: string | null;
}

/**
 * **A filter value's own display name.** Resolved per type, since the
 * value lives in a different table depending which list it names — the
 * same reason `coding_list_entry_filters` (migration 0076) is not a
 * real foreign key. `company_code` resolves against `org_units`; every
 * other declared filter list resolves against this migration's own
 * `coding_list_entries`, keyed by its own type.
 *
 * Exported so Cost Centre's own filter rows here — owned under
 * `owner_list_type_id = 'cost_centre'`, without a Cost Centre's own
 * entries ever living in `coding_list_entries` — resolve the same way
 * rather than a second copy of this logic.
 */
export async function resolveFilterEntryName(
  db: D1Database,
  filterListTypeId: string,
  filterEntryId: string
): Promise<string | null> {
  if (filterListTypeId === "company_code") {
    const row = await db.prepare("SELECT name FROM org_units WHERE id = ?").bind(filterEntryId).first<{ name: string }>();
    return row?.name ?? null;
  }
  const row = await db
    .prepare("SELECT name FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
    .bind(filterListTypeId, filterEntryId)
    .first<{ name: string }>();
  return row?.name ?? null;
}

/** Whether a filter value actually exists. Same per-type resolution as above. */
export async function filterEntryExists(db: D1Database, filterListTypeId: string, filterEntryId: string): Promise<boolean> {
  if (filterListTypeId === "company_code") {
    const row = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(filterEntryId).first();
    return !!row;
  }
  const row = await db
    .prepare("SELECT id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
    .bind(filterListTypeId, filterEntryId)
    .first();
  return !!row;
}

/**
 * Which other list(s) declare themselves as this type's own
 * "Filter by" dimensions — `coding_list_type_filters`, read once
 * rather than hand-duplicated per type.
 */
export async function declaredFiltersFor(db: D1Database, listTypeId: string): Promise<string[]> {
  const rows = await db
    .prepare("SELECT filter_list_type_id FROM coding_list_type_filters WHERE list_type_id = ?")
    .bind(listTypeId)
    .all<{ filter_list_type_id: string }>();
  return rows.results.map((r) => r.filter_list_type_id);
}

/**
 * Validate and normalise an incoming `filters` object against what
 * this type actually declares — `{company_code: "UK01"}` for a type
 * that declares no such filter is rejected outright, the same
 * "closed vocabulary" discipline `handleUpdateApprovalConfig` already
 * applies to `mode`.
 */
export async function validateFilters(
  db: D1Database,
  ownerListTypeId: string,
  filters: unknown
): Promise<{ ok: true; value: Record<string, string> } | { ok: false; status: 400 | 404; error: string }> {
  if (filters === undefined) return { ok: true, value: {} };
  if (filters === null || typeof filters !== "object" || Array.isArray(filters)) {
    return { ok: false, status: 400, error: "filters must be an object" };
  }
  const declared = await declaredFiltersFor(db, ownerListTypeId);
  const value: Record<string, string> = {};
  for (const [filterListTypeId, filterEntryId] of Object.entries(filters as Record<string, unknown>)) {
    if (filterEntryId === null || filterEntryId === "") continue; // clearing that filter
    if (!declared.includes(filterListTypeId)) {
      return { ok: false, status: 400, error: `${ownerListTypeId} is not filtered by ${filterListTypeId}` };
    }
    if (typeof filterEntryId !== "string") {
      return { ok: false, status: 400, error: `filters.${filterListTypeId} must be a string` };
    }
    if (!(await filterEntryExists(db, filterListTypeId, filterEntryId))) {
      return { ok: false, status: 404, error: `${filterListTypeId} ${filterEntryId} does not exist` };
    }
    value[filterListTypeId] = filterEntryId;
  }
  return { ok: true, value };
}

/**
 * **Replace, not merge** — the same shape `modeForm`'s own doc comment
 * in `ap-setup.js` already establishes for this app's own config
 * forms: every existing filter row for this owner is deleted and the
 * caller's own set re-inserted, so clearing a filter means simply
 * leaving it out of the object.
 */
export async function replaceFilters(
  db: D1Database,
  ownerListTypeId: string,
  ownerEntryId: string,
  filters: Record<string, string>
): Promise<void> {
  await db
    .prepare("DELETE FROM coding_list_entry_filters WHERE owner_list_type_id = ? AND owner_entry_id = ?")
    .bind(ownerListTypeId, ownerEntryId)
    .run();
  for (const [filterListTypeId, filterEntryId] of Object.entries(filters)) {
    await db
      .prepare(
        `INSERT INTO coding_list_entry_filters (owner_list_type_id, owner_entry_id, filter_list_type_id, filter_entry_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(ownerListTypeId, ownerEntryId, filterListTypeId, filterEntryId)
      .run();
  }
}

export async function entryFiltersFor(
  db: D1Database,
  ownerListTypeId: string,
  ownerEntryId: string
): Promise<{ filterListTypeId: string; filterEntryId: string; filterEntryName: string | null }[]> {
  const rows = await db
    .prepare(
      "SELECT filter_list_type_id, filter_entry_id FROM coding_list_entry_filters WHERE owner_list_type_id = ? AND owner_entry_id = ?"
    )
    .bind(ownerListTypeId, ownerEntryId)
    .all<{ filter_list_type_id: string; filter_entry_id: string }>();
  return Promise.all(
    rows.results.map(async (r) => ({
      filterListTypeId: r.filter_list_type_id,
      filterEntryId: r.filter_entry_id,
      filterEntryName: await resolveFilterEntryName(db, r.filter_list_type_id, r.filter_entry_id),
    }))
  );
}

export async function handleListCodingListEntries(db: D1Database, listType: string): Promise<RouteResult> {
  if (!isCodingListType(listType)) {
    return { status: 404, body: { error: `unknown coding list ${listType}` } };
  }

  const rows = await db
    .prepare(
      `SELECT e.id, e.name, e.is_default, e.approver_user_id, a.name AS approver_name,
              e.parent_entry_id, p.name AS parent_name
       FROM coding_list_entries e
       LEFT JOIN org_users a ON a.id = e.approver_user_id
       LEFT JOIN coding_list_entries p ON p.list_type_id = e.list_type_id AND p.id = e.parent_entry_id
       WHERE e.list_type_id = ?
       ORDER BY e.name`
    )
    .bind(listType)
    .all<EntryRow>();

  const entries = await Promise.all(
    rows.results.map(async (r) => ({
      id: r.id,
      name: r.name,
      isDefault: !!r.is_default,
      approverUserId: r.approver_user_id,
      approverName: r.approver_name,
      parentEntryId: r.parent_entry_id,
      parentName: r.parent_name,
      filters: await entryFiltersFor(db, listType, r.id),
    }))
  );

  return {
    status: 200,
    body: { listType, declaredFilters: await declaredFiltersFor(db, listType), entries },
  };
}

interface EntryBody {
  id?: unknown;
  name?: unknown;
  parentEntryId?: unknown;
  isDefault?: unknown;
  approverUserId?: unknown;
  filters?: unknown;
}

/**
 * Walk an entry's own would-be parent chain — the same "walk until it
 * runs out or repeats" shape `resolveApprovalChain` already uses, here
 * to refuse a parent assignment that would create a cycle rather than
 * merely refusing the immediate self-parent case.
 */
async function wouldCycle(db: D1Database, listType: string, entryId: string, parentEntryId: string): Promise<boolean> {
  let current: string | null = parentEntryId;
  const seen = new Set<string>();
  while (current) {
    if (current === entryId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    const row = await db
      .prepare("SELECT parent_entry_id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
      .bind(listType, current)
      .first<{ parent_entry_id: string | null }>();
    current = row?.parent_entry_id ?? null;
  }
  return false;
}

export async function handleCreateCodingListEntry(db: D1Database, listType: string, body: EntryBody): Promise<RouteResult> {
  if (!isCodingListType(listType)) {
    return { status: 404, body: { error: `unknown coding list ${listType}` } };
  }

  const { id, name } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }

  const existing = await db
    .prepare("SELECT id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
    .bind(listType, id)
    .first();
  if (existing) {
    return { status: 409, body: { error: `${listType} ${id} already exists` } };
  }

  const parentEntryId = body.parentEntryId;
  if (parentEntryId !== undefined && parentEntryId !== null && parentEntryId !== "") {
    if (typeof parentEntryId !== "string") {
      return { status: 400, body: { error: "parentEntryId must be a string, or null" } };
    }
    if (parentEntryId === id) {
      return { status: 409, body: { error: `a ${listType} cannot be its own parent` } };
    }
    const parent = await db
      .prepare("SELECT id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
      .bind(listType, parentEntryId)
      .first();
    if (!parent) return { status: 404, body: { error: `${listType} ${parentEntryId} does not exist` } };
  }

  const approverUserId = body.approverUserId;
  if (approverUserId !== undefined && approverUserId !== null && approverUserId !== "") {
    if (typeof approverUserId !== "string") {
      return { status: 400, body: { error: "approverUserId must be a string, or null" } };
    }
    const approver = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(approverUserId).first();
    if (!approver) return { status: 404, body: { error: `user ${approverUserId} does not exist` } };
  }

  const filtersResult = await validateFilters(db, listType, body.filters);
  if (!filtersResult.ok) return { status: filtersResult.status, body: { error: filtersResult.error } };

  await db
    .prepare(
      `INSERT INTO coding_list_entries (list_type_id, id, name, is_default, approver_user_id, parent_entry_id)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(listType, id, name, body.isDefault ? 1 : 0, (approverUserId as string) || null, (parentEntryId as string) || null)
    .run();

  await replaceFilters(db, listType, id, filtersResult.value);

  return { status: 201, body: { listType, id, name } };
}

export async function handleUpdateCodingListEntry(
  db: D1Database,
  listType: string,
  entryId: string,
  body: EntryBody
): Promise<RouteResult> {
  if (!isCodingListType(listType)) {
    return { status: 404, body: { error: `unknown coding list ${listType}` } };
  }

  const existing = await db
    .prepare("SELECT id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
    .bind(listType, entryId)
    .first();
  if (!existing) return { status: 404, body: { error: `${listType} ${entryId} does not exist` } };

  const hasAnyField =
    "name" in body || "parentEntryId" in body || "approverUserId" in body || "isDefault" in body || "filters" in body;
  if (!hasAnyField) return { status: 400, body: { error: "nothing to change" } };

  const name = "name" in body ? body.name : undefined;
  if (name !== undefined && (typeof name !== "string" || !name)) {
    return { status: 400, body: { error: "name, if provided, must be a non-empty string" } };
  }

  const parentEntryId = "parentEntryId" in body ? body.parentEntryId : undefined;
  if (parentEntryId !== undefined && parentEntryId !== null) {
    if (typeof parentEntryId !== "string" || !parentEntryId) {
      return { status: 400, body: { error: "parentEntryId must be a string, or null" } };
    }
    if (parentEntryId === entryId) {
      return { status: 409, body: { error: `a ${listType} cannot be its own parent` } };
    }
    const parent = await db
      .prepare("SELECT id FROM coding_list_entries WHERE list_type_id = ? AND id = ?")
      .bind(listType, parentEntryId)
      .first();
    if (!parent) return { status: 404, body: { error: `${listType} ${parentEntryId} does not exist` } };
    if (await wouldCycle(db, listType, entryId, parentEntryId)) {
      return { status: 409, body: { error: "that parent would create a cycle" } };
    }
  }

  const approverUserId = "approverUserId" in body ? body.approverUserId : undefined;
  if (approverUserId !== undefined && approverUserId !== null) {
    if (typeof approverUserId !== "string" || !approverUserId) {
      return { status: 400, body: { error: "approverUserId must be a string, or null" } };
    }
    const approver = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(approverUserId).first();
    if (!approver) return { status: 404, body: { error: `user ${approverUserId} does not exist` } };
  }

  const isDefault = "isDefault" in body ? body.isDefault : undefined;

  const sets: string[] = [];
  const values: unknown[] = [];
  if (name !== undefined) {
    sets.push("name = ?");
    values.push(name);
  }
  if (parentEntryId !== undefined) {
    sets.push("parent_entry_id = ?");
    values.push(parentEntryId);
  }
  if (approverUserId !== undefined) {
    sets.push("approver_user_id = ?");
    values.push(approverUserId);
  }
  if (isDefault !== undefined) {
    sets.push("is_default = ?");
    values.push(isDefault ? 1 : 0);
  }

  if (sets.length > 0) {
    await db
      .prepare(`UPDATE coding_list_entries SET ${sets.join(", ")} WHERE list_type_id = ? AND id = ?`)
      .bind(...values, listType, entryId)
      .run();
  }

  if ("filters" in body) {
    const filtersResult = await validateFilters(db, listType, body.filters);
    if (!filtersResult.ok) return { status: filtersResult.status, body: { error: filtersResult.error } };
    await replaceFilters(db, listType, entryId, filtersResult.value);
  }

  return { status: 200, body: { listType, id: entryId } };
}
