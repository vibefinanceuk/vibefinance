import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Early-payment / discount eligibility by supplier — decision 0427,
 * the seventh of Supplier Performance's eight key metrics. `GET
 * /suppliers/discount-eligibility`.
 *
 * **Eligibility, not the design's own literal "capture rate" —
 * deliberately relabeled, not silently narrowed.** The design's own
 * bullet asks for a *capture* rate: whether a discount offered was
 * actually taken. That needs to know whether and when an invoice was
 * paid — payment-execution data this codebase has never captured
 * anywhere (the same gap already blocking three Liabilities & Accruals
 * metrics — see `docs/PROGRESS.md`'s own "Not built" section). Adding
 * `suppliers.discount_pct` / `.discount_days` (migration 0072) answers
 * a different, real question this system *can* answer honestly: which
 * invoices are, right now, still inside their supplier's own
 * early-payment window. Reported as eligibility throughout — in this
 * route, its own types, and the card built on it — never as "capture,"
 * because this system genuinely does not know whether any of them
 * were.
 *
 * **Excluded, not guessed, when a supplier's own terms are unknown.**
 * `discount_pct` and `discount_days` are both forward-looking only
 * (migration 0072's own note) — a supplier never reloaded since these
 * columns existed has `NULL` in both, and every one of its invoices is
 * excluded from this report entirely rather than assumed to carry no
 * offer.
 *
 * **The window is measured from the invoice's own issue date** —
 * `BT-2` is the earliest honest anchor this system has for "when the
 * clock the supplier's own offer runs against started," and is what
 * decision 0421's own payment-terms metric already anchors "terms
 * held" to for the same reason.
 *
 * **No process-stage filter.** This system has no record of when, or
 * whether, an invoice was actually paid (the same honesty this
 * codebase's own payment-terms route already states for a different
 * question) — so eligibility is reported for every invoice still
 * inside its own window, regardless of where it sits in the workflow,
 * rather than a stage this system cannot honestly connect to payment.
 *
 * **Never summed across currencies** — the same discipline every
 * monetary screen in this arc already follows.
 *
 * **Scoped the same way the rest of this screen already is.**
 */

interface EligibleRow {
  supplier_id: string;
  supplier_name: string;
  currency: string;
  total_with_vat: number;
  issue_date: string;
  discount_pct: number;
  discount_days: number;
}

export interface DiscountEligibilityEntity {
  supplierId: string;
  supplierName: string;
  discountPct: number;
  discountDays: number;
  invoiceCount: number;
  totalAmount: number;
  potentialDiscount: number;
}

export interface DiscountEligibilityByCurrency {
  currency: string;
  totalAmount: number;
  potentialDiscount: number;
  entities: DiscountEligibilityEntity[];
}

export interface DiscountEligibilityReport {
  currencies: DiscountEligibilityByCurrency[];
}

export async function handleSupplierDiscountEligibility(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "sup.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.supplier_id AS supplier_id, sup.name AS supplier_name, h.currency AS currency,
              h.total_with_vat AS total_with_vat, h.issue_date AS issue_date,
              sup.discount_pct AS discount_pct, sup.discount_days AS discount_days
       FROM invoice_headers h
       JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE sup.discount_pct IS NOT NULL AND sup.discount_days IS NOT NULL
         AND h.issue_date IS NOT NULL AND h.currency IS NOT NULL AND h.total_with_vat IS NOT NULL
         ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<EligibleRow>();

  const now = Date.now();
  const byCurrency = new Map<
    string,
    Map<string, { name: string; discountPct: number; discountDays: number; invoiceCount: number; totalAmount: number; potentialDiscount: number }>
  >();

  for (const row of rows.results) {
    const windowEnd = Date.parse(row.issue_date) + row.discount_days * 86_400_000;
    if (!Number.isFinite(windowEnd) || now > windowEnd) continue; // window has passed — no longer eligible, not counted

    if (!byCurrency.has(row.currency)) byCurrency.set(row.currency, new Map());
    const suppliers = byCurrency.get(row.currency)!;
    if (!suppliers.has(row.supplier_id)) {
      suppliers.set(row.supplier_id, {
        name: row.supplier_name,
        discountPct: row.discount_pct,
        discountDays: row.discount_days,
        invoiceCount: 0,
        totalAmount: 0,
        potentialDiscount: 0,
      });
    }
    const entry = suppliers.get(row.supplier_id)!;
    entry.invoiceCount += 1;
    entry.totalAmount += row.total_with_vat;
    entry.potentialDiscount += (row.total_with_vat * row.discount_pct) / 100;
  }

  const currencies: DiscountEligibilityByCurrency[] = [...byCurrency.entries()]
    .map(([currency, suppliers]) => {
      const entities: DiscountEligibilityEntity[] = [...suppliers.entries()]
        .map(([supplierId, s]) => ({
          supplierId,
          supplierName: s.name,
          discountPct: s.discountPct,
          discountDays: s.discountDays,
          invoiceCount: s.invoiceCount,
          totalAmount: s.totalAmount,
          potentialDiscount: s.potentialDiscount,
        }))
        // **Biggest opportunity first** — the design's own end-user
        // benefit for this metric names it directly: "discount capture
        // is money left on the table until someone notices it."
        .sort((a, b) => b.potentialDiscount - a.potentialDiscount);

      return {
        currency,
        totalAmount: entities.reduce((sum, e) => sum + e.totalAmount, 0),
        potentialDiscount: entities.reduce((sum, e) => sum + e.potentialDiscount, 0),
        entities,
      };
    })
    .sort((a, b) => b.potentialDiscount - a.potentialDiscount);

  return { status: 200, body: { currencies } satisfies DiscountEligibilityReport };
}
