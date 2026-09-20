import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Spend under management (with PO) vs. total spend — decision 0419,
 * Financial Performance's second real metric (the design's own fifth
 * bullet under Screen 4 — Liabilities & Accruals' key metrics: *"Spend
 * under management (with PO) vs. total spend"*). The design's own
 * consolidated catalog lists this report's *primary* screen as Screen
 * 5, the Multi-Enterprise CFO View ("Stat tile, % of total spend") —
 * but the design is explicit that such cross-references are
 * deliberate, several reports "legitimately belong on more than one
 * screen." Screen 5 does not exist yet (it needs a real multi-org
 * scoping concept this codebase does not have — unchanged since
 * decision 0417's own "What is not built"), so this is built here,
 * on Screen 4's own listing, exactly the "one real vertical slice"
 * discipline decisions 0415–0418 already followed; when Executive IQ
 * is eventually built, the design's own cross-linking assumption
 * would put this metric there too.
 *
 * **What "with PO" means, decided directly rather than assumed.** Not
 * `po.matched` (`po-matching.ts`) — that is a price/quantity-tolerance
 * verdict, recomputed fresh at rule evaluation, answering "does this
 * invoice's amount agree with its order." "Spend under management" is
 * a procurement-governance question instead: was this invoice backed
 * by a real purchase order at all, i.e. did it go through the
 * controlled PO process, regardless of whether the amounts later
 * agree within tolerance. So "with PO" here means the invoice's own
 * BT-13 (purchase order reference, read from `facts_json` — never a
 * new column, the same `json_extract` pattern `purchase-order-
 * route.ts`'s own `INVOICED_AMOUNTS_JOIN` already established for
 * this exact field) resolves to a real row in `purchase_orders`.
 *
 * **A referenced order that has not arrived here yet does not count**
 * — the same "nothing to check this invoice against yet" reasoning
 * `po-matching.ts`'s own header-level match already gives for a
 * different question. An order can land after the invoice that
 * references it (decision 0081), so this is a real, load-bearing
 * choice, not an edge case being waved away: an invoice naming an
 * order this system has not yet stored is, as far as this report is
 * concerned, not yet under management — the same way it is not yet
 * matched.
 *
 * **Scoped by the invoice's own org unit**, the same choice
 * `accruals-route.ts` already made for this tab — this is a report
 * about invoiced spend, not about orders, so the purchase order's own
 * org (always set, decision 0374) is not what gates visibility here.
 *
 * **Never summed across currencies**, the same discipline every
 * Financial Performance metric so far has followed: `total_with_vat`
 * has no FX-conversion concept anywhere in this codebase, so total
 * spend, with-PO spend, and the percentage between them are each
 * computed per currency, never blended.
 *
 * **Invoices missing a total or a currency are excluded**, not
 * counted as zero — the same reasoning decision 0416 and 0417 each
 * already gave.
 */

interface SpendRow {
  currency: string;
  total_with_vat: number;
  with_po: number;
}

export interface SpendUnderManagementCurrency {
  currency: string;
  totalSpend: number;
  totalCount: number;
  withPoSpend: number;
  withPoCount: number;
  percentWithPo: number;
}

export interface SpendUnderManagementReport {
  currencies: SpendUnderManagementCurrency[];
}

export async function handleSpendUnderManagement(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.currency AS currency, h.total_with_vat AS total_with_vat,
              CASE WHEN po.id IS NOT NULL THEN 1 ELSE 0 END AS with_po
       FROM invoice_headers h
       LEFT JOIN purchase_orders po ON po.order_number = json_extract(h.facts_json, '$."BT-13"')
       WHERE h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<SpendRow>();

  if (rows.results.length === 0) return { status: 200, body: { currencies: [] } satisfies SpendUnderManagementReport };

  const byCurrency = new Map<
    string,
    { totalSpend: number; totalCount: number; withPoSpend: number; withPoCount: number }
  >();
  for (const row of rows.results) {
    if (!byCurrency.has(row.currency)) {
      byCurrency.set(row.currency, { totalSpend: 0, totalCount: 0, withPoSpend: 0, withPoCount: 0 });
    }
    const bucket = byCurrency.get(row.currency)!;
    bucket.totalSpend += row.total_with_vat;
    bucket.totalCount += 1;
    if (row.with_po) {
      bucket.withPoSpend += row.total_with_vat;
      bucket.withPoCount += 1;
    }
  }

  // Currencies ordered by their own total spend, most significant
  // first — the same ordering `accruals-route.ts` and `supplier-
  // performance-route.ts` each already give their own currencies.
  const currencies: SpendUnderManagementCurrency[] = [...byCurrency.entries()]
    .map(([currency, bucket]) => ({
      currency,
      totalSpend: bucket.totalSpend,
      totalCount: bucket.totalCount,
      withPoSpend: bucket.withPoSpend,
      withPoCount: bucket.withPoCount,
      percentWithPo: bucket.totalSpend === 0 ? 0 : (bucket.withPoSpend / bucket.totalSpend) * 100,
    }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  return { status: 200, body: { currencies } satisfies SpendUnderManagementReport };
}
