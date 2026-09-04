import { evaluateRuleSet } from "@vibefinance/shared";
import type { InvoiceFacts } from "@vibefinance/shared";
import {
  validateInvoiceFacts,
  mergeValidationFacts,
  mergeRevalidationFacts,
  type ValidationSettings,
} from "./validation.js";
import { applySetFieldActions, type FieldOverride } from "./set-field.js";
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
 *
 * Per-line evaluation (decision 0027): a stage whose evaluation_scope
 * is 'line' evaluates its rule set once per supplied line, merging
 * header facts with that line's own facts each time — decision 0015's
 * own confirmed example, each line checked against its own cost
 * centre threshold independently. Lines must be supplied inline to
 * this call, the same deliberate scope boundary already applied to
 * header facts — no auto-loading from invoice_lines by subject id,
 * matching decision 0019's own already-stated boundary.
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
  evaluation_scope: string;
}

type LineInput = InvoiceFacts & { lineNumber: number };

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
      "SELECT id, process_id, sequence, rule_set_id, evaluation_scope FROM process_stages WHERE process_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 1"
    )
    .bind(processId, currentSequence)
    .first<StageRow>();
}

/**
 * Visits the instance's current stage, evaluating its rule set (if
 * any) against the supplied facts, and cascades forward — advancing
 * through automatic stages, stopping at the first stage whose fired
 * rules spawn real tasks, or completing the instance if it runs off
 * the end of the process. The same facts (and lines, for a 'line'-
 * scoped stage) are used for every stage visited in this one call.
 */
