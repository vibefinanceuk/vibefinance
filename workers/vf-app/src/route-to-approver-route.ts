import { nextStageInSequence } from "./workflow-engine.js";
import { loadApprovalConfig, resolveApprovalLimit } from "./approval-hierarchy.js";
import { unitLineage } from "./unit-config.js";
import type { RouteResult } from "./org-route.js";
import type { AuthenticatedUser } from "./user-auth.js";

/**
 * Route To Approver — decision 0495, the last of the agreed
 * Coding-pilot sequence's five items.
 *
 * **A separate file, not folded into `task-route.ts`.** `task-route.ts`
 * cannot import from `workflow-engine.ts` — the engine already imports
 * `handleCreateTask` the other way (`task-route.ts`'s own comment on
 * `handleCompleteTask`'s completion cascade explains why: it would be
 * a circular import). This route needs `nextStageInSequence` from the
 * engine directly, so it lives beside it instead, the same
 * one-purpose-per-file shape `stage-return-targets-route.ts` and
 * `approval-config-route.ts` already use.
 *
 * **What this decides, restated in the operator's own words**: *"Route
 * to Approver should allow manual selection of an approver, if the AP
 * Setup Approval Hierarchy is set to Manual. Otherwise, no selection
 * of an approver, and follow the employee-supervisor or cost-center
 * model."* Concretely: completing a task never gets a manual picker
 * unless BOTH (a) the very next stage in this instance's own process
 * version is one that resolves through Approval Hierarchy at all
 * (`uses_approval_hierarchy`), and (b) the org is actually configured
 * for Manual routing right now. Neither condition is inferred by the
 * client — this route answers both, the same "computed by the server"
 * discipline `task-list-route.ts`'s own `actionsFor` and Reassign's
 * `handleReassignCandidates` already follow, and `task-list-route.ts`
 * asks this same question (see its own `routeToApproverOffered`
 * helper) to decide whether to offer the button at all.
 *
 * **Where the choice actually lands.** There is no new "route to
 * approver" verb at the workflow-engine level — automatic Approval
 * Hierarchy resolution happens exactly once, synchronously, the
 * moment THIS task is completed (see `workflow-engine.ts`'s own
 * `visitCurrentStage` doc comment on `manualApproverUserId` for the
 * full call chain traced before this was built). So a candidate
 * chosen here is submitted back through the ordinary `POST
 * /tasks/:id/complete` — as `targetUserId`, the same field name
 * Reassign already uses for the same idea — not a second route that
 * completes the task itself.
 */
