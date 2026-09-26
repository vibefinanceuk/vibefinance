import type { AuthenticatedUser } from "./user-auth.js";
import { hasPermission } from "./enforce.js";
import type { RouteResult } from "./org-route.js";
import { isKnownPermission } from "./permissions.js";
import type { Permission } from "./permissions.js";

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
export async function handleClaimTask(
  db: D1Database,
  taskId: string,
  claimingUserId: string,
  comment?: string | null
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

  // decision 0488: the first durable record of this claim cycle — see
  // migrations/0083_task_action_events.sql for why claim/release (and
  // only those two) get a genuinely new table rather than deriving
  // from `tasks` the way stage_completed/return/discard already do.
  await db
    .prepare("INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment) VALUES (?, ?, 'claim', ?, ?, ?)")
    .bind(crypto.randomUUID(), taskId, claimingUserId, now, comment ?? null)
    .run();

  return { status: 200, body: { taskId, claimedBy: claimingUserId, claimedAt: now } };
}

export async function handleCompleteTask(
  db: D1Database,
  taskId: string,
  completingUserId: string,
  // decision 0497: Route To Approver's own optional comment, asked for
  // directly — "similar to the Reassign box." Both are read here
  // rather than in `index.ts`, matching where claim/reassign already
  // write their own `task_action_events` row, but neither is written
  // unless `targetUserId` is present: a plain Complete (every stage
  // that isn't Route To Approver, today and always) sends neither and
  // must stay exactly as it already reads in the Timeline — one
  // `stage_completed` line, nothing else. `comment` alone, with no
  // `targetUserId`, is not a real caller today (Route To Approver's
  // picker always sends both together) and is treated the same way:
  // silently not written, rather than inventing a new question ("was
  // this really a route?") nobody has asked.
  comment?: string | null,
  targetUserId?: string
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

  // decision 0497: the same shape decision 0489 already gave
  // reassign — `target_user_id` is what lets the Timeline say who it
  // went to, and its presence is exactly the signal that this
  // completion was a routing decision rather than an ordinary one.
  if (targetUserId) {
    await db
      .prepare(
        "INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment, target_user_id) VALUES (?, ?, 'route_to_approver', ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), taskId, completingUserId, now, comment ?? null, targetUserId)
      .run();
  }

  return { status: 200, body: { taskId, completedBy: completingUserId, completedAt: now } };
}

/**
 * Releasing a claim — decision 0104.
 *
 * **Locks do not expire** (decision 0103). A browser closing is
 * undetectable — `beforeunload` does not fire on a crash, a sleeping
 * laptop or a killed tab — so any automatic release leaks locks, and a
 * lease takes somebody's claim mid-thought on a timeout nobody can
 * choose correctly.
 *
 * A lock that never expires is at least predictable. This is the
 * explicit recovery that makes it workable: a person releases their
 * own, and somebody with `AP.TaskManage` releases anybody's.
 */
export async function handleReleaseTask(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser,
  comment?: string | null
): Promise<RouteResult> {
  const task = await db
    .prepare("SELECT claimed_by, status, owner_team_id FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ claimed_by: string | null; status: string; owner_team_id: string | null }>();

  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.status !== "open") {
    return { status: 409, body: { error: `task ${taskId} is ${task.status}` } };
  }
  if (!task.claimed_by) {
    // Not an error worth refusing over: the desired state already
    // holds, and a caller retrying should not be told off for it.
    return { status: 200, body: { taskId, released: false, note: "the task was not claimed" } };
  }

  const ownClaim = task.claimed_by === user.id;
  const mayManage = await hasPermission(db, user.id, "AP.TaskManage");

  if (!ownClaim && !mayManage) {
    return {
      status: 403,
      body: {
        error: "this task is claimed by somebody else",
        detail: "AP.TaskManage is required to release another person's claim",
      },
    };
  }

  await db
    .prepare("UPDATE tasks SET claimed_by = NULL, claimed_at = NULL WHERE id = ? AND claimed_by = ?")
    .bind(taskId, task.claimed_by)
    .run();

  // decision 0488: recorded against the person who took the action
  // (`user.id`) — a manager's override release is their own act, not
  // the previous holder's, the same distinction `releasedBy` already
  // draws in the response body below.
  await db
    .prepare("INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment) VALUES (?, ?, 'release', ?, ?, ?)")
    .bind(crypto.randomUUID(), taskId, user.id, new Date().toISOString(), comment ?? null)
    .run();

  return {
    status: 200,
    body: {
      taskId,
      released: true,
      // Who released it, and whose claim it was. **A person releasing
      // their own is a different act from a manager releasing
      // another's**, even though the effect is identical — and when
      // Sarah asks why her task moved, the answer needs both names.
      releasedBy: user.id,
      previousHolder: task.claimed_by,
      viaOverride: !ownClaim,
    },
  };
}

interface ReassignTaskRow {
  claimed_by: string | null;
  status: string;
  owner_team_id: string | null;
  required_permission: string;
}

/**
 * The same two-tier standing `handleReleaseTask` already checks:
 * holding the task yourself needs nothing further, and `AP.TaskManage`
 * is the override for anybody else's (or nobody's) claim. Shared by
 * the candidates listing and the reassign itself so the two can never
 * silently disagree about who is allowed to act.
 */
async function reassignStanding(
  db: D1Database,
  user: AuthenticatedUser,
  task: Pick<ReassignTaskRow, "claimed_by">
): Promise<{ ok: true; viaOverride: boolean } | { ok: false }> {
  const ownClaim = task.claimed_by === user.id;
  if (ownClaim) return { ok: true, viaOverride: false };
  const mayManage = await hasPermission(db, user.id, "AP.TaskManage");
  return mayManage ? { ok: true, viaOverride: true } : { ok: false };
}

/**
 * Who a task can be reassigned to, right now — decision 0489.
 *
 * **Computed by the server, not guessed by the client** — the same
 * discipline `task-list-route.ts`'s own `actionsFor` already applies
 * to which buttons appear at all. A member of the task's own team who
 * does not also hold its `required_permission` is not offered: naming
 * them here would just move the stuck-task problem this feature exists
 * to solve onto whoever picks them.
 */
export async function handleReassignCandidates(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await db
    .prepare("SELECT claimed_by, status, owner_team_id, required_permission FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<ReassignTaskRow>();
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (!task.owner_team_id) {
    return { status: 400, body: { error: "task is not team-owned — a named-user task cannot be reassigned" } };
  }

  const standing = await reassignStanding(db, user, task);
  if (!standing.ok) {
    return {
      status: 403,
      body: {
        error: task.claimed_by ? "this task is claimed by somebody else" : "claim this task before reassigning it",
        detail: "AP.TaskManage is required to reassign a task you do not hold",
      },
    };
  }

  const members = await db
    .prepare(
      `SELECT u.id, u.name, u.email
       FROM org_team_members m
       JOIN org_users u ON u.id = m.user_id
       WHERE m.team_id = ? AND u.id != ?
       ORDER BY u.name`
    )
    .bind(task.owner_team_id, task.claimed_by ?? "")
    .all<{ id: string; name: string; email: string }>();

  const candidates: { id: string; name: string; email: string }[] = [];
  for (const member of members.results) {
    if (await hasPermission(db, member.id, task.required_permission as Permission)) {
      candidates.push(member);
    }
  }

  return { status: 200, body: { candidates } };
}

/**
 * Reassign — decision 0489, the second step of the agreed Coding-pilot
 * sequence. Hands a task directly to a named colleague, rather than
 * releasing it back to the pool and waiting for somebody to pick it up.
 *
 * **The exact same two-tier permission model as `handleReleaseTask`
 * just above, not a new one.** Handing a task you hold to somebody
 * else is the same shape of act as letting go of it — the task's
 * ownership changes, its stage does not — so it earns the same
 * standing: your own claim needs nothing beyond holding it, and
 * `AP.TaskManage` is what lets a manager do it to a task somebody else
 * holds, or one nobody has claimed yet (permissions.ts's own comment
 * on `AP.TaskManage` says so directly).
 *
 * **The target must both belong to the task's own team, and hold the
 * task's own `required_permission`.** Team membership alone is not
 * enough — decision 0010's whole architecture keeps team membership
 * and permission-holding separate, and hand a Validation task to
 * somebody without `AP.Validate` would create exactly the stuck task
 * this feature exists to prevent, just for a different reason.
 */
export async function handleReassignTask(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser,
  targetUserId: string,
  comment?: string | null
): Promise<RouteResult> {
  const task = await db
    .prepare("SELECT claimed_by, status, owner_team_id, required_permission FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<ReassignTaskRow>();

  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.status !== "open") {
    return { status: 409, body: { error: `task ${taskId} is ${task.status}` } };
  }
  if (!task.owner_team_id) {
    return { status: 400, body: { error: "task is not team-owned — a named-user task cannot be reassigned" } };
  }

  const targetExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(targetUserId).first();
  if (!targetExists) {
    return { status: 404, body: { error: `user ${targetUserId} does not exist` } };
  }
  const targetOnTeam = await db
    .prepare("SELECT 1 FROM org_team_members WHERE team_id = ? AND user_id = ?")
    .bind(task.owner_team_id, targetUserId)
    .first();
  if (!targetOnTeam) {
    return { status: 400, body: { error: "the chosen user is not a member of the team that owns this task" } };
  }
  if (!(await hasPermission(db, targetUserId, task.required_permission as Permission))) {
    return {
      status: 400,
      body: { error: `the chosen user does not hold ${task.required_permission}, which this task requires` },
    };
  }

  const standing = await reassignStanding(db, user, task);
  if (!standing.ok) {
    return {
      status: 403,
      body: {
        error: task.claimed_by ? "this task is claimed by somebody else" : "claim this task before reassigning it",
        detail: "AP.TaskManage is required to reassign a task you do not hold",
      },
    };
  }

  const now = new Date().toISOString();
  // Atomic, and race-safe the same way claim/complete/release already
  // are: the WHERE clause matches the exact previous holder this
  // decision was checked against, not just the task id.
  const result = await db
    .prepare("UPDATE tasks SET claimed_by = ?, claimed_at = ? WHERE id = ? AND status = 'open' AND claimed_by IS ?")
    .bind(targetUserId, now, taskId, task.claimed_by)
    .run();
  if (result.meta.changes === 0) {
    return { status: 409, body: { error: "task changed underneath this action — try again" } };
  }

  // decision 0489: `target_user_id` is what lets the Timeline say who
  // it went to — the one fact this action carries that claim/release
  // do not.
  await db
    .prepare(
      "INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment, target_user_id) VALUES (?, ?, 'reassign', ?, ?, ?, ?)"
    )
    .bind(crypto.randomUUID(), taskId, user.id, now, comment ?? null, targetUserId)
    .run();

  return {
    status: 200,
    body: {
      taskId,
      reassignedBy: user.id,
      reassignedTo: targetUserId,
      previousHolder: task.claimed_by,
      viaOverride: standing.viaOverride,
    },
  };
}
