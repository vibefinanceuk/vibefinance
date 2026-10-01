import type { RouteResult } from "./org-route.js";

/**
 * **Which business units a Destination sends for — decision 0587.**
 *
 * A large customer can run more than one ERP: one for its German
 * companies, another for the rest. Each Destination keeps the units it
 * covers (`route_instances.unit_ids`, a JSON list); a unit covers every
 * unit beneath it, so choosing "Acme Germany" takes its subsidiaries too.
 * None chosen is all units — and an invoice placed in no unit — as every
 * Destination did before.
 *
 * An invoice goes to each Destination that covers its unit. Rules at the
 * exit stage can add a Destination on top (0588).
 */

export function unitIdsOf(row: { unit_ids: string | null }): string[] | null {
  if (!row.unit_ids) return null;
  try {
    const list = JSON.parse(row.unit_ids) as unknown;
    return Array.isArray(list) && list.length > 0 ? list.map(String) : null;
  } catch {
    return null;
  }
}

/** The chosen units and every unit beneath them; null for all. */
export async function coveredUnits(db: D1Database, unitIds: string[] | null): Promise<Set<string> | null> {
  if (!unitIds || unitIds.length === 0) return null;
  const all = (await db.prepare("SELECT id, parent_unit_id FROM org_units").all<{ id: string; parent_unit_id: string | null }>()).results;
  const children = new Map<string, string[]>();
  for (const u of all) {
    if (!u.parent_unit_id) continue;
    children.set(u.parent_unit_id, [...(children.get(u.parent_unit_id) ?? []), u.id]);
  }
  const covered = new Set<string>();
  const queue = [...unitIds];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (covered.has(id)) continue;
    covered.add(id);
    queue.push(...(children.get(id) ?? []));
  }
  return covered;
}

export const covers = (covered: Set<string> | null, unitId: string | null) => covered === null || (unitId !== null && covered.has(unitId));

/** Each invoice's business unit, for the invoices asked about. */
export async function unitsOfInvoices(db: D1Database, invoiceIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (let i = 0; i < invoiceIds.length; i += 90) {
    const chunk = invoiceIds.slice(i, i + 90);
    const rows = (
      await db
        .prepare(`SELECT id, org_unit_id FROM invoice_headers WHERE id IN (${chunk.map(() => "?").join(", ")})`)
        .bind(...chunk)
        .all<{ id: string; org_unit_id: string | null }>()
    ).results;
    for (const r of rows) out.set(r.id, r.org_unit_id);
  }
  return out;
}

/** Which of these invoices a Destination with these units takes. */
export async function coveredInvoices(db: D1Database, unitIds: string[] | null, invoiceIds: string[]): Promise<string[]> {
  const covered = await coveredUnits(db, unitIds);
  if (covered === null) return invoiceIds;
  const units = await unitsOfInvoices(db, invoiceIds);
  return invoiceIds.filter((id) => covers(covered, units.get(id) ?? null));
}