export async function visitCurrentStage(
  db: D1Database,
  instanceId: string,
  rawFacts: InvoiceFacts,
  lines?: LineInput[],
  // Supplied by the caller when extraction capped the line list, so
  // the line-sum check knows not to run against an incomplete one.
  linesTruncated = false,
  // The channel's currency tolerance (decision 0053). Supplied by the
  // caller rather than loaded here, for the same reason as
  // linesTruncated: this module never assumes how to load
  // configuration for a given subject_type. Defaults to the platform
  // tolerance so every existing caller is unchanged.
  validationSettings?: ValidationSettings
): Promise<RouteResult> {
  // Validation runs once, up front, and its results become real
  // derived facts every stage then sees — decision 0044.
  //
  // A fact-producing agent in decision 0015's own sense: it runs
  // BEFORE any rule evaluates, contributes facts, and finishes. Rule
  // evaluation itself stays pure, and non-determinism never enters it
  // — though there is none to enter here, since every validation
  // check is arithmetic or presence.
  //
  // Deliberately computed here rather than at intake: a stage visit
  // is where facts meet rules, and computing it once for the whole
  // visit means every stage evaluates against the same validation
  // state rather than a shifting one.
  const validation = validateInvoiceFacts(rawFacts, lines, validationSettings, linesTruncated);
  const facts = mergeValidationFacts(rawFacts, validation);
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

  // Refuse to re-visit a stage that is waiting on people — decision
  // 0072.
  //
  // Blocking on tasks is this engine's own stated intent: "the instance
  // stays here until they're all completed, never advances on its own".
  // But the only guard was on instance STATUS, and a blocked instance is
  // still `in_progress` — so a second visit would re-evaluate the same
  // rules against the same stage and spawn a second set of tasks
  // identical to the ones already waiting.
  //
  // Found by asking whether keying should re-evaluate (decision 0071's
  // closing gap). It should not, and this is why: the answer was a
  // hazard rather than a missing feature.
  const openTasks = await db
    .prepare(
      `SELECT count(*) AS n FROM tasks t
       JOIN stage_visits v ON v.id = t.stage_visit_id
       WHERE v.process_instance_id = ? AND v.stage_id = ? AND t.status = 'open'`
    )
    .bind(instanceId, instance.current_stage_id)
    .first<{ n: number }>();
  if ((openTasks?.n ?? 0) > 0) {
    return {
      status: 409,
      body: {
        error: `process instance ${instanceId} is waiting on ${openTasks?.n} open task(s) at stage ${instance.current_stage_id}`,
        detail: "completing them advances it; re-visiting would raise the same tasks again",
      },
    };
  }

  const visitsThisCall: Array<Record<string, unknown>> = [];
  // Facts as they stand after any set_field a rule fired — returned
  // so the CALLER can persist them. Deliberately not written from
  // here: this module never assumes how to load or store facts for a
  // given subject_type, and writing invoice rows would break that.
  // Found live: a rule corrected a total, recorded the change, and
  // the invoice on file kept the wrong value — set_field changed
  // nothing that outlived the stage visit.
  let correctedFacts: InvoiceFacts | undefined;
  let afterValidation: { passed: boolean; failures: string[] } | undefined;
  const currentInstanceId = instance.id;
  let currentStageId = instance.current_stage_id;

  for (let i = 0; i < MAX_STAGES_PER_VISIT; i++) {
    const stage = await db
      .prepare("SELECT id, process_id, sequence, rule_set_id, evaluation_scope FROM process_stages WHERE id = ?")
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
        return { status: 200, body: { instanceId: currentInstanceId, status: "completed", visits: visitsThisCall, correctedFacts } };
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

    // Header scope: one evaluation, against facts alone — exactly the
    // existing behaviour, unchanged. Line scope: one evaluation per
    // supplied line, merging header facts with that line's own facts
    // each time. Every evaluation runs, and every result is collected,
    // BEFORE anything is written to D1 — the stage_visits row has to
    // exist before any task can reference it via its own
    // stage_visit_id foreign key, so task creation happens last, not
    // interleaved with evaluation.
    const evaluations: Array<{ facts: InvoiceFacts; lineNumber: number | null }> =
      stage.evaluation_scope === "line"
        ? (lines ?? []).map((line) => ({ facts: { ...facts, ...line }, lineNumber: line.lineNumber }))
        : [{ facts, lineNumber: null }];

    const visitId = crypto.randomUUID();
    let anyMatched = false;
    const routeTargets = new Set<string>();
    const stepStatements: D1PreparedStatement[] = [];
    const pendingTaskActions: Array<{ params: Record<string, unknown>; lineNumber: number | null }> = [];
    // Every field a rule changed, recorded so an auditor can ask what
    // this invoice said before a rule touched it (decision 0049).
    const allOverrides: FieldOverride[] = [];
    let stepSeq = 0;

    for (const evaluation of evaluations) {
      const result = evaluateRuleSet(ruleSet, evaluation.facts);
      if (result.outcome === "matched") anyMatched = true;

      for (const step of result.trace) {
        stepStatements.push(
          db
            .prepare(
              "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched, line_number) VALUES (?, ?, ?, ?, ?, ?)"
            )
            .bind(visitId, stepSeq++, step.ruleId, step.ruleVersion, step.matched ? 1 : 0, evaluation.lineNumber)
        );
      }

      // set_field applies here, after evaluation and before the
      // actions that depend on the result. Deliberately does NOT feed
      // back into this same evaluation: a rule changing a field that
      // a later rule in the same pass then tests would make the
      // outcome depend on rule order in a way nobody could reason
      // about, and would open a path to rules that never settle.
      const setFieldOutcome = applySetFieldActions(evaluation.facts, result.attributedActions);
      allOverrides.push(...setFieldOutcome.overrides);
      if (setFieldOutcome.overrides.length > 0) {
        // Header-scope only. A per-line evaluation's facts are one
        // line's, not the invoice's, and merging them into the header
        // would attribute a line's value to the whole document.
        if (evaluation.lineNumber === null) {
          // Re-validate against the corrected facts — decision 0051.
          // validation.passed describes the document as it ARRIVED
          // and never changes; this describes what was actually
          // stored. Both are kept because they answer different
          // questions: an auditor asks the first about the supplier,
          // the finance team acts on the second.
          //
          // Recorded as facts, never re-evaluated against rules. A
          // second evaluation would let rules change facts that
          // change validation that triggers rules — an ordering
          // problem with no obvious end.
          const after = validateInvoiceFacts(setFieldOutcome.facts, lines, validationSettings, linesTruncated);
          afterValidation = { passed: after.passed, failures: after.failures };
          correctedFacts = mergeRevalidationFacts(setFieldOutcome.facts, after);
        }
      }

      for (const action of result.actions.filter((a) => a.type === "route_to")) {
        routeTargets.add((action.params?.stage as string) ?? "");
      }
      for (const action of result.actions.filter((a) => a.type === "assign_task")) {
        pendingTaskActions.push({ params: (action.params ?? {}) as Record<string, unknown>, lineNumber: evaluation.lineNumber });
      }
    }

    await db.batch([
      db
        .prepare(
          // Validation is recorded on the visit, not the invoice: it
          // describes a MOMENT of evaluation, not a permanent
          // property of a document. A re-visit after a correction
          // produces a second row with its own result, and both
          // survive — which is exactly the history an audit needs and
          // exactly what writing it onto invoice_headers would
          // destroy.
          //
          // Recorded only for rule-evaluating stages. An automatic
          // stage never consults validation, so claiming a result
          // there would assert something that did not happen.
          "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, validation_failures, validation_checked, validation_passed_after, validation_failures_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          visitId,
          currentInstanceId,
          stage.id,
          anyMatched ? "matched" : "no_match",
          validation.passed ? 1 : 0,
          validation.failures.join(","),
          validation.checked.join(","),
          // NULL when no rule changed anything: an invoice nothing
          // touched has one validation state, not two saying the
          // same thing.
          afterValidation === undefined ? null : afterValidation.passed ? 1 : 0,
          afterValidation === undefined ? null : afterValidation.failures.join(",")
        ),
      ...stepStatements,
      // Written in the same batch as the visit itself, so an override
      // can never exist without the visit that produced it, nor a
      // visit silently lose the record of what it changed.
      ...allOverrides.map((o) =>
        db
          .prepare(
            "INSERT INTO field_overrides (id, stage_visit_id, rule_id, field, previous_value, new_value) VALUES (?, ?, ?, ?, ?, ?)"
          )
          .bind(
            crypto.randomUUID(),
            visitId,
            o.ruleId,
            o.field,
            o.previousValue === undefined ? null : JSON.stringify(o.previousValue),
            JSON.stringify(o.newValue)
          )
      ),
    ]);

    // route_to (redefined, decision 0018, to mean "advance to this
    // stage") — collect every distinct target named across every
    // fired action, across every line evaluated. More than one
    // distinct target is genuinely ambiguous; refused rather than
    // silently resolved, the same discipline as the compiler's own
    // refusal boundary.
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
    // visit and, for a line-scope evaluation, to the specific line
    // responsible. Each matching line spawns its own separate task —
    // decision 0015's own confirmed behaviour — since different lines
    // can genuinely need different approvers. Now safe: the
    // stage_visits row this references was already inserted above.
    let tasksCreated = 0;
    for (const { params, lineNumber } of pendingTaskActions) {
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
      await db
        .prepare("UPDATE tasks SET stage_visit_id = ?, line_number = ? WHERE id = ?")
        .bind(visitId, lineNumber, newTaskId)
        .run();
      tasksCreated++;
    }

    visitsThisCall.push({ stageId: stage.id, outcome: anyMatched ? "matched" : "no_match", tasksCreated });

    if (tasksCreated > 0) {
      // Blocked — real, open tasks now exist for this visit. The
      // instance stays here until they're all completed (see
      // onTaskCompleted below), never advances on its own.
      return { status: 200, body: { instanceId: currentInstanceId, status: "in_progress", currentStageId: stage.id, visits: visitsThisCall, correctedFacts } };
    }

    // No tasks spawned — advance now, per route_to if given, else sequence.
    let next: StageRow | null = null;
    if (routeTarget) {
      next = await db
        .prepare("SELECT id, process_id, sequence, rule_set_id, evaluation_scope FROM process_stages WHERE id = ?")
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
      return { status: 200, body: { instanceId: currentInstanceId, status: "completed", visits: visitsThisCall, correctedFacts } };
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
    // 'open', not `completed_by IS NULL` — decision 0075. A returned or
    // cancelled task is not waiting on anybody, and counting it as open
    // would block its instance forever with nothing left to complete.
    .prepare("SELECT count(*) AS n FROM tasks WHERE stage_visit_id = ? AND status = 'open'")
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
