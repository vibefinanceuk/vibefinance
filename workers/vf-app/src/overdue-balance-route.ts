import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Overdue balance, by supplier and currency — decision 0430, built to
 * answer Screen 6's own worked example question directly: *"what's
 * our overdue balance with Acme this month."*
 *
 * **Not one of Screen 4's ("Liabilities & Accruals") own six named key
 * metrics** — checked directly against the design document before
 * building anything, since it would otherwise have been scope creep
 * onto a screen with its own already-settled metric list. It exists
 * solely to give the AP Assistant (decision 0430, Screen 6) a real,
 * reviewable, permission-scoped function to call for that one worked
 * example — not wired into the Financial Performance tab, and not a
 * new dashboard card.
 *
 * **"Overdue," honestly defined against data this system actually
 * has.** This codebase captures no payment-execution data anywhere —
 * confirmed directly, most recently while answering the operator's
 * own question about Peppol BIS Billing 3.0's payment fields — so
 * there is no way to know whether an invoice was genuinely paid late.
 * What it does have: `BT-9`, the supplier's own stated due date, and
 * `process_instances`' own live status. So an invoice counts as
 * overdue here when it is **still an accrual** — decision 0418's own
 * definition, reused exactly: `process_instances.status =
 * 'in_progress'` and not yet at that process's own final
 * ("payment-eligible") stage — **and** its `BT-9` due date has already
 * passed. That is an honest claim: *our own workflow has not yet
 * cleared this invoice, and the date the supplier expected payment by
 * is behind us.* It is deliberately not a claim about whether payment
 * itself happened late, which this system cannot see.
 *
 * **Grouped by `(supplier, currency)`**, the same discipline decision
 * 0416 established for supplier spend and decision 0417 for accruals:
 * `total_with_vat` has no cross-currency conversion anywhere in this
 * codebase, so a supplier billed in more than one currency gets one
 * figure per currency rather than one blended, untrustworthy total.
 * Scoped and permissioned exactly like the Accruals report it reuses
 * the definition from — `AP.Analysis`, intersected with
 * `unitsWherePermitted`, `unitClause` against the invoice's own org
 * unit.
 *
 * **Invoices missing a total, a currency, or a due date are excluded**,
 * not counted as zero or as not-overdue — the same reasoning every
 * other report in this codebase already gives: a fact this system
 * cannot read cannot be counted either way.
 */

interface OverdueRow {
  supplier_id: string | null;
  supplier_name: string | null;
  currency: string;
  total_with_vat: number;
  sequence: number;
  process_id: string;
  due_date: string | null;
}

interface MaxSequenceRow {
  process_id: string;
  max_seq: number;
}

export interface OverdueSupplier {
  supplierId: string | null;
  supplierName: string | null;
  currency: string;
  total: number;
  count: number;
}

export interface OverdueBalanceReport {
  suppliers: OverdueSupplier[];
}

export async function handleOverdueBalance(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string,
  now: Date = new Date()
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");
  const today = now.toISOString().slice(0, 10);

  const rows = await db
    .prepare(
      `SELECT h.supplier_id AS supplier_id,
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name,
              h.currency AS currency, h.total_with_vat AS total_with_vat,
              s.sequence AS sequence, s.process_id AS process_id,
              json_extract(h.facts_json, '$."BT-9"') AS due_date
       FROM process_instances pi
       JOIN process_stages s ON s.id = pi.current_stage_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       WHERE pi.status = 'in_progress'
         AND h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL
         AND json_extract(h.facts_json, '$."BT-9"') IS NOT NULL
         AND json_extract(h.facts_json, '$."BT-9"') < ?1 ${clause.sql}`
    )
    .bind(today, ...clause.binds)
    .all<OverdueRow>();

  if (rows.results.length === 0) return { status: 200, body: { suppliers: [] } satisfies OverdueBalanceReport };

  const processIds = [...new Set(rows.results.map((r) => r.process_id))];
  const placeholders = processIds.map(() => "?").join(", ");
  const maxSeqRows = await db
    .prepare(`SELECT process_id, max(sequence) AS max_seq FROM process_stages WHERE process_id IN (${placeholders}) GROUP BY process_id`)
    .bind(...processIds)
    .all<MaxSequenceRow>();
  const finalSequenceByProcess = new Map(maxSeqRows.results.map((r) => [r.process_id, r.max_seq]));

  // Same exclusion accruals-route.ts makes: an invoice at its own
  // process's last stage has reached payment-eligibility, so it is no
  // longer "not yet at the payment-eligible stage" regardless of date.
  const stillAccruing = rows.results.filter((row) => row.sequence !== finalSequenceByProcess.get(row.process_id));

  const bySupplier = new Map<string, OverdueSupplier>();
  for (const row of stillAccruing) {
    const key = `${row.supplier_id ?? "__unmatched__"}::${row.currency}`;
    const existing = bySupplier.get(key);
    if (existing) {
      existing.total += row.total_with_vat;
      existing.count += 1;
    } else {
      bySupplier.set(key, {
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        currency: row.currency,
        total: row.total_with_vat,
        count: 1,
      });
    }
  }

  const suppliers = [...bySupplier.values()].sort((a, b) => b.total - a.total);
  return { status: 200, body: { suppliers } satisfies OverdueBalanceReport };
}
