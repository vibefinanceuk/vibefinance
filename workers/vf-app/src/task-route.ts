import type { RouteResult } from "./org-route.js";
import { isKnownPermission } from "./permissions.js";

/**
 * Tasks — see docs/decisions/0018-process-definitions-and-tasks.md.
 * A task's owner is exactly one of a team or a named user; either
 * way, the permission check is universal, applied regardless of
 * assignment path (confirmed explicitly, "for now" — a real,
 * revisitable decision). Claiming and completing are both atomic,
 * single-statement, conditional UPDATEs — the same discipline already
 * proven for rule-version activation's own ordering (decision 0014) —
 * never a separate check-then-write with a race window in between.
 */

interface CreateTaskBody {
  id?: unknown;
  stageId?: unknown;
  teamId?: unknown;
  userId?: unknown;
  requiredPermission?: unknown;
}

export async function handleCreateTask(db: D1Database, body: CreateTaskBody): Promise<RouteResult> {
  const { id, stageId, teamId, userId, requiredPermission } = body;
  if (typeof id !== "string" || !id || typeof stageId !== "string" || !stageId) {
    return { status: 400, body: { error: "id and stageId (both strings) are required" } };
  }
  if (teamId !== undefined && (typeof teamId !== "string" || !teamId)) {
    return { status: 400, body: { error: "teamId, if provided, must be a non-empty string" } };
  }
  if (userId !== undefined && (typeof userId !== "string" || !userId)) {
    return { status: 400, body: { error: "userId, if provided, must be a non-empty string" } };
  }
  if ((teamId && userId) || (!teamId && !userId)) {
    return { status: 400, body: { error: "exactly one of teamId or userId is required" } };
  }
  if (!isKnownPermission(requiredPermission)) {
    return {
      status: 422,
      body: { error: `requiredPermission "${String(requiredPermission)}" is not in the closed permission vocabulary` },
    };
  }

  const stageExists = await db.prepare("SELECT id FROM process_stages WHERE id = ?").bind(stageId).first();
  if (!stageExists) {
    return { status: 404, body: { error: `stage ${stageId} does not exist` } };
  }
  if (teamId) {
    const teamExists = await db.prepare("SELECT id FROM org_teams WHERE id = ?").bind(teamId).first();
    if (!teamExists) {
      return { status: 404, body: { error: `team ${teamId} does not exist` } };
    }
  } else {
    const userExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first();
    if (!userExists) {
      return { status: 404, body: { error: `user ${userId} does not exist` } };
    }
  }

  await db
    .prepare(
      `INSERT INTO tasks (id, stage_id, owner_team_id, owner_user_id, required_permission)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, stageId, (teamId as string) ?? null, (userId as string) ?? null, requiredPermission)
    .run();

  return {
    status: 201,
    body: { id, stageId, teamId: teamId ?? null, userId: userId ?? null, requiredPermission },
  };
}

interface TaskOwnershipRow {
  owner_team_id: string | null;
  owner_user_id: string | null;
  claimed_by: string | null;
  completed_by: string | null;
}

/**
 * The caller (index.ts) is responsible for confirming claimingUserId
 * actually holds the task's own required_permission before calling
 * this — via requirePermission with the task's dynamic permission
 * value, the same way every other permission-gated route already
 * works, just with the permission looked up per-task instead of
 * hardcoded per-route.
 */
export async function handleClaimTask(db: D1Database, taskId: string, claimingUserId: string): Promise<RouteResult> {
  const task = await db
    .prepare("SELECT owner_team_id, owner_user_id, claimed_by, completed_by FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<TaskOwnershipRow>();
  if (!task) {
    return { status: 404, body: { error: `task ${taskId} does not exist` } };
  }
  if (task.completed_by) {
    return { status: 409, body: { error: "task is already completed" } };
  }
  if (!task.owner_team_id) {
    return { status: 400, body: { error: "task is not team-owned — a named-user task cannot be claimed" } };
  }

  const isMember = await db
    .prepare("SELECT 1 FROM org_team_members WHERE team_id = ? AND user_id = ?")
    .bind(task.owner_team_id, claimingUserId)
    .first();
  if (!isMember) {
    return { status: 403, body: { error: "not a member of the team that owns this task" } };
  }

  const now = new Date().toISOString();
  // Atomic: the WHERE clause's own claimed_by IS NULL is what makes
  // this race-safe, not the SELECT above (which only informs the
  // error message — two concurrent requests could both pass it before
  // either UPDATE commits). meta.changes distinguishes "I won the
  // claim" from "someone else claimed it in between."
  const result = await db
    .prepare("UPDATE tasks SET claimed_by = ?, claimed_at = ? WHERE id = ? AND claimed_by IS NULL")
    .bind(claimingUserId, now, taskId)
    .run();
  if (result.meta.changes === 0) {
    return { status: 409, body: { error: "task was already claimed by someone else" } };
  }

  return { status: 200, body: { taskId, claimedBy: claimingUserId, claimedAt: now } };
}

export async function handleCompleteTask(
  db: D1Database,
  taskId: string,
  completingUserId: string
): Promise<RouteResult> {
  const task = await db
    .prepare("SELECT owner_team_id, owner_user_id, claimed_by, completed_by FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<TaskOwnershipRow>();
  if (!task) {
    return { status: 404, body: { error: `task ${taskId} does not exist` } };
  }
  if (task.completed_by) {
    return { status: 409, body: { error: "task is already completed" } };
  }

  if (task.owner_user_id) {
    // Named-user task: only that exact person, no claiming step at
    // all — it was already theirs.
    if (task.owner_user_id !== completingUserId) {
      return { status: 403, body: { error: "only the assigned user may complete this task" } };
    }
  } else {
    // Team task: must be claimed first, and only the claimer may
    // complete it — completing without claiming would defeat the
    // whole point of claiming (locking a task to one person before
    // they act on it).
    if (!task.claimed_by) {
      return { status: 409, body: { error: "this task must be claimed before it can be completed" } };
    }
    if (task.claimed_by !== completingUserId) {
      return { status: 403, body: { error: "only the user who claimed this task may complete it" } };
    }
  }

  const now = new Date().toISOString();
  const result = await db
    // The `status = 'open'` clause is what makes this atomic against a
    // return: a task somebody sent back cannot then be completed by its
    // previous holder, and the update simply matches no rows.
    .prepare("UPDATE tasks SET completed_by = ?, completed_at = ?, status = 'completed' WHERE id = ? AND status = 'open'")
    .bind(completingUserId, now, taskId)
    .run();
  if (result.meta.changes === 0) {
    return { status: 409, body: { error: "task was already completed" } };
  }

  return { status: 200, body: { taskId, completedBy: completingUserId, completedAt: now } };
}
