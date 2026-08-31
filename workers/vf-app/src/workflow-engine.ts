import { evaluateRuleSet } from "@vibefinance/shared";
import type { InvoiceFacts } from "@vibefinance/shared";
import { loadActiveRuleSet } from "./rule-set-loader.js";
import { handleCreateTask } from "./task-route.js";
import type { RouteResult } from "./org-route.js";

/**
 * The runtime machinery decision 0018 explicitly deferred — see
 * docs/decisions/0019-process-instances-and-stage-visits.md. Process
 * definitions and stages (0018) describe a process; this actually
 * runs one: evaluating each stage's rule set against supplied facts,
 * reacting to what fires, and moving a real subject forward.
 *
 * Facts are always supplied by the caller, never fetched by this
 * module — decision 0015's own words: rules evaluate "against facts
 * supplied about it." The engine stays genuinely subject-agnostic by
 * never assuming how to load facts for a given subject_type, the same
 * way POST /rules/evaluate's inline `facts` path has always worked.
 *
 * A single call to visitCurrentStage cascades through as many
 * automatic (no rule_set_id) stages as apply, using the same supplied
 * facts throughout, stopping only when a stage's fired rules spawn
 * real tasks (blocking) or the process completes. Bounded — see
 * MAX_STAGES_PER_VISIT — the same "never Turing-complete" discipline
 * MAX_COMBINATOR_DEPTH already applies to rule nesting.
 */

const MAX_STAGES_PER_VISIT = 50;

interface ProcessInstanceRow {
  id: string;
  process_id: string;
  current_stage_id: string;
  status: string;
}
interface StageRow {
  id: string;
  process_id: string;
  sequence: number;
  rule_set_id: string | null;
}

interface CreateInstanceBody {
  subjectType?: unknown;
  subjectId?: unknown;
}

export async function handleCreateProcessInstance(
  db: D1Database,
  processId: string,
  body: CreateInstanceBody
): Promise<RouteResult> {
  const { subjectType, subjectId } = body;
  if (typeof subjectType !== "string" || !subjectType || typeof subjectId !== "string" || !subjectId) {
    return { status: 400, body: { error: "subjectType and subjectId (both strings) are required" } };
  }
  const process = await db.prepare("SELECT id FROM processes WHERE id = ?").bind(processId).first();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  const firstStage = await db
    .prepare("SELECT id FROM process_stages WHERE process_id = ? ORDER BY sequence ASC LIMIT 1")
    .bind(processId)
    .first<{ id: string }>();
  if (!firstStage) {
    return { status: 422, body: { error: `process ${processId} has no stages — nothing to start an instance at` } };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, processId, subjectType, subjectId, firstStage.id)
    .run();

  return { status: 201, body: { id, processId, subjectType, subjectId, currentStageId: firstStage.id, status: "in_progress" } };
}

async function nextStageInSequence(db: D1Database, processId: string, currentSequence: number): Promise<StageRow | null> {
  return db
    .prepare(
      "SELECT id, process_id, sequence, rule_set_id FROM process_stages WHERE process_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 1"
    )
    .bind(processId, currentSequence)
    .first<StageRow>();
}

/**
 * Visits the instance's current stage, evaluating its rule set (if
 * any) against the supplied facts, and cascades forward — advancing
 * through automatic stages, stopping at the first stage whose fired
 * rules spawn real tasks, or completing the instance if it runs off
 * the end of the process. The same facts are used for every stage
 * visited in this one call.
 */
