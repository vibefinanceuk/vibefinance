import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Invoice variance to order value, ranked by supplier — decision
 * 0421, one of the six remaining vertical slices of the Supplier
 * Performance screen (the design's own fifth bullet under "Key
 * metrics": *"built on the real `po.variance_pct` /
 * `po.line_variance_pct` fields already computed at match time"*).
 *
 * **Recomputed directly, not read from `po.variance_pct`.**
 * `po-matching.ts`'s own doc comment is explicit that those facts are
 * "recomputed at every evaluation, never stored" — a purchase order
 * can arrive after the invoice that references it, so a value
 * computed once and never revisited would be wrong for exactly the
 * invoices this matters for. Decision 0419 already made this same
 * call for "spend under management" rather than trust `po.matched`;
 * this route follows the identical reasoning and the identical join
 * — `invoice_headers` to `purchase_orders` on `json_extract(facts_json,
 * '$."BT-13"') = order_number` — then computes the same header-level
 * variance formula `po-matching.ts`'s own `variancePct()` uses:
 * `abs(invoice total − payable amount) / abs(payable amount) × 100`.
 *
 * **Header-level only.** Line-level variance would need every
 * invoice line matched to its own PO line — a real feature, but a
 * second join this slice does not need to answer "which suppliers'
 * invoices diverge from what was ordered."
 *
 * **Only invoices that actually resolve to a real purchase order
 * are counted** — the same "nothing to check against yet" exclusion
 * `computePoMatch` itself applies to an order named but never stored.
 * A supplier with no PO-matched invoices at all has no variance
 * figure to rank, not a 0% one.
 *
 * **Scoped the same way the rest of this screen already is.**
 */

interface VarianceRow {
  supplier_id: string;
  supplier_name: string;
  total_with_vat: number;
  payable_amount: number;
}

export interface SupplierPoVariance {
  supplierId: string;
  supplierName: string;
  averageVariancePct: number;
  invoiceCount: number;
}

export interface SupplierPoVarianceReport {
  suppliers: SupplierPoVariance[];
}

export async function handleSupplierPoVariance(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "sup.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.supplier_id AS supplier_id, sup.name AS supplier_name,
              h.total_with_vat AS total_with_vat, po.payable_amount AS payable_amount
       FROM invoice_headers h
       JOIN suppliers sup ON sup.id = h.supplier_id
       JOIN purchase_orders po ON po.order_number = json_extract(h.facts_json, '$."BT-13"')
       WHERE h.total_with_vat IS NOT NULL
         AND po.payable_amount IS NOT NULL AND po.payable_amount != 0 ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<VarianceRow>();

  if (rows.results.length === 0) return { status: 200, body: { suppliers: [] } satisfies SupplierPoVarianceReport };

  const bySupplier = new Map<string, { name: string; totalVariance: number; count: number }>();
  for (const row of rows.results) {
    const variancePct = (Math.abs(row.total_with_vat - row.payable_amount) / Math.abs(row.payable_amount)) * 100;
    const existing = bySupplier.get(row.supplier_id);
    if (existing) {
      existing.totalVariance += variancePct;
      existing.count += 1;
    } else {
      bySupplier.set(row.supplier_id, { name: row.supplier_name, totalVariance: variancePct, count: 1 });
    }
  }

  // **Highest variance first** — the same "problems surface first"
  // ordering already established for this screen's own cycle-time and
  // exception-rate reports.
  const suppliers: SupplierPoVariance[] = [...bySupplier.entries()]
    .map(([supplierId, s]) => ({
      supplierId,
      supplierName: s.name,
      averageVariancePct: s.totalVariance / s.count,
      invoiceCount: s.count,
    }))
    .sort((a, b) => b.averageVariancePct - a.averageVariancePct);

  return { status: 200, body: { suppliers } satisfies SupplierPoVarianceReport };
}
