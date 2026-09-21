import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Claim-to-complete cycle time — decision 0428, the fourth of
 * Workload's own eight key metrics (the design's own fourth bullet:
 * *"Claim-to-complete cycle time — how long a task sits once somebody
 * has it, not just how long it waits."*).
 *
 * **The same `completed_at - claimed_at` measurement decision 0428's
 * own handling-time route uses, one level up** — per user overall,
 * not broken out by stage. Two distinct cards for two distinct
 * questions: handling time answers "which stage is slow for this
 * person," cycle time answers "how long does this person typically
 * hold a task, full stop" — a single ranked number per user rather
 * than a matrix, the shape a bar list already fits.
 *
 * **Only tasks that were actually claimed**, the same "exclude, don't
 * guess" reasoning the handling-time route already gives for why a
 * named-user task (no claiming step, `claimed_at` always null) cannot
 * honestly contribute here.
 *
 * **Scoped like every other Workload route** — `AP.Analysis`, the same
 * `stage_visits` → `process_instances` → `invoice_headers` chain
 * `workload-route.ts`'s own throughput query already uses.
 */

const TOP_USERS = 10;

interface CycleTimeRow {
  user_id: string;
  user_name: string | null;
  hours: number;
}

export interface WorkloadCycleTimeUser {
  userId: string;
  userName: string;
  avgHours: number;
  n: number;
}

export interface WorkloadCycleTimeReport {
  users: WorkloadCycleTimeUser[];
}

export async function handleWorkloadCycleTime(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT t.completed_by AS user_id, u.name AS user_name,
              (julianday(t.completed_at) - julianday(t.claimed_at)) * 24 AS hours
       FROM tasks t
       LEFT JOIN org_users u ON u.id = t.completed_by
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'completed'
         AND t.claimed_at IS NOT NULL
         AND t.completed_by IS NOT NULL
         ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<CycleTimeRow>();

  const byUser = new Map<string, { userName: string; total: number; n: number }>();
  for (const row of rows.results) {
    const existing = byUser.get(row.user_id);
    if (existing) {
      existing.total += row.hours;
      existing.n += 1;
    } else {
      byUser.set(row.user_id, { userName: row.user_name ?? row.user_id, total: row.hours, n: 1 });
    }
  }

  const users: WorkloadCycleTimeUser[] = [...byUser.entries()]
    .map(([id, u]) => ({ userId: id, userName: u.userName, avgHours: u.total / u.n, n: u.n }))
    .sort((a, b) => b.avgHours - a.avgHours)
    .slice(0, TOP_USERS);

  return { status: 200, body: { users } satisfies WorkloadCycleTimeReport };
}
