import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Tasks pending action over a configurable period — decision 0428, the
 * fifth of Workload's own eight key metrics (the design's own fifth
 * bullet: *"Tasks pending action over a configurable period, and
 * tasks approaching/past due."*).
 *
 * **Only the "pending over a period" half.** "Approaching/past due"
 * needs a per-task due date, and none exists anywhere in this schema
 * — the only date-like concept is `hold_until`, a fired rule action
 * recorded in the activity log against an *invoice*
 * (`activity-route.ts`), not a queryable column on a *task*. Offered
 * directly, the operator chose to build the period half only and
 * leave "approaching/past due" honestly parked, the same discipline
 * early-payment/discount capture rate was parked under before decision
 * 0427 resolved it.
 *
 * **"Configurable" read as fixed thresholds shown together, not a
 * live client-side control.** No filter/date-range control exists yet
 * anywhere in this codebase's own UI components (`charts.js` has none)
 * — inventing that interaction pattern for one card is real, separate
 * scope this decision does not take on silently. Three named
 * thresholds (3 / 7 / 14 days open) are computed and returned
 * together, so a manager reads increasing severity in one table rather
 * than picking one arbitrary cutoff. A real interactive picker is a
 * future decision, should it be wanted.
 *
 * **Age measured from `created_at`** — when the task entered the
 * queue, whether or not it has since been claimed — matching "pending
 * action" literally: nobody has finished it yet, regardless of
 * ownership. `claimed_at` measures a narrower thing (decision 0428's
 * own handling-time/cycle-time routes), not this one.
 *
 * **Scoped like every other Workload route** — `AP.Analysis`, the same
 * join chain every other route on this screen already uses.
 */

export const PENDING_THRESHOLDS_DAYS = [3, 7, 14] as const;

interface PendingRow {
  owner_user_id: string | null;
  claimed_by: string | null;
  user_id: string | null;
  user_name: string | null;
  age_days: number;
}

export interface WorkloadPendingUser {
  userId: string;
  userName: string;
  counts: number[];
}

export interface WorkloadPendingReport {
  thresholdsDays: readonly number[];
  users: WorkloadPendingUser[];
  unclaimed: number[];
}

export async function handleWorkloadPending(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string,
  now: Date = new Date()
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");
  const nowIso = now.toISOString();

  const rows = await db
    .prepare(
      `SELECT t.owner_user_id AS owner_user_id, t.claimed_by AS claimed_by,
              COALESCE(t.owner_user_id, t.claimed_by) AS user_id, u.name AS user_name,
              julianday(?1) - julianday(t.created_at) AS age_days
       FROM tasks t
       LEFT JOIN org_users u ON u.id = COALESCE(t.owner_user_id, t.claimed_by)
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'open' ${clause.sql}`
    )
    .bind(nowIso, ...clause.binds)
    .all<PendingRow>();

  const byUser = new Map<string, { userName: string; counts: number[] }>();
  const unclaimed = PENDING_THRESHOLDS_DAYS.map(() => 0);

  for (const row of rows.results) {
    const owner = row.owner_user_id ?? row.claimed_by;
    const bucketCounts = PENDING_THRESHOLDS_DAYS.map((d) => (row.age_days >= d ? 1 : 0));

    if (owner) {
      const existing = byUser.get(owner);
      if (existing) {
        bucketCounts.forEach((n, i) => (existing.counts[i] += n));
      } else {
        byUser.set(owner, { userName: row.user_name ?? owner, counts: bucketCounts });
      }
    } else {
      bucketCounts.forEach((n, i) => (unclaimed[i] += n));
    }
  }

  const users: WorkloadPendingUser[] = [...byUser.entries()]
    .map(([id, u]) => ({ userId: id, userName: u.userName, counts: u.counts }))
    // A user with nothing past even the shortest threshold has nothing
    // pending to report — omitted rather than shown as a row of zeros.
    .filter((u) => u.counts.some((n) => n > 0))
    .sort((a, b) => b.counts[0] - a.counts[0]);

  return {
    status: 200,
    body: { thresholdsDays: PENDING_THRESHOLDS_DAYS, users, unclaimed } satisfies WorkloadPendingReport,
  };
}
