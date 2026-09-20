import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Spend by supplier, ranked — decision 0416, the first vertical slice
 * of the Supplier Performance screen (the design's own second bullet
 * under "Key metrics": *"Spend by supplier, with a top-N ranking"*).
 *
 * **Scoped exactly the way the Suppliers screen already is** — the
 * design's own words: `AP.Supplier` intersected with
 * `unitsWherePermitted` (decision 0358), `unitClause` against the
 * *supplier's* own org unit (`s.org_unit_id`), not the invoice's. A
 * manager who cannot see a supplier on the Suppliers screen cannot see
 * what was spent with them here either — one scoping rule, not two.
 *
 * **Never summed across currencies.** `invoice_headers.total_with_vat`
 * has no base-currency or FX-conversion concept anywhere in this
 * codebase — every existing screen that shows a monetary figure shows
 * it paired with its own `currency` and never adds two together
 * (`dashboard-route.ts`'s `onMyClock`, for one). Real data here is
 * genuinely multi-currency (GBP, EUR and USD all appear in this
 * project's own test fixtures), so summing raw totals across a
 * supplier's invoices would silently produce a number with no honest
 * meaning the moment that supplier is billed in more than one
 * currency. Asked directly rather than picked unilaterally: **grouped
 * by `(supplier, currency)` instead** — a supplier billed in one
 * currency shows one figure, same as a simple sum would have read; a
 * supplier billed in several shows several, rather than one wrong one.
 *
 * **One ranked list per currency, not one merged list.** There is no
 * honest way to rank "top suppliers by spend" across currencies
 * without converting them, which this system does not do. Each
 * currency actually present in the scoped data gets its own top-`limit`
 * ranking instead — for the common case, a customer whose suppliers
 * all invoice in one currency, this reads as exactly the single simple
 * list the design asked for; a genuinely multi-currency customer gets
 * one list per currency rather than a blended number nobody could
 * trust.
 *
 * **Invoices missing a total or a currency are excluded**, not
 * counted as zero — an invoice this system cannot price cannot be
 * ranked by price, and folding it in as 0 would understate a
 * supplier's real spend rather than honestly omitting the figure.
 */
export async function handleSupplierSpend(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string,
  limit = 10
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "s.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT s.id AS supplier_id, s.name AS supplier_name, h.currency AS currency,
              sum(h.total_with_vat) AS spend, count(h.id) AS invoice_count
       FROM suppliers s
       JOIN invoice_headers h ON h.supplier_id = s.id
       WHERE h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL ${clause.sql}
       GROUP BY s.id, h.currency`
    )
    .bind(...clause.binds)
    .all<{ supplier_id: string; supplier_name: string; currency: string; spend: number; invoice_count: number }>();

  if (rows.results.length === 0) return { status: 200, body: { currencies: [] } };

  const byCurrency = new Map<
    string,
    { supplierId: string; supplierName: string; spend: number; invoiceCount: number }[]
  >();
  for (const row of rows.results) {
    if (!byCurrency.has(row.currency)) byCurrency.set(row.currency, []);
    byCurrency.get(row.currency)!.push({
      supplierId: row.supplier_id,
      supplierName: row.supplier_name,
      spend: row.spend,
      invoiceCount: row.invoice_count,
    });
  }

  // Currencies ordered by their own total spend, most significant
  // first — the same "biggest thing first" ordering `workload-route.ts`
  // already gives its own buckets, applied here to currencies instead.
  const currencies = [...byCurrency.entries()]
    .map(([currency, suppliers]) => ({
      currency,
      total: suppliers.reduce((sum, s) => sum + s.spend, 0),
      suppliers: suppliers.sort((a, b) => b.spend - a.spend).slice(0, limit),
    }))
    .sort((a, b) => b.total - a.total)
    .map(({ currency, suppliers }) => ({ currency, suppliers }));

  return { status: 200, body: { currencies } };
}
