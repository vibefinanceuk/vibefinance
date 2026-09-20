import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Potential duplicate invoices — decision 0420, the first vertical
 * slice of the Fraud Prevention tab (the design's own first bullet
 * under Screen 3 — Fraud & Risk Detection's key metrics: *"Potential
 * duplicate invoices — same supplier, same amount, same/near invoice
 * date. VibeFinance already computes this: the Dashboard's
 * possible_duplicates card reads a real duplicate_confidence column
 * today: this screen is a fuller, filterable view of data already
 * captured, not a new detection system."*
 *
 * **Not a new detection system, on purpose.** `duplicate_confidence`
 * (decision 0028) is computed and stored once, at the moment an
 * invoice is submitted, by `computeDuplicateConfidence()`
 * (`invoice-facts-route.ts`) — weighted matching on invoice number,
 * total, and issue date against every other invoice on file from the
 * same supplier. This route reads that same column, the same `>= 0.5`
 * threshold the Dashboard's own `possible_duplicates` card already
 * uses (`dashboard-route.ts`) — not a new or different bar, so a
 * customer does not see two disagreeing counts of "how many
 * duplicates" on two different screens.
 *
 * **A table, not a pair.** `duplicate_confidence` is a scalar on the
 * invoice that scored it — the specific invoice(s) it was scored
 * against are not themselves stored anywhere (`findSimilarInvoices()`
 * returns candidates for scoring, never persists the match). So this
 * is honestly "which invoices look like duplicates," sorted by how
 * confident that scoring was, the design's own suggested
 * visualization ("Table, sorted by confidence") — not "invoice A is a
 * duplicate of invoice B," which nothing in this schema can answer
 * today.
 *
 * **Gated on `AP.FraudReview`**, decision 0417's own reserved
 * permission — this is its first real consumer, the same "described
 * as unused" precedent `AP.Analysis` itself set before decision 0415.
 *
 * **Scoped by the invoice's own org unit**, the same choice every
 * other analysis route in this tab already makes.
 *
 * **Supplier name falls back to the document's own printed name**,
 * `COALESCE(sup.name, BT-27)` — the exact pattern `dashboard-route.ts`
 * and `documents-route.ts` already use — since an invoice flagged as a
 * possible duplicate has not necessarily matched a known supplier
 * record; `supplier_vat_id` (raw, as captured) is still returned
 * alongside for the case where even that fallback is absent.
 */

interface DuplicateRow {
  id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  supplier_vat_id: string | null;
  total_with_vat: number | null;
  currency: string | null;
  issue_date: string | null;
  duplicate_confidence: number;
}

export interface DuplicateInvoice {
  id: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  supplierVatId: string | null;
  totalWithVat: number | null;
  currency: string | null;
  issueDate: string | null;
  duplicateConfidence: number;
}

export interface PossibleDuplicatesReport {
  invoices: DuplicateInvoice[];
}

export async function handlePossibleDuplicates(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.FraudReview") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.id AS id, h.invoice_number AS invoice_number, h.supplier_vat_id AS supplier_vat_id,
              h.total_with_vat AS total_with_vat, h.currency AS currency, h.issue_date AS issue_date,
              h.duplicate_confidence AS duplicate_confidence,
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name
       FROM invoice_headers h
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE h.duplicate_confidence >= 0.5 ${clause.sql}
       ORDER BY h.duplicate_confidence DESC, h.issue_date DESC`
    )
    .bind(...clause.binds)
    .all<DuplicateRow>();

  const invoices: DuplicateInvoice[] = rows.results.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    supplierName: row.supplier_name,
    supplierVatId: row.supplier_vat_id,
    totalWithVat: row.total_with_vat,
    currency: row.currency,
    issueDate: row.issue_date,
    duplicateConfidence: row.duplicate_confidence,
  }));

  return { status: 200, body: { invoices } satisfies PossibleDuplicatesReport };
}
