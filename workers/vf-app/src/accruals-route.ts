import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * The accruals report — decision 0417's own follow-on, the first
 * vertical slice of the Financial Performance tab (the design's own
 * "Screen 4 — Liabilities & Accruals," first of its six key metrics:
 * *"Accruals report — invoices received but not yet at the
 * payment-eligible stage (the final stage of VibeFinance's real
 * 7-stage AP process), the natural definition of a liability not yet
 * settled."*
 *
 * **What counts as an accrual.** An invoice whose process instance is
 * still in flight (`process_instances.status = 'in_progress'` —
 * `workflow-engine.ts` only ever sets `'completed'` once an instance
 * has advanced past its own last stage, the same status
 * `dashboard-route.ts`'s own `whereThingsAre()` already filters on)
 * **and** whose current stage is not that process's own final one.
 * The final stage — "payment-eligible" in the design's own words — is
 * computed per process from `process_stages.sequence`, the same
 * `MAX(sequence)` concept `workload-route.ts`'s own
 * `totalStagesByProcess` already reads for a different reason; an
 * invoice sitting there has reached readiness to pay, so it has
 * stopped being merely accrued.
 *
 * **Scoped and never summed across currencies, the same discipline
 * decision 0416 established.** `AP.Analysis`, the same permission
 * Workload and the rest of Financial Performance already check,
 * intersected with `unitsWherePermitted` and `unitClause` against the
 * invoice's own org unit. `total_with_vat` has no base-currency or
 * FX-conversion concept anywhere in this codebase, so a liability
 * figure is grouped by `(currency, stage)` rather than blended —
 * every currency actually present in the scoped, still-accruing data
 * gets its own total and its own stage breakdown, ordered by process
 * sequence (the design's own "table broken out by stage," read in the
 * order the money moves through the process, not ranked by size).
 *
 * **Invoices missing a total or a currency are excluded**, not
 * counted as zero — the same reasoning decision 0416 already gave: an
 * invoice this system cannot price cannot be counted as a liability
 * of any particular size.
 */

interface AccrualRow {
  stage_id: string;
  stage_name: string;
  sequence: number;
  process_id: string;
  currency: string;
  total_with_vat: number;
}

interface MaxSequenceRow {
  process_id: string;
  max_seq: number;
}

export interface AccrualStage {
  stageId: string;
  stageName: string;
  total: number;
  count: number;
}

export interface AccrualCurrency {
  currency: string;
  total: number;
  stages: AccrualStage[];
}

export interface AccrualsReport {
  currencies: AccrualCurrency[];
}

export async function handleAccruals(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT s.id AS stage_id, s.name AS stage_name, s.sequence, s.process_id,
              h.currency AS currency, h.total_with_vat AS total_with_vat
       FROM process_instances pi
       JOIN process_stages s ON s.id = pi.current_stage_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE pi.status = 'in_progress'
         AND h.total_with_vat IS NOT NULL AND h.currency IS NOT NULL ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<AccrualRow>();

  if (rows.results.length === 0) return { status: 200, body: { currencies: [] } satisfies AccrualsReport };

  const processIds = [...new Set(rows.results.map((r) => r.process_id))];
  const placeholders = processIds.map(() => "?").join(", ");
  const maxSeqRows = await db
    .prepare(`SELECT process_id, max(sequence) AS max_seq FROM process_stages WHERE process_id IN (${placeholders}) GROUP BY process_id`)
    .bind(...processIds)
    .all<MaxSequenceRow>();
  const finalSequenceByProcess = new Map(maxSeqRows.results.map((r) => [r.process_id, r.max_seq]));

  // **The final stage is excluded, not merely deprioritised.** An
  // invoice sitting at its own process's last stage has reached
  // payment-eligibility, so it is no longer "not yet at the
  // payment-eligible stage" — the design's own accrual definition.
  const accruing = rows.results.filter((row) => row.sequence !== finalSequenceByProcess.get(row.process_id));

  const byCurrency = new Map<string, Map<string, { stageName: string; sequence: number; total: number; count: number }>>();
  for (const row of accruing) {
    if (!byCurrency.has(row.currency)) byCurrency.set(row.currency, new Map());
    const stages = byCurrency.get(row.currency)!;
    const existing = stages.get(row.stage_id);
    if (existing) {
      existing.total += row.total_with_vat;
      existing.count += 1;
    } else {
      stages.set(row.stage_id, { stageName: row.stage_name, sequence: row.sequence, total: row.total_with_vat, count: 1 });
    }
  }

  const currencies: AccrualCurrency[] = [...byCurrency.entries()]
    .map(([currency, stages]) => {
      const stageList = [...stages.entries()]
        .sort((a, b) => a[1].sequence - b[1].sequence)
        .map(([stageId, s]) => ({ stageId, stageName: s.stageName, total: s.total, count: s.count }));
      return {
        currency,
        total: stageList.reduce((sum, s) => sum + s.total, 0),
        stages: stageList,
      };
    })
    .sort((a, b) => b.total - a.total);

  return { status: 200, body: { currencies } satisfies AccrualsReport };
}
