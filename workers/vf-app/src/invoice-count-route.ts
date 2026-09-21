import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * An exact count of invoices matching a date floor and/or a supplier
 * — decision 0430's third addendum, for the AP Assistant's own
 * `invoice_search` tool answering "how many."
 *
 * **Deliberately separate from `invoice_search`'s own list.** That
 * tool wraps `documents-route.ts`'s `handleListDocuments`, which is
 * capped at 50 rows and searches supplier text only over what was
 * already fetched — an honest limitation for browsing, but a real one
 * for counting: a "how many" answer built from a capped, in-memory-
 * filtered list would quietly undercount once more than 50 rows exist.
 * This runs one small, unbounded `COUNT(*)` instead, so "how many"
 * is always exact regardless of how many rows match.
 *
 * **A tighter supplier match than the Documents screen's own search**
 * — `LIKE` directly against `suppliers.name` (falling back to the raw
 * `BT-27` fact the same way `invoice-lookup-route.ts` already does),
 * not the generic multi-field `q` search `documents-route.ts` uses.
 * That is a deliberately narrower, SQL-provable match rather than a
 * force-fit of a search built for a different, broader purpose.
 *
 * Scoped by unit and chosen org exactly like `invoice_search` and the
 * real Documents screen — the same `AP.Review` permission, so this
 * can never count an invoice that screen itself would hide from the
 * person asking.
 */

export interface InvoiceCountReport {
  count: number;
}

export async function handleInvoiceCount(
  db: D1Database,
  currentOrg: string | null,
  userId: string,
  filters: { since?: string | null; supplier?: string | null }
): Promise<RouteResult> {
  const visible = await unitsWherePermitted(db, userId, "AP.Review");
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const since = filters.since ?? null;
  const supplierLike = filters.supplier ? `%${filters.supplier}%` : null;

  const row = await db
    .prepare(
      `SELECT count(*) AS n
       FROM invoice_headers h
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE (?1 IS NULL OR h.created_at >= ?1)
         AND (?2 IS NULL OR COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) LIKE ?2 COLLATE NOCASE)
         ${clause.sql}`
    )
    .bind(since, supplierLike, ...clause.binds)
    .first<{ n: number }>();

  return { status: 200, body: { count: row?.n ?? 0 } satisfies InvoiceCountReport };
}