export async function handleRouteToApproverCandidates(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser
): Promise<RouteResult> {
  const task = await db
    .prepare(
      `SELECT t.owner_user_id, t.claimed_by, t.completed_by,
              s.process_id, s.sequence, pi.process_version, h.org_unit_id
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h
         ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.id = ?`
    )
    .bind(taskId)
    .first<{
      owner_user_id: string | null;
      claimed_by: string | null;
      completed_by: string | null;
      process_id: string | null;
      sequence: number | null;
      process_version: number | null;
      org_unit_id: string | null;
    }>();
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.completed_by) {
    return { status: 409, body: { error: "task is already completed" } };
  }

  // The identical standing `handleCompleteTask` itself requires —
  // choosing a candidate here is only ever a prelude to completing
  // this exact task, so whoever may not complete it may not see who
  // they could route it to either.
  if (task.owner_user_id) {
    if (task.owner_user_id !== user.id) {
      return { status: 403, body: { error: "only the assigned user may complete this task" } };
    }
  } else {
    if (!task.claimed_by) {
      return { status: 409, body: { error: "this task must be claimed before it can be completed" } };
    }
    if (task.claimed_by !== user.id) {
      return { status: 403, body: { error: "only the user who claimed this task may complete it" } };
    }
  }

  if (task.process_id === null || task.sequence === null || task.process_version === null) {
    return { status: 400, body: { error: "this task is not part of a running process instance" } };
  }

  /**
   * **Re-routing from the Approval task itself — decision 0517.** The
   * operator's Manual definition: *"The selected user needs approval
   * limit to approve the document, and if that is not the case the
   * selected user needs to select freely among the users in the
   * company."* When this task *is* the Approval task, and its person's
   * limit does not cover the invoice, the picker lists who they can hand
   * it on to. It is the same list (0512 org scoping, 0513 exclusions),
   * minus themselves. `reroute: true` tells the screen to post to the
   * re-route route rather than `/complete`.
   */
  const reroute = await rerouteContext(db, taskId, user.id);
  if (reroute) {
    const excluded = await excludedApprovers(db, taskId, await loadApprovalConfig(db));
    const candidates = (await approverCandidates(db, reroute.permission, reroute.orgUnitId)).filter(
      (c) => !excluded.has(c.id) && c.id !== user.id
    );
    return {
      status: 200,
      body: {
        candidates,
        reroute: true,
        limit: reroute.limit,
        amount: reroute.amount,
        currency: reroute.currency,
      },
    };
  }

  const next = await nextStageInSequence(db, task.process_id, task.sequence, task.process_version);
  if (!next || !next.uses_approval_hierarchy) {
    return {
      status: 400,
      body: { error: "completing this task does not lead to a stage that resolves through Approval Hierarchy" },
    };
  }

  const config = await loadApprovalConfig(db);
  if (config.mode !== "manual") {
    return {
      status: 400,
      body: { error: `Approval Hierarchy is not set to Manual (it is currently ${config.mode})` },
    };
  }

  if (!next.required_permission) {
    return { status: 400, body: { error: `stage ${next.id} declares no required_permission to route to` } };
  }

  /**
   * **Not team-scoped** — decided directly with the operator at 0495:
   * Manual mode has no hierarchy to walk, so the list is everyone who
   * could complete the resulting task. **Scoped to the invoice's own
   * org since decision 0512** — "could complete" was always the test,
   * and completing checks the org (see `approverCandidates`).
   */
  const excluded = await excludedApprovers(db, taskId, config);
  const candidates = (await approverCandidates(db, next.required_permission, task.org_unit_id)).filter(
    (c) => !excluded.has(c.id)
  );

  return { status: 200, body: { candidates } };
}

/**
 * **Who may approve this invoice, not who may approve anywhere** —
 * decision 0512.
 *
 * 0495's own query took every holder of the permission org-wide and
 * ignored *where* they hold it. But a role is held at a unit (decision
 * 0199, migration 0047), and completing a task checks the permission at
 * the invoice's own unit (decision 0203, `index.ts`'s complete route).
 * So somebody who is an approver only at Acme DE was offered for an
 * Acme UK invoice, and the Approval task then sat with a person who
 * could never complete it.
 *
 * **The same answer `hasPermission` gives, for everyone at once**: a
 * role held with no unit counts everywhere; a role held at the
 * invoice's unit or anything above it counts; and an invoice not placed
 * in any unit asks "at all", exactly as `hasPermission(…, null)` does.
 * One query rather than a `hasPermission` call per person.
 */
