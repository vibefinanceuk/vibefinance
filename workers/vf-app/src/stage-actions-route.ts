import { evaluateConditions, type RuleNode, type InvoiceFacts } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { loadLiveInvoiceFacts } from "./invoice-facts-route.js";

/**
 * What a stage's own action does — decision 0487, the home for
 * "button behaviour" as distinct from decisions 0041/0081's "what a
 * stage's fields look like."
 *
 * See migrations/0082_stage_actions.sql for why this is a table (one
 * row per stage, per action) rather than a column on process_stages.
 */

/**
 * The closed TaskAction vocabulary, mirrored from task-list-route.ts.
 * Not imported from there: that file's own union is a compile-time
 * type, not a runtime list, and this needs the runtime list to
 * validate a request body against — the same relationship
 * INVOICE_FIELDS has to Visibility in field-visibility-route.ts.
 */
const KNOWN_ACTIONS = new Set([
  "key",
  "return",
  "return_to_supplier",
  "discard",
  "claim",
  "complete",
  "release",
]);

/**
 * Configuring one (stage, action) row.
 *
 * **Only one flag exists today** (`reverifyRuleOnComplete`), so the
 * body carries exactly one optional field — set up so a second flag
 * added later (some future per-action behaviour) is a new optional
 * field on the same body and the same route, not a new URL.
 */
export async function handleSetStageAction(
  db: D1Database,
  stageId: string,
  action: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  if (!KNOWN_ACTIONS.has(action)) {
    return { status: 422, body: { error: `"${action}" is not an action this system knows` } };
  }

  const stage = await db.prepare("SELECT id FROM process_stages WHERE id = ?").bind(stageId).first();
  if (!stage) {
    return { status: 404, body: { error: `stage ${stageId} does not exist` } };
  }

  const { reverifyRuleOnComplete } = body;
  if (typeof reverifyRuleOnComplete !== "boolean") {
    return { status: 400, body: { error: "reverifyRuleOnComplete (true or false) is required" } };
  }

  /**
   * **Only meaningful for `complete`, accepted for any action.**
   * Refusing it on the other six would make this route reject a
   * caller who simply hasn't been told yet that only Complete does
   * anything with it — storing a value nothing reads is harmless, and
   * matches how `reverify_rule_on_complete` already carries its own
   * name rather than a generic one, since it is not yet clear a
   * second action will ever want the identical behaviour.
   */
  await db
    .prepare(
      `INSERT INTO stage_actions (stage_id, action, reverify_rule_on_complete, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (stage_id, action) DO UPDATE SET
         reverify_rule_on_complete = excluded.reverify_rule_on_complete,
         updated_at = excluded.updated_at`
    )
    .bind(stageId, action, reverifyRuleOnComplete ? 1 : 0, new Date().toISOString())
    .run();

  return { status: 200, body: { stageId, action, reverifyRuleOnComplete } };
}

/**
 * Whether Complete, at this stage, should refuse until the rule that
 * raised the task no longer matches. A cheap, single-row read, meant
 * to be called on every completion before doing any heavier work —
 * `ruleStillFiresForTask` below is not worth running at all for the
 * stages (the overwhelming majority, until an operator opts one in)
 * where the answer is already no.
 */
export async function stageReverifiesRuleOnComplete(db: D1Database, stageId: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT reverify_rule_on_complete FROM stage_actions WHERE stage_id = ? AND action = 'complete'")
    .bind(stageId)
    .first<{ reverify_rule_on_complete: number }>();
  return row?.reverify_rule_on_complete === 1;
}

interface TaskForReverify {
  rule_id: string | null;
  stage_visit_id: string | null;
  line_number: number | null;
}

