import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Open task count by user, split by ownership — decision 0428, the
 * second of Workload's own eight key metrics (the design's own second
 * bullet under Screen 2 — User & Team Workload's key metrics: *"Open
 * task count by user, split by ownership (mine / available / locked,
 * the same model task-list-route.ts already computes)."*
 *
 * **Each user's open tasks by stage — decision 0611's follow-on, 0612.**
 * The card became a choice of one user and a ring of where their open
 * tasks sit, because a bar per user grows without limit. Each user
 * carries `stages`, a count per real stage (not 0415's colour buckets:
 * one person's ring rarely holds more than five, and `donutChart` folds
 * the rest if it does), and `stages` at the top lists every stage any
 * user has open work at, in process order, so the card can give a stage
 * the same colour whoever is chosen.
 *
 * **"Mine" and "available," not a third "locked" column.**
 * `task-list-route.ts`'s own `ownershipOf` is relative to whoever is
 * asking — "locked" means "claimed, but not by me," which only means
 * something from one viewer's own seat. A manager's aggregate table
 * has no single "me" to be relative to, so a per-user "locked" column
 * would just be "everyone else's open count," restated once per row.
 * What carries over honestly: **per user, the tasks that are theirs**
 * (`owner_user_id` or `claimed_by` equal to that user — `ownershipOf`'s
 * own "mine" test, applied to every user in scope rather than one),
 * and **one shared "available" total** — unclaimed, team-owned tasks,
 * belonging to nobody yet. Together the two numbers account for every
 * open task in scope exactly once, the same completeness `ownershipOf`
 * itself guarantees for one viewer.
 *
 * **Scoped like every other Workload route** — `AP.Analysis`,
 * `unitClause` against the task's own invoice's `org_unit_id`, reached
 * through the same `stage_visits` → `process_instances` →
 * `invoice_headers` chain `workload-route.ts`'s own throughput query
 * already uses. Not filtered to "my teams" the way `task-list-route.ts`
 * is for one person's own task list — a manager's view is every user
 * the org-unit scope covers, not only the viewer's own teams.
 */

interface OpenTaskRow {
  owner_user_id: string | null;
  claimed_by: string | null;
  owner_team_id: string | null;
  user_id: string | null;
  user_name: string | null;
  stage_id: string;
  stage_name: string;
  process_id: string;
  sequence: number;
}

export interface WorkloadOpenTaskStage {
  stageId: string;
  stageName: string;
  n: number;
}

export interface WorkloadOpenTaskUser {
  userId: string;
  userName: string;
  openCount: number;
  stages: WorkloadOpenTaskStage[];
}

export interface WorkloadOpenTasksReport {
  users: WorkloadOpenTaskUser[];
  stages: Array<{ stageId: string; stageName: string }>;
  available: number;
}

export async function handleWorkloadOpenTasks(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT t.owner_user_id AS owner_user_id, t.claimed_by AS claimed_by, t.owner_team_id AS owner_team_id,
              COALESCE(t.owner_user_id, t.claimed_by) AS user_id, u.name AS user_name,
              s.id AS stage_id, s.name AS stage_name, s.process_id AS process_id, s.sequence AS sequence
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN org_users u ON u.id = COALESCE(t.owner_user_id, t.claimed_by)
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.status = 'open' ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<OpenTaskRow>();

  const byUser = new Map<string, { userName: string; n: number; stages: Map<string, number> }>();
  const stageInfo = new Map<string, { stageName: string; processId: string; sequence: number }>();
  let available = 0;

  for (const row of rows.results) {
    const owner = row.owner_user_id ?? row.claimed_by;
    if (owner) {
      if (!byUser.has(owner)) byUser.set(owner, { userName: row.user_name ?? owner, n: 0, stages: new Map() });
      const user = byUser.get(owner)!;
      user.n += 1;
      user.stages.set(row.stage_id, (user.stages.get(row.stage_id) ?? 0) + 1);
      stageInfo.set(row.stage_id, { stageName: row.stage_name, processId: row.process_id, sequence: row.sequence });
    } else {
      available += 1;
    }
  }

  /** Process order: by process, then where the stage falls in it. */
  const stageOrder = [...stageInfo.entries()]
    .sort(([, a], [, b]) => a.processId.localeCompare(b.processId) || a.sequence - b.sequence)
    .map(([stageId]) => stageId);

  const users: WorkloadOpenTaskUser[] = [...byUser.entries()]
    .map(([id, u]) => ({
      userId: id,
      userName: u.userName,
      openCount: u.n,
      stages: stageOrder
        .filter((stageId) => u.stages.has(stageId))
        .map((stageId) => ({ stageId, stageName: stageInfo.get(stageId)!.stageName, n: u.stages.get(stageId)! })),
    }))
    .sort((a, b) => b.openCount - a.openCount);

  const stages = stageOrder.map((stageId) => ({ stageId, stageName: stageInfo.get(stageId)!.stageName }));

  return { status: 200, body: { users, stages, available } satisfies WorkloadOpenTasksReport };
}
