import type { RouteResult } from "./org-route.js";
import type { AuthenticatedUser } from "./user-auth.js";
import { hasPermission } from "./enforce.js";
import type { Permission } from "./permissions.js";
import { sendEmailViaResend } from "./resend-client.js";

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
 *     terminal state. **Decision 0498 supersedes this line's own last
 *     four words** — "the system sends nothing" was true from 0075
 *     until Return To Supplier gained a real, audited reason, a
 *     supplier-facing comment, and an actual email via Resend. See
 *     `handleReturnToSupplier`'s own doc comment below and
 *     `docs/decisions/SUPERSEDED.md`.
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
  returnedToStageId: string | null,
  // 'returned' or 'discarded'. Nothing goes back when a document is
  // discarded, and a task marked 'returned' would tell whoever reads it
  // later that somebody sent the invoice somewhere. Nobody did
  // (decision 0078).
  endStatus: "returned" | "discarded" = "returned"
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE tasks SET status = ?, ended_by = ?, ended_at = ?, end_reason = ?, returned_to_stage_id = ?
       WHERE id = ?`
    )
    .bind(endStatus, userId, now, reason, returnedToStageId, task.id)
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
        "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, ?, 'returned', strftime('%Y-%m-%d %H:%M:%f', 'now'))"
      )
      .bind(visitId, instance.id, stageId),
  ]);

  /**
   * **The target stage's own declared permission, not the returning
   * task's — decision 0490, a bug fixed in the same change that first
   * made Return reachable at all.** Every other path that creates a
   * task on stage entry resolves this the same way
   * (`workflow-engine.ts`'s own `requiredPermission ?? stage.required_
   * permission ?? params.permission`, decision 0471) — the stage a
   * task sits at governs who may act on it, never the stage it came
   * from. Falls back to the returning task's own permission only if
   * the target genuinely has none declared, the same last-resort this
   * codebase already uses elsewhere rather than leaving the column
   * null.
   */
  const targetStage = await db
    .prepare("SELECT required_permission FROM process_stages WHERE id = ?")
    .bind(stageId)
    .first<{ required_permission: string | null }>();
  const newTaskRequiredPermission = targetStage?.required_permission ?? task.required_permission;

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
      newTaskRequiredPermission
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

/**
 * Where a task can be returned to, right now — decision 0490.
 *
 * **The intersection of two different things, computed server-side —
 * the same "exactly what the POST will accept" discipline decision
 * 0489's own `handleReassignCandidates` already established.**
 * `stage_return_targets` is an operator's curated list of sensible
 * destinations for this stage; the visited-stage check inside
 * `handleReturnToStage` is the hard, load-bearing invariant (decision
 * 0075) that a target configured but never actually visited by *this*
 * document cannot be offered. Neither alone is the right list: every
 * configured target would let somebody attempt a return the POST
 * would then 422 on; every visited stage with no configured target
 * would ask a person to invent a team to assign it to, which is
 * exactly the gap this decision exists to close.
 */
export async function handleReturnTargets(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await loadOpenTask(db, taskId);
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };

  const standing = await checkStanding(db, user, task, "AP.Return");
  if (!standing.ok) return { status: standing.status, body: { error: standing.error } };

  const instance = await db
    .prepare(
      `SELECT pi.id FROM process_instances pi
       JOIN stage_visits v ON v.process_instance_id = pi.id
       WHERE v.id = ?`
    )
    .bind(task.stage_visit_id)
    .first<{ id: string }>();
  if (!instance) return { status: 200, body: { targets: [] } };

  const targets = await db
    .prepare(
      `SELECT rt.target_stage_id AS stage_id, ts.name AS stage_name, rt.team_id, tm.name AS team_name
       FROM stage_return_targets rt
       JOIN process_stages ts ON ts.id = rt.target_stage_id
       JOIN org_teams tm ON tm.id = rt.team_id
       JOIN stage_visits v ON v.process_instance_id = ? AND v.stage_id = rt.target_stage_id
       WHERE rt.source_stage_id = ?
       ORDER BY ts.name`
    )
    .bind(instance.id, task.stage_id)
    .all<{ stage_id: string; stage_name: string; team_id: string; team_name: string }>();

  return {
    status: 200,
    body: {
      targets: targets.results.map((r) => ({
        stageId: r.stage_id,
        stageName: r.stage_name,
        teamId: r.team_id,
        teamName: r.team_name,
      })),
    },
  };
}

export interface ReturnToSupplierBody {
  reasonId?: unknown;
  comment?: unknown;
  ccApTeam?: unknown;
}

/**
 * Config the caller resolves from `env` and hands in, the same
 * discipline `handleMintDocumentUrl`'s own `env.DOCUMENT_URL_SECRET`
 * parameter already follows — this file takes plain values, never the
 * `Env` object itself, so it stays testable without a Worker runtime.
 * Both null when Resend has not been configured for this deployment
 * yet (no `wrangler secret put RESEND_API_KEY`/`RESEND_FROM_ADDRESS`
 * var set) — the return still completes; only the email attempt is
 * skipped, recorded as `send_failed` with a plain reason rather than
 * silently pretending to have sent something.
 */
export interface OutboundEmailConfig {
  apiKey: string | null;
  fromAddress: string | null;
}

/**
 * The document leaves the process, and — decision 0498, superseding
 * decision 0055 section 5.3/7's own "the system sends nothing" for
 * this one specific claim — a real email now goes to the supplier.
 *
 * **Everything else about 0055 section 7 stands.** This is still an
 * instance-level terminal state (`returned_manually`), not a new stage
 * — that reasoning had nothing to do with whether an email got sent,
 * and nothing here changes it.
 *
 * **The terminal transition never depends on the email succeeding.**
 * Ending the task and the instance is the load-bearing act (decision
 * 0075's own "responsibility was taken"); the email is best-effort
 * reporting on top of it, in `supplier_return_emails`, one row per
 * attempt. A Resend outage, a missing address, or Resend not being
 * configured at all should never leave an invoice stuck partway
 * through a return — the same "a stuck workflow is worse than an
 * honest gap in the record" instinct 0055 itself was written from.
 */
export async function handleReturnToSupplier(
  db: D1Database,
  taskId: string,
  body: ReturnToSupplierBody,
  user: AuthenticatedUser,
  emailConfig: OutboundEmailConfig
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

  const { reasonId, comment, ccApTeam } = body;
  if (typeof reasonId !== "string" || !reasonId) {
    return { status: 400, body: { error: "reasonId is required" } };
  }
  if (comment !== undefined && typeof comment !== "string") {
    return { status: 400, body: { error: "comment, if present, must be a string" } };
  }
  if (ccApTeam !== undefined && typeof ccApTeam !== "boolean") {
    return { status: 400, body: { error: "ccApTeam, if present, must be a boolean" } };
  }
  const commentText = typeof comment === "string" && comment.trim() !== "" ? comment.trim() : null;

  const reasonRow = await db
    .prepare("SELECT id, label FROM supplier_return_reasons WHERE id = ? AND active = 1")
    .bind(reasonId)
    .first<{ id: string; label: string }>();
  if (!reasonRow) {
    return { status: 422, body: { error: `${reasonId} is not a recognised, active return reason` } };
  }

  const instance = await db
    .prepare(
      `SELECT pi.id, pi.status, pi.subject_id FROM process_instances pi
       JOIN stage_visits v ON v.process_instance_id = pi.id WHERE v.id = ?`
    )
    .bind(task.stage_visit_id)
    .first<{ id: string; status: string; subject_id: string }>();
  if (!instance) return { status: 409, body: { error: "this task is not attached to a process instance" } };
  if (instance.status !== "in_progress") {
    return { status: 409, body: { error: `process instance ${instance.id} is already ${instance.status}` } };
  }

  await endTaskAndSiblings(db, task, user.id, reasonRow.label, null);

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE process_instances
       SET status = 'returned_manually', ended_by = ?, ended_at = ?, end_reason = ?,
           return_reason_id = ?, supplier_comment = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(user.id, now, reasonRow.label, reasonRow.id, commentText, now, instance.id)
    .run();

  const emailOutcome = await attemptSupplierEmail(db, {
    instanceId: instance.id,
    invoiceId: instance.subject_id,
    taskId: task.id,
    reasonLabel: reasonRow.label,
    comment: commentText,
    ccApTeam: ccApTeam === true,
    createdBy: user.id,
    emailConfig,
  });

  return {
    status: 200,
    body: {
      returnedTask: task.id,
      returnedBy: user.id,
      viaOverride: standing.viaOverride,
      instanceId: instance.id,
      instanceStatus: "returned_manually",
      reasonId: reasonRow.id,
      reason: reasonRow.label,
      comment: commentText,
      email: emailOutcome,
    },
  };
}

interface AttemptSupplierEmailArgs {
  instanceId: string;
  invoiceId: string;
  taskId: string;
  reasonLabel: string;
  comment: string | null;
  ccApTeam: boolean;
  createdBy: string;
  emailConfig: OutboundEmailConfig;
}

interface SupplierEmailOutcome {
  attempted: boolean;
  status: "queued" | "sent" | "send_failed";
  detail: string | null;
  toAddress: string | null;
  ccAddress: string | null;
}

/**
 * Best-effort, and recorded either way. `supplier_return_emails` gets
 * exactly one row from this function every time it runs — there is no
 * path through here that ends the return without also leaving a
 * record of what was, or was not, attempted about the email.
 */
async function attemptSupplierEmail(
  db: D1Database,
  args: AttemptSupplierEmailArgs
): Promise<SupplierEmailOutcome> {
  const supplier = await db
    .prepare(
      `SELECT s.id, s.email FROM invoice_headers h
       JOIN suppliers s ON s.id = h.supplier_id
       WHERE h.id = ?`
    )
    .bind(args.invoiceId)
    .first<{ id: string; email: string | null }>();

  const toAddress = supplier?.email ?? null;
  let ccAddress: string | null = null;
  if (args.ccApTeam) {
    const settings = await db
      .prepare("SELECT ap_team_email FROM org_settings WHERE id = 1")
      .first<{ ap_team_email: string | null }>();
    ccAddress = settings?.ap_team_email ?? null;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const subject = `Invoice returned — ${args.reasonLabel}`;
  const bodyLines = [
    `This invoice has been returned to you.`,
    ``,
    `Reason: ${args.reasonLabel}`,
    ...(args.comment ? [``, args.comment] : []),
  ];
  const text = bodyLines.join("\n");

  if (!toAddress) {
    await db
      .prepare(
        `INSERT INTO supplier_return_emails
           (id, process_instance_id, task_id, supplier_id, to_address, cc_address, subject, body,
            status, status_detail, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'send_failed', ?, ?, ?)`
      )
      .bind(
        id,
        args.instanceId,
        args.taskId,
        supplier?.id ?? null,
        "",
        ccAddress,
        subject,
        text,
        "no email address on file for this supplier",
        args.createdBy,
        now
      )
      .run();
    return { attempted: false, status: "send_failed", detail: "no email address on file for this supplier", toAddress: null, ccAddress };
  }

  if (!args.emailConfig.apiKey || !args.emailConfig.fromAddress) {
    await db
      .prepare(
        `INSERT INTO supplier_return_emails
           (id, process_instance_id, task_id, supplier_id, to_address, cc_address, subject, body,
            status, status_detail, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'send_failed', ?, ?, ?)`
      )
      .bind(
        id,
        args.instanceId,
        args.taskId,
        supplier?.id ?? null,
        toAddress,
        ccAddress,
        subject,
        text,
        "email sending is not configured for this deployment",
        args.createdBy,
        now
      )
      .run();
    return {
      attempted: false,
      status: "send_failed",
      detail: "email sending is not configured for this deployment",
      toAddress,
      ccAddress,
    };
  }

  const result = await sendEmailViaResend(args.emailConfig.apiKey, {
    from: args.emailConfig.fromAddress,
    to: toAddress,
    cc: ccAddress,
    subject,
    text,
  });

  if (result.ok) {
    await db
      .prepare(
        `INSERT INTO supplier_return_emails
           (id, process_instance_id, task_id, supplier_id, to_address, cc_address, subject, body,
            provider_message_id, status, created_by, created_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)`
      )
      .bind(
        id,
        args.instanceId,
        args.taskId,
        supplier?.id ?? null,
        toAddress,
        ccAddress,
        subject,
        text,
        result.messageId,
        args.createdBy,
        now,
        now
      )
      .run();
    return { attempted: true, status: "sent", detail: null, toAddress, ccAddress };
  }

  await db
    .prepare(
      `INSERT INTO supplier_return_emails
         (id, process_instance_id, task_id, supplier_id, to_address, cc_address, subject, body,
          status, status_detail, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'send_failed', ?, ?, ?)`
    )
    .bind(id, args.instanceId, args.taskId, supplier?.id ?? null, toAddress, ccAddress, subject, text, result.error, args.createdBy, now)
    .run();
  return { attempted: true, status: "send_failed", detail: result.error, toAddress, ccAddress };
}

export interface DiscardBody {
  reason?: unknown;
}

/**
 * Discarding — decision 0078. The instance reaches `archived`.
 *
 * Deliberately a different terminal state from `returned_manually`
 * (decision 0055 section 5.4), and the difference is what a queue is
 * for: **"somebody is dealing with this"** and **"nothing further is
 * needed"** are different answers to the open-items question.
 *
 * A duplicate, a statement that is not an invoice, a scan of somebody's
 * lunch receipt — these are closed, not pending contact with anybody.
 *
 * Never a deletion. The invoice row, its facts, its retained original
 * and every task that touched it all remain; only the instance stops
 * being somebody's problem. A regulated system that lets a person
 * delete a document has lost the argument before it starts.
 */
export async function handleDiscard(
  db: D1Database,
  taskId: string,
  body: DiscardBody,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await loadOpenTask(db, taskId);
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.status !== "open") {
    return { status: 409, body: { error: `task ${taskId} is already ${task.status}` } };
  }

  // Same shape as returning to a supplier: the capability, the stage's
  // own permission, and holding the task — with AP.ReturnAny overriding
  // ownership only.
  const standing = await checkStanding(db, user, task, "AP.Discard");
  if (!standing.ok) return { status: standing.status, body: { error: standing.error } };

  const { reason } = body;
  if (typeof reason !== "string" || reason.trim() === "") {
    // "Nobody needs to look at this again" is a claim that should carry
    // an explanation, precisely because nobody will look again.
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

  await endTaskAndSiblings(db, task, user.id, reason.trim(), null, "discarded");

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE process_instances
       SET status = 'archived', ended_by = ?, ended_at = ?, end_reason = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(user.id, now, reason.trim(), now, instance.id)
    .run();

  return {
    status: 200,
    body: {
      discardedTask: task.id,
      discardedBy: user.id,
      viaOverride: standing.viaOverride,
      instanceId: instance.id,
      instanceStatus: "archived",
      reason: reason.trim(),
      note: "nothing was deleted — the invoice, its document and its history all remain",
    },
  };
}