/**
 * Does the rule that raised this task still match, checked against
 * live facts right now — decision 0487.
 *
 * **Only called once the stage has opted in** (`stageReverifiesRule
 * OnComplete`) — this function itself does not check that flag, so a
 * caller skipping the cheap check above and calling this directly
 * would still get a correct answer, just a more expensive one.
 *
 * **Fails open, deliberately, in every case where the exact thing to
 * re-check cannot be pinned down**: no `rule_id` at all (a decision
 * 0480 `system_reason` task — nothing was ever asserted, so nothing
 * can un-assert), no `stage_visit_id` (a task created directly via
 * `POST /tasks`, decision 0018's own pre-engine path, with no visit
 * behind it to reconstruct a firing step from), no matching
 * `stage_visit_steps` row (should not happen for a rule-attributed
 * task per migration 0009's own recording of every step, but this is
 * a refusal added on top of a completion that already worked — a
 * genuine "we don't know" should not become a new, permanent lock),
 * or a subject that is not an invoice (the engine is subject-agnostic;
 * this decision is invoice-specific, the same boundary
 * `followUpAfterTaskCompletion`'s own comment already draws). Additive
 * discipline, the same one decision 0486 used for its own claim check:
 * scoped to what is confidently known, never inferred past it.
 */
export async function ruleStillFiresForTask(
  db: D1Database,
  taskId: string
): Promise<{ blocked: boolean; ruleName: string | null }> {
  const notBlocked = { blocked: false, ruleName: null };

  const task = await db
    .prepare("SELECT rule_id, stage_visit_id, line_number FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<TaskForReverify>();
  if (!task?.rule_id || !task.stage_visit_id) return notBlocked;

  // The exact VERSION that actually fired, not "whichever is active
  // now" — an edited rule should not change what "resolved" means for
  // a task already in flight. `line_number IS ?` is SQLite's own
  // NULL-safe comparison, so a header-scope task's own NULL matches
  // the step's NULL correctly, not just a header-scope task's real
  // number against a real number.
  const step = await db
    .prepare(
      `SELECT rule_version FROM stage_visit_steps
       WHERE stage_visit_id = ? AND rule_id = ? AND matched = 1 AND line_number IS ?
       ORDER BY seq DESC LIMIT 1`
    )
    .bind(task.stage_visit_id, task.rule_id, task.line_number)
    .first<{ rule_version: number }>();
  if (!step) return notBlocked;

  const version = await db
    .prepare(
      `SELECT r.name AS rule_name, rv.compiled_json AS compiled_json
       FROM rules r
       JOIN rule_versions rv ON rv.rule_id = r.id AND rv.version = ?
       WHERE r.id = ?`
    )
    .bind(step.rule_version, task.rule_id)
    .first<{ rule_name: string; compiled_json: string }>();
  if (!version) return notBlocked;

  // Which invoice, and whether it even is one — the same
  // stage_visits -> process_instances join decision 0486's own claim
  // check and currentOpenTaskReason both already established.
  const instance = await db
    .prepare(
      `SELECT pi.subject_type, pi.subject_id
       FROM stage_visits v
       JOIN process_instances pi ON pi.id = v.process_instance_id
       WHERE v.id = ?`
    )
    .bind(task.stage_visit_id)
    .first<{ subject_type: string; subject_id: string }>();
  if (instance?.subject_type !== "invoice") return notBlocked;

  const live = await loadLiveInvoiceFacts(db, instance.subject_id);
  if (!live) return notBlocked;

  // Line-scope: merge that one line's own facts over the header's,
  // the exact precedence workflow-engine.ts's own per-line evaluation
  // already uses ({ ...facts, ...line }) — the line wins where both
  // name the same term.
  const facts: InvoiceFacts =
    task.line_number != null
      ? { ...live.facts, ...(live.lines.find((l) => l.lineNumber === task.line_number) ?? {}) }
      : live.facts;

  // `compiled_json` stores the whole compiled rule — `{ conditions,
  // actions }` (the same shape `rule-set-loader.ts`'s own
  // `loadActiveRuleSet` already parses it as) — not the bare
  // conditions tree alone.
  const compiled = JSON.parse(version.compiled_json) as { conditions: RuleNode };
  const stillMatches = evaluateConditions(compiled.conditions, facts);

  return stillMatches ? { blocked: true, ruleName: version.rule_name } : notBlocked;
}
