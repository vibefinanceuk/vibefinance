import type { RouteResult } from "./org-route.js";
import type { AuthenticatedUser } from "./user-auth.js";
import { hasPermission } from "./enforce.js";
import type { Permission } from "./permissions.js";

/**
 * Returning a document — decision 0075.
 *
 * Decision 0064 recorded that a task cannot complete negatively, and
 * that send-back therefore does not exist in any form. This is the
 * behavioural half of the answer; migration 0031 is the schema half.
 *
 * Two capabilities that share a word and almost nothing else:
 *
 *   - **to a stage** — backwards, to somewhere already visited, with a
 *     task for a named person. The document comes forward again.
 *   - **to the supplier** — out of the process entirely, into a
 *     terminal state. The system sends nothing.
 */

interface TaskRow {
  id: string;
  stage_id: string;
  stage_visit_id: string | null;
  required_permission: string;
  status: string;
  claimed_by: string | null;
  owner_user_id: string | null;
  owner_team_id: string | null;
}

/**
 * Whether this person may act on this task.
 *
 * `AP.ReturnAny` short-circuits both conditions: overriding ownership
 * across stages is the point of a manager permission, and demanding the
 * stage permission as well would leave a manager unable to unstick an
 * Approval queue — the situation it exists for.
 */
async function checkStanding(
  db: D1Database,
  user: AuthenticatedUser,
  task: TaskRow,
  capability: Permission
): Promise<{ ok: true; viaOverride: boolean } | { ok: false; status: number; error: string }> {
  if (!(await hasPermission(db, user.id, capability))) {
    return { ok: false, status: 403, error: `${capability} is required` };
  }

  if (await hasPermission(db, user.id, "AP.ReturnAny")) {
    return { ok: true, viaOverride: true };
  }

  // Standing where you already have it: the task's own
  // required_permission, so there is no second notion of where somebody
  // belongs.
  if (!(await hasPermission(db, user.id, task.required_permission as Permission))) {
    return {
      ok: false,
      status: 403,
      error: `this task requires ${task.required_permission}, which you do not hold`,
    };
  }

  // And you must hold the task. Otherwise two people act on one
  // document and the other's work vanishes underneath them.
  const holder = task.claimed_by ?? task.owner_user_id;
  if (holder !== user.id) {
    return {
      ok: false,
      status: 403,
      error: holder
        ? "this task is held by somebody else — AP.ReturnAny is required to act on it"
        : "claim this task before returning it",
    };
  }
  return { ok: true, viaOverride: false };
}

async function loadOpenTask(db: D1Database, taskId: string): Promise<TaskRow | null> {
  return db
    .prepare(
      `SELECT id, stage_id, stage_visit_id, required_permission, status,
              claimed_by, owner_user_id, owner_team_id
       FROM tasks WHERE id = ?`
    )
    .bind(taskId)
    .first<TaskRow>();
}

/**
 * Ends the returner's task and cancels its siblings.
 *
 * Siblings are cancelled rather than left open because parallel
 * approvers make them genuinely moot: if one of three returns the
 * invoice, the other two cannot be completed against a document that is
 * no longer at that stage. Moot is not abandoned, which is why
 * `cancelled` is its own state rather than a second `returned`.
 */
