import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Unapproved-supplier invoices — decision 0422, the Fraud Prevention
 * tab's second real metric (the design's own second bullet under
 * Screen 3 — Fraud & Risk Detection's key metrics: *"Unapproved-
 * supplier invoices — an invoice referencing a supplier not on file,
 * or on hold."*).
 *
 * **Two different claims, one list.** "Not on file" and "on hold" are
 * not the same risk, and this route does not blur them into one flag
 * — `reason` says which, per invoice, so a reviewer is never left
 * guessing why a row is here.
 *
 * **"Not on file" is `invoice_headers.supplier_id IS NULL`.**
 * `matchSupplier()` (`match-supplier.ts`) is the only place a supplier
 * is ever named to an invoice, and `source-capture-route.ts` only sets
 * `supplier_id` when it returns one (`AND supplier_id IS NULL` in that
 * `UPDATE`, so the column stays null on every one of `matchSupplier()`'s
 * own three failure reasons — no identifier, no match, or an ambiguous
 * site — without this route needing to know which). A null column is
 * a fully reliable proxy for "this invoice names no supplier we
 * recognise," confirmed by reading that write path directly rather
 * than assumed from the column's name.
 *
 * **"On hold" is read live from `suppliers.on_hold`, not from the
 * frozen `supplier.onHold` fact `source-capture-route.ts` writes at
 * capture time.** Decision 0231 froze that fact on purpose, for
 * automated rule evaluation — *"an invoice is assessed against the
 * truth at the moment it arrived."* This is a different screen: a
 * reviewer looking at this list today needs to know whether a
 * supplier is on hold **today**, not what its status happened to be
 * when the document first arrived. A hold placed after capture (the
 * exact case fraud review exists to catch) would be invisible under
 * the frozen fact; a hold since lifted would keep flagging an invoice
 * with nothing left to review. Decision 0421's own hold-history
 * investigation already confirmed `on_hold` is current-state-only —
 * the live join reads that same current state honestly, rather than
 * pretending a history this schema does not have.
 *
 * **A supplier cannot be both** — `sup` is only non-null when
 * `supplier_id` matched, so `on_hold` is only ever `1` on a matched
 * row. `reason` is derived from that, not stored twice.
 *
 * **Gated on `AP.FraudReview`, scoped by the invoice's own org unit**
 * — the same gate and the same scoping column decision 0420's
 * `fraud-duplicates-route.ts` already established for this tab, and
 * the only one available here: an invoice with no matched supplier
 * has no `supplier_id`, so Supplier Performance's own supplier-org
 * scoping rule (decision 0416) cannot apply to every row this route
 * returns.
 *
 * **Supplier name falls back to the document's own printed name**,
 * the identical `COALESCE(sup.name, BT-27)` pattern `dashboard-
 * route.ts`, `documents-route.ts`, and `fraud-duplicates-route.ts`
 * already use — an unmatched invoice has no supplier row to name it
 * from.
 */

interface UnapprovedRow {
  id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  supplier_vat_id: string | null;
  total_with_vat: number | null;
  currency: string | null;
  issue_date: string | null;
  on_hold: number | null;
  hold_reason: string | null;
}

export interface UnapprovedSupplierInvoice {
  id: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  supplierVatId: string | null;
  totalWithVat: number | null;
  currency: string | null;
  issueDate: string | null;
  reason: "notonfile" | "onhold";
  holdReason: string | null;
}

export interface UnapprovedSuppliersReport {
  invoices: UnapprovedSupplierInvoice[];
}

export async function handleUnapprovedSuppliers(
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
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name,
              sup.on_hold AS on_hold, sup.hold_reason AS hold_reason
       FROM invoice_headers h
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE (h.supplier_id IS NULL OR sup.on_hold = 1) ${clause.sql}
       ORDER BY h.issue_date DESC`
    )
    .bind(...clause.binds)
    .all<UnapprovedRow>();

  const invoices: UnapprovedSupplierInvoice[] = rows.results.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    supplierName: row.supplier_name,
    supplierVatId: row.supplier_vat_id,
    totalWithVat: row.total_with_vat,
    currency: row.currency,
    issueDate: row.issue_date,
    reason: row.on_hold === 1 ? "onhold" : "notonfile",
    holdReason: row.on_hold === 1 ? row.hold_reason : null,
  }));

  return { status: 200, body: { invoices } satisfies UnapprovedSuppliersReport };
}
