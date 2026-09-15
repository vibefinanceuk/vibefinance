import type { RouteResult } from "./org-route.js";

/**
 * Minimal CRUD for teams — see docs/decisions/0015-process-workflow-
 * engine.md, docs/decisions/0016-teams.md, and docs/decisions/0332-
 * teams.md.
 *
 * **No longer unauthenticated — decision 0332.** `Admin.RoleManagement`
 * for what a team itself *is* (its own name and org, instance-wide,
 * never delegated — the same reasoning that permission already gives
 * editing a role's own definition); `Admin.UserManagement` for *who
 * belongs to it* (already the permission for assigning a role to a
 * person, and delegable the same way).
 *
 * **Every team belongs to exactly one org — decision 0333, reported
 * live: "There should never be a null-org team."** Unlike
 * `org_user_roles.unit_id`, where null deliberately means "held
 * everywhere," there is no "everywhere team" here: `unit_id` is
 * `NOT NULL` in the schema itself (migration 0064), so a delegated
 * `Admin.UserManagement` holder's own view of teams — and their own
 * reach to add or remove a member — can be scoped by this column the
 * same way people already are (decision 0321), with no unscoped case
 * ever needing to be reasoned about.
 */

interface CreateTeamBody {
  id?: unknown;
  name?: unknown;
  unitId?: unknown;
}

export async function handleCreateTeam(db: D1Database, body: CreateTeamBody): Promise<RouteResult> {
  const { id, name, unitId } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }
  if (typeof unitId !== "string" || !unitId) {
    return { status: 400, body: { error: "unitId (a string) is required — every team belongs to exactly one org" } };
  }

  const existing = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `team ${id} already exists` } };
  }
  const unitExists = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(unitId).first();
  if (!unitExists) {
    return { status: 404, body: { error: `org unit ${unitId} does not exist` } };
  }

  await db.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, ?, ?)").bind(id, name, unitId).run();

  return { status: 201, body: { id, name, unitId } };
}

interface UpdateTeamBody {
  name?: unknown;
  unitId?: unknown;
}

/**
 * **Renaming a team, and reassigning its own org — decision 0332,
 * extended in 0333.** The same "replace, not merge" shape
 * `handleUpdateRole` already gives editing a role: both fields
 * required together, nothing partial to support.
 */
export async function handleUpdateTeam(db: D1Database, teamId: string, body: UpdateTeamBody): Promise<RouteResult> {
  const { name, unitId } = body;
  if (typeof name !== "string" || !name) {
    return { status: 400, body: { error: "name (a string) is required" } };
  }
  if (typeof unitId !== "string" || !unitId) {
    return { status: 400, body: { error: "unitId (a string) is required — every team belongs to exactly one org" } };
  }

  const existing = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(teamId).first();
  if (!existing) {
    return { status: 404, body: { error: `team ${teamId} does not exist` } };
  }
  const unitExists = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(unitId).first();
  if (!unitExists) {
    return { status: 404, body: { error: `org unit ${unitId} does not exist` } };
  }

  await db.prepare("UPDATE org_teams SET name = ?, unit_id = ? WHERE id = ?").bind(name, unitId, teamId).run();

  return { status: 200, body: { id: teamId, name, unitId } };
}

/**
 * **The scope boundary, checked against the team's own org —
 * decision 0333.** Mirrors `handleAssignRole`'s own reasoning exactly:
 * a delegated administrator (`granterUnits` non-null) may act only on
 * a team whose own `unit_id` is within what they administer. Since a
 * team can never be unscoped, there is no `cannot_..._everywhere`
 * case to refuse here the way granting a role has — every team has
 * a real org to check against.
 */
async function teamWithinScope(
  db: D1Database,
  teamId: string,
  granterUnits: string[] | null
): Promise<{ ok: true } | { ok: false; result: RouteResult }> {
  if (granterUnits === null) return { ok: true };

  const team = await db.prepare("SELECT unit_id FROM org_teams WHERE id = ?").bind(teamId).first<{
    unit_id: string;
  }>();
  if (!team) {
    return { ok: false, result: { status: 404, body: { error: `team ${teamId} does not exist` } } };
  }
  if (!granterUnits.includes(team.unit_id)) {
    return {
      ok: false,
      result: {
        status: 403,
        body: { error: `you do not administer ${team.unit_id}`, reason: "outside_administered_units" },
      },
    };
  }
  return { ok: true };
}

export async function handleAddTeamMember(
  db: D1Database,
  teamId: string,
  userId: unknown,
  granterUnits: string[] | null = null
): Promise<RouteResult> {
  if (typeof userId !== "string" || !userId) {
    return { status: 400, body: { error: "userId (string) is required" } };
  }

  const teamExists = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(teamId).first();
  if (!teamExists) {
    return { status: 404, body: { error: `team ${teamId} does not exist` } };
  }

  const scoped = await teamWithinScope(db, teamId, granterUnits);
  if (!scoped.ok) return scoped.result;

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
 * **The other half of adding one — decision 0332, scoped in 0333.**
 * Mirrors `handleRevokeRole`'s own "refused, not a silent no-op"
 * discipline: removing a membership that was never there is told so,
 * rather than reporting success for nothing.
 */
export async function handleRemoveTeamMember(
  db: D1Database,
  teamId: string,
  userId: string,
  granterUnits: string[] | null = null
): Promise<RouteResult> {
  const scoped = await teamWithinScope(db, teamId, granterUnits);
  if (!scoped.ok) return scoped.result;

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
 * **Every team in scope, and who is in each — decision 0332, scoped
 * in 0333.** The same shape `/org/overview` already gives roles and
 * their own assignments. `scopeUnits` filters which teams are
 * returned at all, the same signal `handleGetOrgOverview` already
 * uses for units and people — an unscoped (`null`) caller sees every
 * team; a delegated one sees only teams whose own org they administer.
 */
export async function handleListTeams(
  db: D1Database,
  scopeUnits: string[] | null = null
): Promise<RouteResult> {
  const unitPlaceholders = scopeUnits ? scopeUnits.map(() => "?").join(", ") : "";

  const teams = await db
    .prepare(
      `SELECT t.id, t.name, t.unit_id, u.name AS unit_name
       FROM org_teams t
       JOIN org_units u ON u.id = t.unit_id
       ${scopeUnits ? `WHERE t.unit_id IN (${unitPlaceholders})` : ""}
       ORDER BY t.name ASC`
    )
    .bind(...(scopeUnits ?? []))
    .all<{ id: string; name: string; unit_id: string; unit_name: string }>();

  const teamIds = teams.results.map((t) => t.id);
  const memberPlaceholders = teamIds.map(() => "?").join(", ");
  const members =
    teamIds.length > 0
      ? await db
          .prepare(
            `SELECT tm.team_id, tm.user_id, u.name AS user_name, u.email AS user_email
             FROM org_team_members tm
             JOIN org_users u ON u.id = tm.user_id
             WHERE tm.team_id IN (${memberPlaceholders})
             ORDER BY u.name ASC`
          )
          .bind(...teamIds)
          .all<{ team_id: string; user_id: string; user_name: string; user_email: string }>()
      : { results: [] as { team_id: string; user_id: string; user_name: string; user_email: string }[] };

  return {
    status: 200,
    body: {
      teams: teams.results.map((t) => ({
        id: t.id,
        name: t.name,
        unitId: t.unit_id,
        unitName: t.unit_name,
        members: members.results
          .filter((m) => m.team_id === t.id)
          .map((m) => ({ userId: m.user_id, userName: m.user_name, userEmail: m.user_email })),
      })),
    },
  };
}
