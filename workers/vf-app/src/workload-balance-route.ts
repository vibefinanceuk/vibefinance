import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Workload balance — decision 0428, the seventh of Workload's own
 * eight key metrics (the design's own seventh bullet: *"Workload
 * balance — variance in open-task count across a team, to catch one
 * person quietly carrying the queue."*).
 *
 * **Per member's own total open-task count, the same "mine" test
 * decision 0428's own open-tasks route applies to every user** —
 * `owner_user_id` or `claimed_by` equal to that member, `status =
 * 'open'`. Not restricted to tasks this specific team owns
 * (`owner_team_id`): the point of this metric is whether one *person*
 * is quietly overloaded, which means their own whole open workload,
 * not just the slice one team happens to hold.
 *
 * **Every team member counted, including zero.** Someone carrying
 * nothing is as much a sign of imbalance as someone carrying
 * everything — `LEFT JOIN tasks`, not `JOIN`, so a member with no open
 * work still gets their own row at `0`.
 *
 * **Teams scoped by their own org unit** (`org_teams.unit_id`,
 * decision 0064's own team-belongs-to-an-org model, the same scope
 * decision 0428's own queue-depth route uses), **members' own task
 * counts additionally scoped the same way every user-level Workload
 * route already is** — through the task's own invoice
 * (`h.org_unit_id`) — so a manager never sees a member's workload
 * reaching outside the units their own `AP.Analysis` actually covers.
 *
 * **Population variance and its own square root**, both returned —
 * variance is the textbook measure "how spread out," the standard
 * deviation is in the same units as the counts themselves (tasks), so
 * a reader can compare it directly against the numbers on the card
 * without doing the arithmetic themselves. Ranked by standard
 * deviation, most imbalanced team first — the design's own stated
 * purpose, to catch the one person before it is a pattern.
 */

interface BalanceRow {
  team_id: string;
  team_name: string;
  user_id: string;
  user_name: string | null;
  task_id: string | null;
}

export interface WorkloadTeamMemberLoad {
  userId: string;
  userName: string;
  openCount: number;
}

export interface WorkloadTeamBalance {
  teamId: string;
  teamName: string;
  members: WorkloadTeamMemberLoad[];
  mean: number;
  variance: number;
  stdDev: number;
}

export interface WorkloadBalanceReport {
  teams: WorkloadTeamBalance[];
}

export async function handleWorkloadBalance(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const teamClause = unitClause({ units: scopedUnits }, "tm.unit_id");
  const taskClause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT tm.id AS team_id, tm.name AS team_name, mu.id AS user_id, mu.name AS user_name, t.id AS task_id
       FROM org_teams tm
       JOIN org_team_members m ON m.team_id = tm.id
       JOIN org_users mu ON mu.id = m.user_id
       LEFT JOIN tasks t ON (t.owner_user_id = mu.id OR t.claimed_by = mu.id) AND t.status = 'open'
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE 1 = 1 ${teamClause.sql} ${taskClause.sql}`
    )
    .bind(...teamClause.binds, ...taskClause.binds)
    .all<BalanceRow>();

  const byTeam = new Map<string, { teamName: string; members: Map<string, { userName: string; n: number }> }>();

  for (const row of rows.results) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, { teamName: row.team_name, members: new Map() });
    const team = byTeam.get(row.team_id)!;
    if (!team.members.has(row.user_id)) team.members.set(row.user_id, { userName: row.user_name ?? row.user_id, n: 0 });
    if (row.task_id) team.members.get(row.user_id)!.n += 1;
  }

  const teams: WorkloadTeamBalance[] = [...byTeam.entries()]
    .map(([teamId, t]) => {
      const members: WorkloadTeamMemberLoad[] = [...t.members.entries()]
        .map(([userId2, m]) => ({ userId: userId2, userName: m.userName, openCount: m.n }))
        .sort((a, b) => b.openCount - a.openCount);
      const counts = members.map((m) => m.openCount);
      const mean = counts.length > 0 ? counts.reduce((sum, n) => sum + n, 0) / counts.length : 0;
      const variance =
        counts.length > 0 ? counts.reduce((sum, n) => sum + (n - mean) ** 2, 0) / counts.length : 0;
      return { teamId, teamName: t.teamName, members, mean, variance, stdDev: Math.sqrt(variance) };
    })
    .sort((a, b) => b.stdDev - a.stdDev);

  return { status: 200, body: { teams } satisfies WorkloadBalanceReport };
}
