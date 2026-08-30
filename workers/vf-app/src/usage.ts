import type { UsageReport } from "@vibefinance/shared";

interface OutcomeCountRow {
  outcome: string;
  n: number;
}

/**
 * Reads the current calendar month's counts directly from
 * invoice_runs / invoice_run_steps — never a running counter kept in
 * application memory, which would lose data on every Worker restart.
 * D1 is the source of truth; this just aggregates it.
 */
export async function computeCurrentPeriodUsage(
  db: D1Database,
  now: Date,
  customerId: string
): Promise<UsageReport> {
  const periodKey = now.toISOString().slice(0, 7); // "YYYY-MM"

  const invoicesRow = await db
    .prepare("SELECT count(*) AS n FROM invoice_runs WHERE strftime('%Y-%m', created_at) = ?")
    .bind(periodKey)
    .first<{ n: number }>();

  const rulesRow = await db
    .prepare(
      `SELECT count(*) AS n FROM invoice_run_steps
       WHERE invoice_run_id IN (
         SELECT id FROM invoice_runs WHERE strftime('%Y-%m', created_at) = ?
       )`
    )
    .bind(periodKey)
    .first<{ n: number }>();

  const outcomeRows = await db
    .prepare(
      "SELECT outcome, count(*) AS n FROM invoice_runs WHERE strftime('%Y-%m', created_at) = ? GROUP BY outcome"
    )
    .bind(periodKey)
    .all<OutcomeCountRow>();

  const outcomeCounts: Record<string, number> = {};
  for (const row of outcomeRows.results) {
    outcomeCounts[row.outcome] = row.n;
  }

  return {
    customerId,
    periodKey,
    invoicesProcessed: invoicesRow?.n ?? 0,
    rulesEvaluated: rulesRow?.n ?? 0,
    // Not yet computable — see UsageReport's own doc comment.
    activeUsers: null,
    outcomeCounts,
  };
}

/** Sends a report to vf-licence, or throws/rejects on any failure to
 * reach it. Injected rather than a hardcoded `fetch` call — same
 * pattern as licence-cache.ts's LicenceTokenFetcher, testable without
 * a live network. */
export type UsagePusher = (report: UsageReport) => Promise<void>;

/**
 * Compute the current period's usage and push it. Every call reports
 * the *current, still-open* period's running totals, not a final
 * count sent once at period end — so "push more often" and "push
 * on-demand" are the same capability, both just an up-to-date
 * snapshot, and the composite (customerId, periodKey) key on the
 * receiving side means repeated pushes for the same period overwrite
 * rather than accumulate. See docs/decisions/0004-usage-telemetry.md.
 *
 * Unlike refreshLicenceCache, there is no "prior state" to fail open
 * to here — a failed push simply means this period's row on
 * vf-licence is stale until the next successful push, cron or
 * on-demand. Nothing in vf-app is gated on this succeeding.
 */
export async function pushUsage(
  db: D1Database,
  now: Date,
  customerId: string,
  pusher: UsagePusher
): Promise<UsageReport> {
  const report = await computeCurrentPeriodUsage(db, now, customerId);
  await pusher(report);
  return report;
}
