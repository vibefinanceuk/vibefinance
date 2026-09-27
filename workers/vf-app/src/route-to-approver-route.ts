import { nextStageInSequence } from "./workflow-engine.js";
import { loadApprovalConfig } from "./approval-hierarchy.js";
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
  const candidates = await approverCandidates(db, next.required_permission, task.org_unit_id);

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
  if ((await loadApprovalConfig(db)).mode !== "manual") return { ok: true };

  const candidates = await approverCandidates(db, next.required_permission, task.org_unit_id);
  if (candidates.some((c) => c.id === targetUserId)) return { ok: true };
  return {
    status: 422,
    ok: false,
    error: `${targetUserId} cannot approve this invoice: they do not hold ${next.required_permission} for its org`,
  };
}
