import type { RouteResult } from "./customers-route.js";

export interface ReportUsageBody {
  environmentId?: unknown;
  periodKey?: unknown;
  invoicesProcessed?: unknown;
  rulesEvaluated?: unknown;
  activeUsers?: unknown;
  outcomeCounts?: unknown;
}

/**
 * Idempotent by construction: (environment_id, period_key) is the
 * primary key on usage_periods (see the migration's own comment), so
 * a retried push, a duplicate cron fire, or an intentional "push again
 * with fresher numbers" all just overwrite the same row — Blueprint:
 * "Composite primary key makes the push idempotent. Retries and
 * duplicate cron fires cannot double-count."
 *
 * Re-keyed to environmentId (decision 0036) — usage is now tracked
 * per environment, not blended across a customer's sandbox and
 * production activity. This matters directly for a future
 * consumption-based bill: sandbox testing must never count toward a
 * real invoice-volume tier.
 *
 * No authentication on this endpoint today — the same gap as
 * POST /customers and POST /licences, not a new one, but worth
 * flagging explicitly here rather than silently: unlike those two,
 * this endpoint's data has a direct billing implication (Blueprint:
 * "invoices_processed... the billing number"). See
 * docs/decisions/0004-usage-telemetry.md.
 */
export async function handleReportUsage(db: D1Database, body: ReportUsageBody): Promise<RouteResult> {
  const { environmentId, periodKey, invoicesProcessed, rulesEvaluated } = body;
  if (
    typeof environmentId !== "string" ||
    !environmentId ||
    typeof periodKey !== "string" ||
    !periodKey ||
    typeof invoicesProcessed !== "number" ||
    typeof rulesEvaluated !== "number"
  ) {
    return {
      status: 400,
      body: {
        error:
          "environmentId, periodKey (strings) and invoicesProcessed, rulesEvaluated (numbers) are required",
      },
    };
  }
  if (invoicesProcessed < 0 || rulesEvaluated < 0) {
    return { status: 400, body: { error: "counts must not be negative" } };
  }

  const activeUsers = typeof body.activeUsers === "number" ? body.activeUsers : null;
  const outcomeCounts =
    typeof body.outcomeCounts === "object" && body.outcomeCounts !== null
      ? (body.outcomeCounts as Record<string, unknown>)
      : {};

  const environmentExists = await db
    .prepare("SELECT id FROM environments WHERE id = ?")
    .bind(environmentId)
    .first();
  if (!environmentExists) {
    return { status: 404, body: { error: `environment ${environmentId} does not exist` } };
  }

  await db
    .prepare(
      `INSERT INTO usage_periods
         (environment_id, period_key, invoices_processed, rules_evaluated, active_users, outcome_counts_json, received_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(environment_id, period_key) DO UPDATE SET
         invoices_processed = excluded.invoices_processed,
         rules_evaluated = excluded.rules_evaluated,
         active_users = excluded.active_users,
         outcome_counts_json = excluded.outcome_counts_json,
         received_at = excluded.received_at`
    )
    .bind(
      environmentId,
      periodKey,
      invoicesProcessed,
      rulesEvaluated,
      activeUsers,
      JSON.stringify(outcomeCounts)
    )
    .run();

  return {
    status: 200,
    body: { status: "recorded", environmentId, periodKey, invoicesProcessed, rulesEvaluated },
  };
}
