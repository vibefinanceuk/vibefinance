import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Average handling time by stage and by user — decision 0428, the
 * third of Workload's own eight key metrics (the design's own third
 * bullet under Screen 2's key metrics).
 *
 * **Handling time means claim-to-complete, the same reading the
 * design's own next bullet spells out for "cycle time": "how long a
 * task sits once somebody has it, not just how long it waits."**
 * Measured as `completed_at - claimed_at` in hours, for completed
 * tasks — not `completed_at - created_at`, which would fold in queue
 * wait time this metric is explicitly not about.
 *
 * **Only tasks that were actually claimed.** A named-user task has no
 * claiming step at all — migration 0008's own words, "it's already
 * theirs" — so `claimed_at` stays null for it forever; there is no
 * "claim" event to measure handling time from. Excluded here, honestly,
 * the same "exclude, don't guess" discipline decision 0427 already
 * applied to a supplier with no diffable prior row.
 *
 * **Scoped like every other Workload route** — `AP.Analysis`, the same
 * `stage_visits` → `process_instances` → `invoice_headers` chain
 * `workload-route.ts`'s own throughput query already uses.
 *
 * **A plain table, one row per (stage, user)** — this is a matrix, not
 * a single ranked dimension a bar chart or list can show cleanly; the
 * same reasoning that put decision 0427's own hold history in a table
 * rather than a chart. Ranked by average hours, longest first, capped
 * at a top-N the same way every other ranked route on this screen
 * already is.
 */

const TOP_N = 15;

interface HandlingTimeRow {
  stage_id: string;
  stage_name: string;
  user_id: string;
  user_name: string | null;
  hours: number;
}

export interface WorkloadHandlingTimeRow {
  stageId: string;
  stageName: string;
  userId: string;
  userName: string;
  avgHours: number;
  n: number;
}

export interface WorkloadHandlingTimeReport {
  rows: WorkloadHandlingTimeRow[];
}

export async function handleWorkloadHandlingTime(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT s.id AS stage_id, s.name AS stage_name,
              t.completed_by AS user_id, u.name AS user_name,
              (julianday(t.completed_at) - julianday(t.claimed_at)) * 24 AS hours
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
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
    .all<HandlingTimeRow>();

  const grouped = new Map<string, { stageName: string; userName: string; total: number; n: number }>();

  for (const row of rows.results) {
    const key = `${row.stage_id}\u0000${row.user_id}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.total += row.hours;
      existing.n += 1;
    } else {
      grouped.set(key, {
        stageName: row.stage_name,
        userName: row.user_name ?? row.user_id,
        total: row.hours,
        n: 1,
      });
    }
  }

  const result: WorkloadHandlingTimeRow[] = [...grouped.entries()]
    .map(([key, g]) => {
      const [stageId, userId2] = key.split("\u0000");
      return {
        stageId,
        stageName: g.stageName,
        userId: userId2,
        userName: g.userName,
        avgHours: g.total / g.n,
        n: g.n,
      };
    })
    .sort((a, b) => b.avgHours - a.avgHours)
    .slice(0, TOP_N);

  return { status: 200, body: { rows: result } satisfies WorkloadHandlingTimeReport };
}
