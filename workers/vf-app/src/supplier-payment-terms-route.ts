import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Payment terms held vs. negotiated, and on-time-payment rate by
 * supplier — decision 0421, one of the six remaining vertical slices
 * of the Supplier Performance screen (the design's own sixth bullet
 * under "Key metrics").
 *
 * **Negotiated terms, parsed narrowly and honestly.**
 * `suppliers.payment_terms` is free text (decision 0208: "terms are
 * what was agreed"; decision 0420's own investigation found no
 * structured discount or term field exists anywhere in this
 * codebase). Rather than build around that gap the way the parked
 * early-payment/discount metric would have needed to, this reads the
 * one pattern this project's own supplier data actually uses
 * consistently — `"Net <N>"` — and **excludes a supplier entirely**
 * when its own text does not match rather than guessing a number.
 * A supplier excluded here is a supplier whose negotiated term this
 * system cannot honestly compare against anything.
 *
 * **Terms "held" is the invoice's own due date minus its own issue
 * date** (`BT-9` − `BT-2`) — what this specific invoice actually
 * carried, in days, averaged per supplier — set against the
 * negotiated number above.
 *
 * **"On-time" means reaching payment-eligible on or before the
 * invoice's own due date — not literal ERP payment execution.**
 * VibeFinance is AP automation feeding an ERP (decision 0231); it has
 * no record of when a payment actually left the bank, only of when an
 * invoice became ready to pay. Decision 0418 already established
 * "reaching payment-eligible" as this system's own honest definition
 * of payment readiness for the accruals report; this metric reuses
 * that same definition rather than claiming knowledge of execution
 * this system does not have. Only invoices that have actually reached
 * payment-eligible are counted in the rate — one still in flight has
 * not yet been late or on time, it is merely not there yet.
 *
 * **Scoped the same way the rest of this screen already is.**
 */

interface ReachedRow {
  invoice_id: string;
  reached_at: string;
}

interface TermsRow {
  invoice_id: string;
  supplier_id: string;
  supplier_name: string;
  payment_terms: string | null;
  issue_date: string;
  due_date: string | null;
}

export interface SupplierPaymentTerms {
  supplierId: string;
  supplierName: string;
  negotiatedDays: number;
  averageHeldDays: number;
  onTimeRate: number | null;
  invoiceCount: number;
}

export interface SupplierPaymentTermsReport {
  suppliers: SupplierPaymentTerms[];
}

/** `"Net 30"`, `"net30"`, `"Net  45"` — the one format this project's own supplier data actually uses. Anything else is not guessed at. */
function parseNegotiatedDays(paymentTerms: string | null): number | undefined {
  if (!paymentTerms) return undefined;
  const match = /^\s*net\s*(\d+)\s*$/i.exec(paymentTerms);
  if (!match) return undefined;
  return Number(match[1]);
}

export async function handleSupplierPaymentTerms(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Supplier") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "sup.org_unit_id");

  const [reachedRows, termsRows] = await Promise.all([
    db
      .prepare(
        `SELECT h.id AS invoice_id, MIN(v.created_at) AS reached_at
         FROM process_instances pi
         JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
         JOIN suppliers sup ON sup.id = h.supplier_id
         JOIN process_stages ps ON ps.process_id = pi.process_id
         JOIN stage_visits v ON v.process_instance_id = pi.id AND v.stage_id = ps.id
         WHERE ps.sequence = (SELECT max(sequence) FROM process_stages WHERE process_id = pi.process_id) ${clause.sql}
         GROUP BY h.id`
      )
      .bind(...clause.binds)
      .all<ReachedRow>(),
    db
      .prepare(
        `SELECT h.id AS invoice_id, h.supplier_id AS supplier_id, sup.name AS supplier_name,
                sup.payment_terms AS payment_terms, h.issue_date AS issue_date,
                json_extract(h.facts_json, '$."BT-9"') AS due_date
         FROM invoice_headers h
         JOIN suppliers sup ON sup.id = h.supplier_id
         WHERE h.issue_date IS NOT NULL ${clause.sql}`
      )
      .bind(...clause.binds)
      .all<TermsRow>(),
  ]);

  const reachedAt = new Map(reachedRows.results.map((r) => [r.invoice_id, r.reached_at]));
  const negotiatedBySupplier = new Map<string, number | undefined>();

  const bySupplier = new Map<
    string,
    { name: string; negotiatedDays: number; totalHeldDays: number; heldCount: number; onTimeCount: number; onTimeDenominator: number }
  >();

  for (const row of termsRows.results) {
    if (!negotiatedBySupplier.has(row.supplier_id)) {
      negotiatedBySupplier.set(row.supplier_id, parseNegotiatedDays(row.payment_terms));
    }
    const negotiatedDays = negotiatedBySupplier.get(row.supplier_id);
    if (negotiatedDays === undefined) continue; // no comparable negotiated term — excluded, not guessed
    if (!row.due_date) continue; // no due date on this invoice — nothing to compare it against

    if (!bySupplier.has(row.supplier_id)) {
      bySupplier.set(row.supplier_id, {
        name: row.supplier_name,
        negotiatedDays,
        totalHeldDays: 0,
        heldCount: 0,
        onTimeCount: 0,
        onTimeDenominator: 0,
      });
    }
    const entry = bySupplier.get(row.supplier_id)!;

    const heldDays = (Date.parse(row.due_date) - Date.parse(row.issue_date)) / 86_400_000;
    if (Number.isFinite(heldDays)) {
      entry.totalHeldDays += heldDays;
      entry.heldCount += 1;
    }

    const reached = reachedAt.get(row.invoice_id);
    if (reached) {
      entry.onTimeDenominator += 1;
      // Compared as calendar dates (the first 10 characters of each,
      // both ISO-ordered so lexical comparison is date comparison) —
      // reaching payment-eligible at any time on the due date itself
      // is on time, not late by however many hours into that day it was.
      if (reached.slice(0, 10) <= row.due_date.slice(0, 10)) entry.onTimeCount += 1;
    }
  }

  const suppliers: SupplierPaymentTerms[] = [...bySupplier.entries()]
    .filter(([, s]) => s.heldCount > 0)
    .map(([supplierId, s]) => ({
      supplierId,
      supplierName: s.name,
      negotiatedDays: s.negotiatedDays,
      averageHeldDays: s.totalHeldDays / s.heldCount,
      onTimeRate: s.onTimeDenominator > 0 ? s.onTimeCount / s.onTimeDenominator : null,
      invoiceCount: s.heldCount,
    }))
    // **Furthest from the negotiated term first** — the same
    // "problems surface first" ordering the rest of this screen's own
    // new reports already give, applied here to the gap between held
    // and negotiated days.
    .sort((a, b) => Math.abs(b.averageHeldDays - b.negotiatedDays) - Math.abs(a.averageHeldDays - a.negotiatedDays));

  return { status: 200, body: { suppliers } satisfies SupplierPaymentTermsReport };
}
