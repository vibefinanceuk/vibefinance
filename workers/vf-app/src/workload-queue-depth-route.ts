import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Team queue depth — decision 0428, the sixth of Workload's own eight
 * key metrics (the design's own sixth bullet: *"Team queue depth —
 * available (unclaimed) vs. locked (claimed but not finished), a
 * direct read of workload distribution."*).
 *
 * **Scoped by the team's own org unit, not the task's invoice.** Every
 * team belongs to exactly one org unit (`org_teams.unit_id`, decision
 * 0064) — a more direct scope for a team-level metric than reaching
 * through a task's own invoice the way user-level Workload routes do.
 * `unitClause` against `org_teams.unit_id` and `AP.Analysis`, the same
 * permission every other route on this screen already checks.
 *
 * **Only team-owned tasks** (`owner_team_id` set) — a named-user task
 * belongs to a person directly, never sits in a team's own queue, and
 * has no claiming step to be "available" or "locked" through in the
 * first place.
 */

interface QueueDepthRow {
  team_id: string;
  team_name: string;
  claimed_by: string | null;
}

export interface WorkloadTeamQueueDepth {
  teamId: string;
  teamName: string;
  available: number;
  locked: number;
}

export interface WorkloadQueueDepthReport {
  teams: WorkloadTeamQueueDepth[];
}

export async function handleWorkloadQueueDepth(
  db: D1Database,
  currentOrg: string | null = null,
  userId?: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "tm.unit_id");

  const rows = await db
    .prepare(
      `SELECT tm.id AS team_id, tm.name AS team_name, t.claimed_by AS claimed_by
       FROM tasks t
       JOIN org_teams tm ON tm.id = t.owner_team_id
       WHERE t.status = 'open' AND t.owner_team_id IS NOT NULL ${clause.sql}`
    )
    .bind(...clause.binds)
    .all<QueueDepthRow>();

  const byTeam = new Map<string, { teamName: string; available: number; locked: number }>();

  for (const row of rows.results) {
    if (!byTeam.has(row.team_id)) byTeam.set(row.team_id, { teamName: row.team_name, available: 0, locked: 0 });
    const team = byTeam.get(row.team_id)!;
    if (row.claimed_by) team.locked += 1;
    else team.available += 1;
  }

  const teams: WorkloadTeamQueueDepth[] = [...byTeam.entries()]
    .map(([teamId, t]) => ({ teamId, teamName: t.teamName, available: t.available, locked: t.locked }))
    .sort((a, b) => b.available + b.locked - (a.available + a.locked));

  return { status: 200, body: { teams } satisfies WorkloadQueueDepthReport };
}
