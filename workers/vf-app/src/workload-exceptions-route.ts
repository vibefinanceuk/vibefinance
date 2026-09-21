import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Exceptions by user — decision 0428, the eighth and last of
 * Workload's own eight key metrics (the design's own eighth bullet:
 * *"Exceptions by user — not to assign blame, but to see where extra
 * support or training would help."*).
 *
 * **An exception is what `stage_visits.validation_passed = 0` already
 * means** — decision 0021's own persisted verdict, the same
 * definition `dashboard-route.ts`'s `exceptionsBySupplier` card,
 * decision 0421's own `supplier-exceptions-route.ts`, and decision
 * 0423's own `fraud-exception-trends-route.ts` all already use. Not a
 * new detection concept.
 *
 * **Genuinely the same underlying join as decision 0423's own `byUser`
 * breakdown — reused deliberately, not duplicated by accident.** That
 * route lives on Fraud Prevention, gated `AP.FraudReview`, trended
 * weekly, and framed for review; this one lives on Workload, gated
 * `AP.Analysis` like every other route on this screen, a flat count
 * over a fixed window, and framed for coaching — a manager's own "who
 * might need help," not a reviewer's "what's rising." Two different
 * screens asking a related question of the same data is not the same
 * as one screen re-listing the other's own card (decision 0423's own
 * doc comment makes the identical distinction against decision 0421).
 *
 * **A completed task's own credit, not the exception count itself** —
 * a failing visit can spawn more than one line-level task, each
 * credited to whoever completed it, the same unit `workload-route.ts`'s
 * own throughput and decision 0423's own `byUser` already count by.
 *
 * **90 days — "a season," the same window decision 0421 already gives
 * its own exception-rate card**, not decision 0423's own 8-week trend
 * window — this is a flat total, not a trend, so there is no weekly
 * bucket to size the window around.
 */

const WINDOW_DAYS = 90;
const TOP_USERS = 10;

interface ExceptionUserRow {
  user_id: string;
  user_name: string | null;
}

export interface WorkloadExceptionUser {
  userId: string;
  userName: string;
  n: number;
}

export interface WorkloadExceptionsReport {
  users: WorkloadExceptionUser[];
}

export async function handleWorkloadExceptions(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT t.completed_by AS user_id, u.name AS user_name
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       JOIN tasks t ON t.stage_visit_id = v.id
       LEFT JOIN org_users u ON u.id = t.completed_by
       WHERE v.validation_passed = 0
         AND t.status = 'completed'
         AND t.completed_by IS NOT NULL
         AND julianday('now') - julianday(v.created_at) < ${WINDOW_DAYS}
         ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<ExceptionUserRow>();

  const byUser = new Map<string, { userName: string; n: number }>();
  for (const row of rows.results) {
    const existing = byUser.get(row.user_id);
    if (existing) existing.n += 1;
    else byUser.set(row.user_id, { userName: row.user_name ?? row.user_id, n: 1 });
  }

  const users: WorkloadExceptionUser[] = [...byUser.entries()]
    .map(([id, u]) => ({ userId: id, userName: u.userName, n: u.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, TOP_USERS);

  return { status: 200, body: { users } satisfies WorkloadExceptionsReport };
}