export async function approverCandidates(
  db: D1Database,
  permission: string,
  invoiceUnitId: string | null
): Promise<{ id: string; name: string; email: string }[]> {
  const lineage = invoiceUnitId ? await unitLineage(db, invoiceUnitId) : null;
  const rows = await db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM org_users u
       JOIN org_user_roles ur ON ur.user_id = u.id
       JOIN org_roles r ON r.id = ur.role_id
       WHERE EXISTS (SELECT 1 FROM json_each(r.permissions_json) je WHERE je.value = ?1)
         AND (?2 IS NULL OR ur.unit_id IS NULL OR ur.unit_id IN (SELECT value FROM json_each(?2)))
       ORDER BY u.name`
    )
    .bind(permission, lineage ? JSON.stringify(lineage) : null)
    .all<{ id: string; name: string; email: string }>();
  return rows.results;
}

/**
 * **The server's own check on a chosen approver** — decision 0512.
 *
 * `POST /tasks/:id/complete` accepted any `targetUserId` that existed
 * (0495's resolver checked existence and nothing else), so the picker
 * was the only thing standing between a request and routing an
 * approval to anybody at all — the screen-not-route gap decision 0144
 * names. Called before the task is completed, so a refused choice
 * leaves nothing half-done.
 *
 * **Only where Route To Approver actually applies** — the next stage
 * resolves through Approval Hierarchy and the org is on Manual. Anywhere
 * else a stray `targetUserId` stays exactly as 0495 left it: never read,
 * never refused.
 */
export async function checkChosenApprover(
  db: D1Database,
  taskId: string,
  targetUserId: string
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const task = await db
    .prepare(
      `SELECT s.process_id, s.sequence, pi.process_version, h.org_unit_id
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN invoice_headers h
         ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.id = ?`
    )
    .bind(taskId)
    .first<{ process_id: string | null; sequence: number | null; process_version: number | null; org_unit_id: string | null }>();
  if (!task || task.process_id === null || task.sequence === null || task.process_version === null) return { ok: true };

  const next = await nextStageInSequence(db, task.process_id, task.sequence, task.process_version);
  if (!next || !next.uses_approval_hierarchy || !next.required_permission) return { ok: true };
  const config = await loadApprovalConfig(db);
  if (config.mode !== "manual") return { ok: true };

  const excluded = await excludedApprovers(db, taskId, config);
  if (excluded.has(targetUserId)) {
    return {
      status: 422,
      ok: false,
      error: `${targetUserId} cannot approve this invoice: AP Setup excludes the person who validated or coded it`,
    };
  }
  const candidates = await approverCandidates(db, next.required_permission, task.org_unit_id);
  if (candidates.some((c) => c.id === targetUserId)) return { ok: true };
  return {
    status: 422,
    ok: false,
    error: `${targetUserId} cannot approve this invoice: they do not hold ${next.required_permission} for its org`,
  };
}

/**
 * **Who AP Setup excludes from approving this invoice — decision 0513.**
 *
 * The operator's own two options, *"Exclude Validation User from
 * Approval of Invoices"* and *"Exclude Coding User from Approval of
 * Invoices"*. Reported live: the person who coded an invoice picked
 * themselves as its approver.
 *
 * A **Validation user** is anyone who completed a task needing
 * `AP.Validate` on this invoice. A **Coding user** is the same for
 * `AP.Code`. The task being completed right now counts too, through
 * its owner or claimer, because Route To Approver *is* its completion.
 * A stage is recognised by the permission its tasks carry (decision
 * 0200), not by its id, since stage ids are the customer's own
 * choice.
 */
async function excludedApprovers(
  db: D1Database,
  taskId: string,
  config: { excludeValidationUserFromApproval: boolean; excludeCodingUserFromApproval: boolean }
): Promise<Set<string>> {
  const permissions = [
    ...(config.excludeValidationUserFromApproval ? ["AP.Validate"] : []),
    ...(config.excludeCodingUserFromApproval ? ["AP.Code"] : []),
  ];
  if (permissions.length === 0) return new Set();

  const rows = await db
    .prepare(
      `WITH subject AS (
         SELECT pi.subject_type, pi.subject_id
         FROM tasks t
         JOIN stage_visits v ON v.id = t.stage_visit_id
         JOIN process_instances pi ON pi.id = v.process_instance_id
         WHERE t.id = ?1
       )
       SELECT t.completed_by AS user_id
       FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN subject s ON s.subject_type = pi.subject_type AND s.subject_id = pi.subject_id
       WHERE t.completed_by IS NOT NULL
         AND t.required_permission IN (SELECT value FROM json_each(?2))
       UNION
       SELECT COALESCE(t.claimed_by, t.owner_user_id) AS user_id
       FROM tasks t
       WHERE t.id = ?1
         AND t.required_permission IN (SELECT value FROM json_each(?2))`
    )
    .bind(taskId, JSON.stringify(permissions))
    .all<{ user_id: string | null }>();
  return new Set(rows.results.map((r) => r.user_id).filter((id): id is string => !!id));
}

interface RerouteContext {
  permission: string;
  orgUnitId: string | null;
  limit: number | null;
  amount: number | null;
  currency: string | null;
}

/**
 * **Is this an Approval task whose own person may not approve it —
 * decision 0517.** `null` unless all of these hold:
 *
 * - the task's own stage resolves through Approval Hierarchy and
 *   declares a permission;
 * - the org is on Manual;
 * - this person's approval limit, at the invoice's unit and in its
 *   currency, does not cover the invoice total.
 *
 * "Covers" is read exactly as Employee-Supervisor reads it
 * (`resolveEmployeeSupervisor`, decision 0439). No limit recorded means
 * no authority. An invoice with no total is covered by any limit at
 * all. The total is the header's (`total_with_vat`, BT-112), because a
 * Manual approval is of the document, not of one line.
 */
export async function rerouteContext(db: D1Database, taskId: string, userId: string): Promise<RerouteContext | null> {
  const task = await db
    .prepare(
      `SELECT s.uses_approval_hierarchy, s.required_permission, h.org_unit_id, h.currency, h.total_with_vat
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       JOIN invoice_headers h ON pi.subject_type = 'invoice' AND h.id = pi.subject_id
       WHERE t.id = ? AND t.status = 'open'`
    )
    .bind(taskId)
    .first<{
      uses_approval_hierarchy: number | null;
      required_permission: string | null;
      org_unit_id: string | null;
      currency: string | null;
      total_with_vat: number | null;
    }>();
  if (!task || !task.uses_approval_hierarchy || !task.required_permission) return null;
  if ((await loadApprovalConfig(db)).mode !== "manual") return null;

  const limit = task.currency ? await resolveApprovalLimit(db, userId, task.org_unit_id, task.currency) : null;
  const covered = limit !== null && (task.total_with_vat === null || task.total_with_vat <= limit);
  if (covered) return null;
  return {
    permission: task.required_permission,
    orgUnitId: task.org_unit_id,
    limit,
    amount: task.total_with_vat,
    currency: task.currency,
  };
}

/**
 * **Hand an Approval task on to somebody else — decision 0517.**
 *
 * Only allowed for the task's own person, and only when
 * `rerouteContext` says their limit does not cover the invoice. The
 * target must be someone the picker would offer. The **same task**
 * changes hands: `owner_user_id` becomes the target, and any team or
 * claim is cleared. The stage visit, and so the invoice's place at
 * Approval, is untouched, which is why nothing cascades. A new task
 * would have meant completing this one, and completing the last open
 * task at a stage advances the invoice.
 *
 * It is recorded as a `route_to_approver` task action event, the same
 * row the first Route To Approver writes (decisions 0488, 0497), so the
 * Timeline shows every hand-off with its comment.
 */
export async function handleRerouteApprover(
  db: D1Database,
  taskId: string,
  user: AuthenticatedUser,
  body: { targetUserId?: unknown; comment?: unknown }
): Promise<RouteResult> {
  const task = await db
    .prepare("SELECT owner_user_id, claimed_by, status FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ owner_user_id: string | null; claimed_by: string | null; status: string }>();
  if (!task) return { status: 404, body: { error: `task ${taskId} does not exist` } };
  if (task.status !== "open") return { status: 409, body: { error: `task ${taskId} is already ${task.status}` } };
  if (task.owner_user_id !== user.id && task.claimed_by !== user.id) {
    return { status: 403, body: { error: "only the person this task belongs to may route it on" } };
  }

  const { targetUserId, comment } = body;
  if (typeof targetUserId !== "string" || !targetUserId) {
    return { status: 400, body: { error: "targetUserId (a string) is required" } };
  }
  if (comment !== undefined && comment !== null && typeof comment !== "string") {
    return { status: 400, body: { error: "comment, if provided, must be a string" } };
  }

  const reroute = await rerouteContext(db, taskId, user.id);
  if (!reroute) {
    return {
      status: 409,
      body: { error: "this task is not an Approval task you need to route on", reason: "reroute_not_applicable" },
    };
  }

  const excluded = await excludedApprovers(db, taskId, await loadApprovalConfig(db));
  const candidates = await approverCandidates(db, reroute.permission, reroute.orgUnitId);
  if (targetUserId === user.id || excluded.has(targetUserId) || !candidates.some((c) => c.id === targetUserId)) {
    return {
      status: 422,
      body: { error: `${targetUserId} cannot approve this invoice`, reason: "approver_not_eligible" },
    };
  }

  const now = new Date().toISOString();
  const trimmed = typeof comment === "string" && comment.trim() ? comment.trim() : null;
  await db.batch([
    db
      .prepare("UPDATE tasks SET owner_user_id = ?, owner_team_id = NULL, claimed_by = NULL, claimed_at = NULL WHERE id = ? AND status = 'open'")
      .bind(targetUserId, taskId),
    db
      .prepare(
        "INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment, target_user_id) VALUES (?, ?, 'route_to_approver', ?, ?, ?, ?)"
      )
      .bind(crypto.randomUUID(), taskId, user.id, now, trimmed, targetUserId),
  ]);

  return { status: 200, body: { id: taskId, ownerUserId: targetUserId } };
}