async function endTaskAndSiblings(
  db: D1Database,
  task: TaskRow,
  userId: string,
  reason: string,
  returnedToStageId: string | null
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks SET status = 'returned', ended_by = ?, ended_at = ?, end_reason = ?, returned_to_stage_id = ?
       WHERE id = ?`
    )
    .bind(userId, now, reason, returnedToStageId, task.id)
    .run();

  if (task.stage_visit_id) {
    await db
      .prepare(
        `UPDATE tasks SET status = 'cancelled', ended_by = ?, ended_at = ?,
                end_reason = 'the document was returned from this stage'
         WHERE stage_visit_id = ? AND id != ? AND status = 'open'`
      )
      .bind(userId, now, task.stage_visit_id, task.id)
      .run();
  }
}

export interface ReturnToStageBody {
  stageId?: unknown;
  reason?: unknown;
  assignToUser?: unknown;
  assignToTeam?: unknown;
}

export async function handleReturnToStage(
  db: D1Database,
  taskId: string,
  body: ReturnToStageBody,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await loadOpenTask(db, taskId);
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.status !== "open") {
    return { status: 409, body: { error: `task ${taskId} is already ${task.status}` } };
  }

  const standing = await checkStanding(db, user, task, "AP.Return");
  if (!standing.ok) return { status: standing.status, body: { error: standing.error } };

  const { stageId, reason, assignToUser, assignToTeam } = body;
  if (typeof stageId !== "string" || !stageId) {
    return { status: 400, body: { error: "stageId is required" } };
  }
  // Required, not optional: a return with no reason leaves the next
  // person guessing, and the field costs nothing.
  if (typeof reason !== "string" || reason.trim() === "") {
    return { status: 400, body: { error: "reason is required — the next person needs to know what to fix" } };
  }
  const hasUser = typeof assignToUser === "string" && assignToUser !== "";
  const hasTeam = typeof assignToTeam === "string" && assignToTeam !== "";
  if (hasUser === hasTeam) {
    return { status: 400, body: { error: "exactly one of assignToUser or assignToTeam is required" } };
  }

  const instance = await db
    .prepare(
      `SELECT pi.id, pi.status, pi.process_id
       FROM process_instances pi
       JOIN stage_visits v ON v.process_instance_id = pi.id
       WHERE v.id = ?`
    )
    .bind(task.stage_visit_id)
    .first<{ id: string; status: string; process_id: string }>();
  if (!instance) return { status: 409, body: { error: "this task is not attached to a process instance" } };
  if (instance.status !== "in_progress") {
    return { status: 409, body: { error: `process instance ${instance.id} is already ${instance.status}` } };
  }

  // Only stages this instance has ACTUALLY visited. Not the stages
  // defined for the process: route_to lets a rule skip ahead, and
  // returning a document to a stage it has never been through would be
  // sending it somewhere new while calling it a return.
  const visited = await db
    .prepare(
      `SELECT 1 FROM stage_visits WHERE process_instance_id = ? AND stage_id = ? AND stage_id != ? LIMIT 1`
    )
    .bind(instance.id, stageId, task.stage_id)
    .first();
  if (!visited) {
    return {
      status: 422,
      body: {
        error: `this document has not been through stage ${stageId}`,
        detail: "a document can only be returned to a stage it has actually visited",
      },
    };
  }

  await endTaskAndSiblings(db, task, user.id, reason.trim(), stageId);

  // Move the instance back, and record the visit. The target stage's
  // rules are deliberately NOT re-evaluated: a return is an instruction,
  // and re-running them would produce whatever they decide plus the task
  // the returner assigned — two tasks for one problem.
  const now = new Date().toISOString();
  const visitId = crypto.randomUUID();
  await db.batch([
    db
      .prepare("UPDATE process_instances SET current_stage_id = ?, updated_at = ? WHERE id = ?")
      .bind(stageId, now, instance.id),
    db
      .prepare(
        "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'returned')"
      )
      .bind(visitId, instance.id, stageId),
  ]);

  const newTaskId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, required_permission)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      newTaskId,
      stageId,
      visitId,
      hasUser ? (assignToUser as string) : null,
      hasTeam ? (assignToTeam as string) : null,
      task.required_permission
    )
    .run();

  return {
    status: 200,
    body: {
      returnedTask: task.id,
      returnedBy: user.id,
      viaOverride: standing.viaOverride,
      instanceId: instance.id,
      returnedToStage: stageId,
      reason: reason.trim(),
      newTaskId,
    },
  };
}

export interface ReturnToSupplierBody {
  reason?: unknown;
}

/**
 * The document leaves the process.
 *
 * **The system sends nothing.** Decision 0055 section 5.3 records why: a
 * genuine return path belongs to the source instance rather than the
 * document — an email arrival has a sender, an SFTP drop may have only
 * a filename — so making the capability conditional on arrival mechanism
 * would mean it working differently depending on configuration a user
 * cannot see.
 *
 * This records that a person took responsibility, and the contact
 * happens outside. A button claiming to email a supplier and sometimes
 * unable to is worse than an honest record.
 */
export async function handleReturnToSupplier(
  db: D1Database,
  taskId: string,
  body: ReturnToSupplierBody,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await loadOpenTask(db, taskId);
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.status !== "open") {
    return { status: 409, body: { error: `task ${taskId} is already ${task.status}` } };
  }

  // AP.ReturnAny overrides ownership, NOT destination — the terminal act
  // always requires somebody to hold the terminal permission, manager or
  // not.
  const standing = await checkStanding(db, user, task, "AP.ReturnToSupplier");
  if (!standing.ok) return { status: standing.status, body: { error: standing.error } };

  const { reason } = body;
  if (typeof reason !== "string" || reason.trim() === "") {
    return { status: 400, body: { error: "reason is required" } };
  }

  const instance = await db
    .prepare(
      `SELECT pi.id, pi.status FROM process_instances pi
       JOIN stage_visits v ON v.process_instance_id = pi.id WHERE v.id = ?`
    )
    .bind(task.stage_visit_id)
    .first<{ id: string; status: string }>();
  if (!instance) return { status: 409, body: { error: "this task is not attached to a process instance" } };
  if (instance.status !== "in_progress") {
    return { status: 409, body: { error: `process instance ${instance.id} is already ${instance.status}` } };
  }

  await endTaskAndSiblings(db, task, user.id, reason.trim(), null);

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE process_instances
       SET status = 'returned_manually', ended_by = ?, ended_at = ?, end_reason = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(user.id, now, reason.trim(), now, instance.id)
    .run();

  return {
    status: 200,
    body: {
      returnedTask: task.id,
      returnedBy: user.id,
      viaOverride: standing.viaOverride,
      instanceId: instance.id,
      instanceStatus: "returned_manually",
      reason: reason.trim(),
      note: "the system has sent nothing — contact with the supplier happens outside it",
    },
  };
}
