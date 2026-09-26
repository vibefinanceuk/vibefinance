import { nextStageInSequence } from "./workflow-engine.js";
import { loadApprovalConfig } from "./approval-hierarchy.js";
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
              s.process_id, s.sequence, pi.process_version
       FROM tasks t
       JOIN process_stages s ON s.id = t.stage_id
       LEFT JOIN stage_visits v ON v.id = t.stage_visit_id
       LEFT JOIN process_instances pi ON pi.id = v.process_instance_id
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
   * **Every org-wide holder of the next stage's own permission, not
   * team-scoped** — decided directly with the operator: Manual mode
   * has no hierarchy or unit to scope a walk by (that is the whole
   * reason a human is choosing at all), so the candidate list is
   * everyone who could complete the resulting task, the same answer a
   * customer relying on a single Default Approver already gets today,
   * just let a person choose which one this time.
   *
   * **One `json_each` membership test, not per-user `hasPermission`
   * calls** — `enforce.ts`'s own `hasPermission` walks unit-scoped
   * overrides that do not apply here (no unit is named), so reusing it
   * would mean discarding most of what it computes. This is the same
   * `IN (SELECT value FROM json_each(?))` shape `task-list-route.ts`
   * already uses for matching a precomputed set.
   */
  const candidates = await db
    .prepare(
      `SELECT DISTINCT u.id, u.name, u.email
       FROM org_users u
       JOIN org_user_roles ur ON ur.user_id = u.id
       JOIN org_roles r ON r.id = ur.role_id
       WHERE EXISTS (SELECT 1 FROM json_each(r.permissions_json) je WHERE je.value = ?)
       ORDER BY u.name`
    )
    .bind(next.required_permission)
    .all<{ id: string; name: string; email: string }>();

  return { status: 200, body: { candidates: candidates.results } };
}
