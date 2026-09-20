import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Statistical outliers — decision 0424, Fraud Prevention's fourth real
 * metric (the design's own third bullet under Screen 3 — Fraud & Risk
 * Detection's key metrics: *"Statistical outliers — an invoice amount
 * well outside a supplier's own historical range."*).
 *
 * **A supplier's own history, same currency, invoice excluded from its
 * own baseline.** "Historical range" is computed from that supplier's
 * *other* priced invoices in the *same currency* — mixing currencies
 * would make a mean meaningless, and a candidate invoice pulling its
 * own mean toward itself would understate exactly the deviation this
 * metric exists to find.
 *
 * **No baseline without real history — excluded, not guessed.** Fewer
 * than `MIN_HISTORY` other same-currency invoices for a supplier means
 * there is no honest "historical range" yet; those invoices are
 * skipped entirely rather than measured against a mean of one or two
 * points, the same "exclude rather than fabricate" discipline decision
 * 0421's payment-terms route already applied to free-text parsing.
 *
 * **A z-score against a stated threshold, not a hidden judgment call.**
 * `|z| >= Z_SCORE_THRESHOLD` (2.5 standard deviations) is the one
 * number this route invents, named here so it can be argued with
 * rather than discovered by reading the query. When every historical
 * invoice for a supplier carries the identical amount (`stdDev === 0`)
 * a z-score is undefined, not zero or infinite by convention — a
 * candidate that still differs from that identical amount is flagged
 * with `zScore: null` (an unbounded deviation, reported honestly as
 * "undefined magnitude" rather than a fabricated number) and sorts
 * first; one that matches the identical amount is not an outlier at
 * all.
 *
 * **Only matched, priced invoices are eligible — no invented baseline
 * for an unmatched supplier.** `JOIN suppliers`, not `LEFT JOIN`: an
 * invoice with no matched supplier has no "supplier's own historical
 * range" to be outside of. (It may already be flagged by decision
 * 0422's own `/fraud/unapproved-suppliers` — a different risk, a
 * different route.)
 *
 * **Gated `AP.FraudReview`, scoped by the invoice's own org unit** —
 * the same gate and scoping column `fraud-duplicates-route.ts`
 * already established for this tab. The historical baseline is
 * computed from the same already-scoped rows as the candidates
 * themselves, not from a wider set the caller cannot otherwise see.
 *
 * **A worklist, not a top-N ranking** — the same shape
 * `/fraud/duplicates` and `/fraud/unapproved-suppliers` already use:
 * every invoice that clears the threshold is returned, sorted worst
 * first, with nothing capped.
 */

const Z_SCORE_THRESHOLD = 2.5;
const MIN_HISTORY = 5;

interface InvoiceRow {
  id: string;
  invoice_number: string | null;
  supplier_id: string;
  supplier_name: string | null;
  total_with_vat: number;
  currency: string;
  issue_date: string | null;
}

export interface StatisticalOutlierInvoice {
  id: string;
  invoiceNumber: string | null;
  supplierId: string;
  supplierName: string | null;
  totalWithVat: number;
  currency: string;
  issueDate: string | null;
  historicalMean: number;
  historicalStdDev: number;
  sampleSize: number;
  zScore: number | null;
}

export interface StatisticalOutliersReport {
  invoices: StatisticalOutlierInvoice[];
}

export async function handleStatisticalOutliers(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.FraudReview") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.id AS id, h.invoice_number AS invoice_number, h.supplier_id AS supplier_id,
              sup.name AS supplier_name, h.total_with_vat AS total_with_vat, h.currency AS currency,
              h.issue_date AS issue_date
       FROM invoice_headers h
       JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<InvoiceRow>();

  const groups = new Map<string, InvoiceRow[]>();
  for (const row of rows.results) {
    const key = `${row.supplier_id}::${row.currency}`;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  const outliers: StatisticalOutlierInvoice[] = [];
  for (const group of groups.values()) {
    for (const candidate of group) {
      const others = group.filter((r) => r.id !== candidate.id);
      if (others.length < MIN_HISTORY) continue;

      const mean = others.reduce((sum, r) => sum + r.total_with_vat, 0) / others.length;
      const variance = others.reduce((sum, r) => sum + (r.total_with_vat - mean) ** 2, 0) / others.length;
      const stdDev = Math.sqrt(variance);

      let zScore: number | null;
      if (stdDev === 0) {
        if (candidate.total_with_vat === mean) continue;
        zScore = null;
      } else {
        zScore = (candidate.total_with_vat - mean) / stdDev;
        if (Math.abs(zScore) < Z_SCORE_THRESHOLD) continue;
      }

      outliers.push({
        id: candidate.id,
        invoiceNumber: candidate.invoice_number,
        supplierId: candidate.supplier_id,
        supplierName: candidate.supplier_name,
        totalWithVat: candidate.total_with_vat,
        currency: candidate.currency,
        issueDate: candidate.issue_date,
        historicalMean: mean,
        historicalStdDev: stdDev,
        sampleSize: others.length,
        zScore,
      });
    }
  }

  outliers.sort((a, b) => {
    const av = a.zScore === null ? Number.POSITIVE_INFINITY : Math.abs(a.zScore);
    const bv = b.zScore === null ? Number.POSITIVE_INFINITY : Math.abs(b.zScore);
    return bv - av;
  });

  return { status: 200, body: { invoices: outliers } satisfies StatisticalOutliersReport };
}
