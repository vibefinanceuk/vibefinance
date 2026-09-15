import type { RouteResult } from "./org-route.js";

/**
 * Minimal CRUD for teams — see docs/decisions/0015-process-workflow-
 * engine.md and docs/decisions/0016-teams.md.
 *
 * **No longer unauthenticated — decision 0332.** The bootstrap-deadlock
 * reasoning that justified this file being ungated never actually
 * applied to teams the way it did to `/org/units` and the original
 * `/org/roles`: nothing about creating the very first account depends
 * on a team existing. Gated now, the caller's own choice of permission
 * mirrors the split already drawn elsewhere on this same screen —
 * `Admin.RoleManagement` for what a team itself *is* (its own
 * definition, customer-wide, `org_teams` carries no `unit_id` at
 * all — the same reasoning that permission already gives editing a
 * role's own definition); `Admin.UserManagement` for *who belongs to
 * it* (already the permission for assigning a role to a person).
 */

interface CreateTeamBody {
  id?: unknown;
  name?: unknown;
}

export async function handleCreateTeam(db: D1Database, body: CreateTeamBody): Promise<RouteResult> {
  const { id, name } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }

  const existing = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `team ${id} already exists` } };
  }

  await db.prepare("INSERT INTO org_teams (id, name) VALUES (?, ?)").bind(id, name).run();

  return { status: 201, body: { id, name } };
}

interface UpdateTeamBody {
  name?: unknown;
}

/**
 * **Renaming a team — decision 0332.** The same "replace, not merge"
 * shape `handleUpdateRole` already gives editing a role: a team has
 * exactly one field worth changing after creation, so there is
 * nothing partial to support.
 */
export async function handleUpdateTeam(db: D1Database, teamId: string, body: UpdateTeamBody): Promise<RouteResult> {
  const { name } = body;
  if (typeof name !== "string" || !name) {
    return { status: 400, body: { error: "name (a string) is required" } };
  }

  const existing = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(teamId).first();
  if (!existing) {
    return { status: 404, body: { error: `team ${teamId} does not exist` } };
  }

  await db.prepare("UPDATE org_teams SET name = ? WHERE id = ?").bind(name, teamId).run();

  return { status: 200, body: { id: teamId, name } };
}

export async function handleAddTeamMember(db: D1Database, teamId: string, userId: unknown): Promise<RouteResult> {
  if (typeof userId !== "string" || !userId) {
    return { status: 400, body: { error: "userId (string) is required" } };
  }

  const teamExists = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(teamId).first();
  if (!teamExists) {
    return { status: 404, body: { error: `team ${teamId} does not exist` } };
  }
  const userExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first();
  if (!userExists) {
    return { status: 404, body: { error: `user ${userId} does not exist` } };
  }

  const alreadyMember = await db
    .prepare("SELECT 1 FROM org_team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .first();
  if (alreadyMember) {
    return { status: 409, body: { error: `user ${userId} is already a member of team ${teamId}` } };
  }

  await db.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES (?, ?)").bind(teamId, userId).run();

  return { status: 201, body: { teamId, userId } };
}

/**
 * **The other half of adding one — decision 0332.** Mirrors
 * `handleRevokeRole`'s own "refused, not a silent no-op" discipline:
 * removing a membership that was never there is told so, rather than
 * reporting success for nothing.
 */
export async function handleRemoveTeamMember(db: D1Database, teamId: string, userId: string): Promise<RouteResult> {
  const result = await db
    .prepare("DELETE FROM org_team_members WHERE team_id = ? AND user_id = ?")
    .bind(teamId, userId)
    .run();

  if (!result.meta.changes) {
    return { status: 404, body: { error: `user ${userId} is not a member of team ${teamId}` } };
  }

  return { status: 200, body: { teamId, userId } };
}

/**
 * **Every team, and who is in each — decision 0332.** The same shape
 * `/org/overview` already gives roles and their own assignments: a
 * screen needs to see current membership before it can offer to
 * change it.
 */
export async function handleListTeams(db: D1Database): Promise<RouteResult> {
  const teams = await db.prepare("SELECT id, name FROM org_teams ORDER BY name ASC").all<{
    id: string;
    name: string;
  }>();

  const members = await db
    .prepare(
      `SELECT tm.team_id, tm.user_id, u.name AS user_name, u.email AS user_email
       FROM org_team_members tm
       JOIN org_users u ON u.id = tm.user_id
       ORDER BY u.name ASC`
    )
    .all<{ team_id: string; user_id: string; user_name: string; user_email: string }>();

  return {
    status: 200,
    body: {
      teams: teams.results.map((t) => ({
        id: t.id,
        name: t.name,
        members: members.results
          .filter((m) => m.team_id === t.id)
          .map((m) => ({ userId: m.user_id, userName: m.user_name, userEmail: m.user_email })),
      })),
    },
  };
}