export async function visitCurrentStage(
  db: D1Database,
  instanceId: string,
  facts: InvoiceFacts
): Promise<RouteResult> {
  const instance = await db
    .prepare("SELECT id, process_id, current_stage_id, status FROM process_instances WHERE id = ?")
    .bind(instanceId)
    .first<ProcessInstanceRow>();
  if (!instance) {
    return { status: 404, body: { error: `process instance ${instanceId} does not exist` } };
  }
  if (instance.status !== "in_progress") {
    return { status: 409, body: { error: `process instance ${instanceId} is already ${instance.status}` } };
  }

  const visitsThisCall: Array<Record<string, unknown>> = [];
  const currentInstanceId = instance.id;
  let currentStageId = instance.current_stage_id;

  for (let i = 0; i < MAX_STAGES_PER_VISIT; i++) {
    const stage = await db
      .prepare("SELECT id, process_id, sequence, rule_set_id FROM process_stages WHERE id = ?")
      .bind(currentStageId)
      .first<StageRow>();
    if (!stage) {
      return { status: 500, body: { error: `current stage ${currentStageId} no longer exists` } };
    }

    if (!stage.rule_set_id) {
      // Automatic stage — nothing to evaluate, nothing that could
      // spawn a task. Record the visit and always advance.
      const visitId = crypto.randomUUID();
      await db
        .prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'automatic')")
        .bind(visitId, currentInstanceId, stage.id)
        .run();
      visitsThisCall.push({ stageId: stage.id, outcome: "automatic", tasksCreated: 0 });

      const next = await nextStageInSequence(db, stage.process_id, stage.sequence);
      if (!next) {
        await db
          .prepare("UPDATE process_instances SET status = 'completed', updated_at = ? WHERE id = ?")
          .bind(new Date().toISOString(), currentInstanceId)
          .run();
        return { status: 200, body: { instanceId: currentInstanceId, status: "completed", visits: visitsThisCall } };
      }
      currentStageId = next.id;
      await db
        .prepare("UPDATE process_instances SET current_stage_id = ?, updated_at = ? WHERE id = ?")
        .bind(currentStageId, new Date().toISOString(), currentInstanceId)
        .run();
      continue;
    }

    // A real rule-set stage: load, evaluate, record, react.
    const ruleSet = await loadActiveRuleSet(db, stage.rule_set_id);
    if (!ruleSet) {
      return { status: 500, body: { error: `rule set ${stage.rule_set_id} for stage ${stage.id} does not exist` } };
    }
    const result = evaluateRuleSet(ruleSet, facts);

    const visitId = crypto.randomUUID();
    const stepStatements = result.trace.map((step, idx) =>
      db
        .prepare(
          "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched) VALUES (?, ?, ?, ?, ?)"
        )
        .bind(visitId, idx, step.ruleId, step.ruleVersion, step.matched ? 1 : 0)
    );
    await db.batch([
      db
        .prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, ?)")
        .bind(visitId, currentInstanceId, stage.id, result.outcome),
      ...stepStatements,
    ]);

    // route_to (redefined, decision 0018, to mean "advance to this
    // stage") — collect every distinct target named across all fired
    // actions. More than one distinct target is genuinely ambiguous;
    // refused rather than silently resolved, the same discipline as
    // the compiler's own refusal boundary.
    const routeTargets = new Set(
      result.actions.filter((a) => a.type === "route_to").map((a) => (a.params?.stage as string) ?? "")
    );
    if (routeTargets.size > 1) {
      return {
        status: 409,
        body: { error: `stage ${stage.id} fired conflicting route_to targets: ${[...routeTargets].join(", ")}` },
      };
    }
    const routeTarget = routeTargets.size === 1 ? [...routeTargets][0] : null;
    if (routeTarget) {
      const targetStage = await db
        .prepare("SELECT id FROM process_stages WHERE id = ? AND process_id = ?")
        .bind(routeTarget, stage.process_id)
        .first();
      if (!targetStage) {
        return {
          status: 422,
          body: { error: `route_to named stage ${routeTarget}, which does not exist in this process` },
        };
      }
    }

    // assign_task — spawn a real task for each one, tied to this
    // visit. Reuses handleCreateTask directly rather than
    // reimplementing task creation.
    const assignActions = result.actions.filter((a) => a.type === "assign_task");
    let tasksCreated = 0;
    for (const action of assignActions) {
      const params = (action.params ?? {}) as Record<string, unknown>;
      const createResult = await handleCreateTask(db, {
        id: crypto.randomUUID(),
        stageId: stage.id,
        teamId: params.team,
        userId: params.user,
        requiredPermission: params.permission,
      });
      if (createResult.status !== 201) {
        return { status: 500, body: { error: `assign_task fired an invalid task: ${JSON.stringify(createResult.body)}` } };
      }
      const newTaskId = (createResult.body as { id: string }).id;
      await db.prepare("UPDATE tasks SET stage_visit_id = ? WHERE id = ?").bind(visitId, newTaskId).run();
      tasksCreated++;
    }

    visitsThisCall.push({ stageId: stage.id, outcome: result.outcome, tasksCreated });

    if (tasksCreated > 0) {
      // Blocked — real, open tasks now exist for this visit. The
      // instance stays here until they're all completed (see
      // onTaskCompleted below), never advances on its own.
      return { status: 200, body: { instanceId: currentInstanceId, status: "in_progress", currentStageId: stage.id, visits: visitsThisCall } };
    }

    // No tasks spawned — advance now, per route_to if given, else sequence.
    let next: StageRow | null = null;
    if (routeTarget) {
      next = await db
        .prepare("SELECT id, process_id, sequence, rule_set_id FROM process_stages WHERE id = ?")
        .bind(routeTarget)
        .first<StageRow>();
    } else {
      next = await nextStageInSequence(db, stage.process_id, stage.sequence);
    }
    if (!next) {
      await db
        .prepare("UPDATE process_instances SET status = 'completed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), currentInstanceId)
        .run();
      return { status: 200, body: { instanceId: currentInstanceId, status: "completed", visits: visitsThisCall } };
    }
    currentStageId = next.id;
    await db
      .prepare("UPDATE process_instances SET current_stage_id = ?, updated_at = ? WHERE id = ?")
      .bind(currentStageId, new Date().toISOString(), currentInstanceId)
      .run();
  }

  return { status: 500, body: { error: `exceeded ${MAX_STAGES_PER_VISIT} stage visits in one call — possible cycle in this process's route_to targets` } };
}

