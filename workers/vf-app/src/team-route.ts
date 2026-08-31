import type { RouteResult } from "./org-route.js";

/**
 * Minimal CRUD for teams — see docs/decisions/0015-process-workflow-
 * engine.md and docs/decisions/0016-teams.md. Deliberately no
 * authentication, matching org-route.ts's own precedent
 * (decision 0010): team management is the same class of
 * administrative/setup concern as creating org units, users, and
 * roles, and gating it would risk the same bootstrap deadlock
 * avoided there. No task assignment, no claiming, no eligibility
 * checking here — this file creates the data those features will
 * later depend on, not the features themselves.
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