/**
 * Called after a task completes (task-route.ts) — checks whether it
 * was the last open task for its stage visit, and if so, advances the
 * owning instance. Cascades only through automatic stages (no facts
 * available here to evaluate a real rule set) and stops, still
 * `in_progress`, at the first stage that actually needs one — a
 * deliberate scope boundary, not a gap: further progress from there
 * requires an explicit visitCurrentStage call with real facts.
 */
export async function onTaskCompleted(db: D1Database, taskId: string): Promise<void> {
  const task = await db
    .prepare("SELECT stage_visit_id FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ stage_visit_id: string | null }>();
  if (!task?.stage_visit_id) return;

  const openCount = await db
    .prepare("SELECT count(*) AS n FROM tasks WHERE stage_visit_id = ? AND completed_by IS NULL")
    .bind(task.stage_visit_id)
    .first<{ n: number }>();
  if ((openCount?.n ?? 0) > 0) return;

  const visit = await db
    .prepare("SELECT process_instance_id, stage_id FROM stage_visits WHERE id = ?")
    .bind(task.stage_visit_id)
    .first<{ process_instance_id: string; stage_id: string }>();
  if (!visit) return;

  const instance = await db
    .prepare("SELECT id, status FROM process_instances WHERE id = ?")
    .bind(visit.process_instance_id)
    .first<{ id: string; status: string }>();
  if (!instance || instance.status !== "in_progress") return;

  const stage = await db
    .prepare("SELECT id, process_id, sequence FROM process_stages WHERE id = ?")
    .bind(visit.stage_id)
    .first<StageRow>();
  if (!stage) return;

  let currentSequence = stage.sequence;
  for (let i = 0; i < MAX_STAGES_PER_VISIT; i++) {
    const next = await nextStageInSequence(db, stage.process_id, currentSequence);
    if (!next) {
      await db
        .prepare("UPDATE process_instances SET status = 'completed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), instance.id)
        .run();
      return;
    }
    currentSequence = next.sequence;
    await db
      .prepare("UPDATE process_instances SET current_stage_id = ?, updated_at = ? WHERE id = ?")
      .bind(next.id, new Date().toISOString(), instance.id)
      .run();
    if (next.rule_set_id) {
      // Stop here — this stage needs real facts to evaluate, which
      // this function deliberately never has.
      return;
    }
    await db
      .prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'automatic')")
      .bind(crypto.randomUUID(), instance.id, next.id)
      .run();
  }
}
