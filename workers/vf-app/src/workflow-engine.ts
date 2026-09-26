import { evaluateRuleSet } from "@vibefinance/shared";
import type { InvoiceFacts } from "@vibefinance/shared";
import {
  validateInvoiceFacts,
  mergeValidationFacts,
  mergeRevalidationFacts,
  type ValidationSettings,
} from "./validation.js";
import { applySetFieldActions, type FieldOverride } from "./set-field.js";
import { resolveRuleSetForStage } from "./unit-config.js";
import { loadActiveRuleSet } from "./rule-set-loader.js";
import { handleCreateTask } from "./task-route.js";
import { resolveApprovalTargets, type ApprovalResolution } from "./approval-hierarchy.js";
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
  /** The version this instance runs under — decision 0150. */
  process_version: number;
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
  /** Who may work here — decision 0200. Null where the stage says nothing. */
  required_permission: string | null;
  evaluation_scope: string;
  /** Whether this stage refuses to finish without an org (0111). */
  requires_org: number;
  /**
   * Whether this stage's own `assign_task` actions resolve through
   * the configured Approval Hierarchy instead of whatever team/user a
   * rule names — decision 0439, the same "stage overrides the rule"
   * shape as `required_permission` above. Optional on the type: only
   * the top-level stage fetch below selects it, the same partial-
   * select convention `onTaskCompleted`'s own `StageRow` query
   * already uses for `sequence` alone.
   */
  uses_approval_hierarchy?: number;
}

type LineInput = InvoiceFacts & { lineNumber: number };

interface CreateInstanceBody {
  subjectType?: unknown;
  subjectId?: unknown;
}

/**
 * May this invoice leave a stage that requires an organisational unit?
 * — decision 0111.
 *
 * **Not "may it enter".** The check has to run on every path out of a
 * stage, and there are two: an automatic stage advances without
 * evaluating anything, and a rule-bearing stage advances after its
 * rules have run — where a rule at that very stage may be the thing
 * that supplies the org.
 *
 * Checking only before evaluation would refuse an invoice a rule was
 * about to place. Checking only after would wave through every
 * automatic stage, which is exactly the one nobody configured rules
 * for.
 *
 * Returns a refusal, or null to proceed. The invoice is never
 * rejected — it stays where it is and somebody places it.
 */
async function orgGuard(
  db: D1Database,
  stage: { id: string; requires_org: number },
  instance: { subject_type: string; subject_id: string }
): Promise<RouteResult | null> {
  if (!stage.requires_org || instance.subject_type !== "invoice") return null;

  const placed = await db
    .prepare("SELECT org_unit_id FROM invoice_headers WHERE id = ?")
    .bind(instance.subject_id)
    .first<{ org_unit_id: string | null }>();

  if (placed?.org_unit_id) return null;

  return {
    status: 409,
    body: {
      error: `stage ${stage.id} requires an organisational unit and this invoice has none`,
      detail:
        "assign one with a rule using assign_org, set a default on the source it arrived through, " +
        "or assign it by hand",
    },
  };
}

/**
 * May this invoice leave its last real checkpoint before release —
 * decision 0480.
 *
 * **Hardcoded, not rule-driven, deliberately.** Every other gate in
 * this engine is a tenant-authored rule reading a fact this module
 * computed — and that is exactly what failed the incident this
 * decision answers: a live rule meant to test `supplier.matched`
 * compiled with an extra clause that made it unsatisfiable for the
 * common case, and a stale `route_to` that named a display label
 * rather than a real stage id, both silently, for months. "An invoice
 * cannot be released to the ERP without a supplier the ERP can
 * actually be told about" is treated as too consequential to depend on
 * a rule a person authored in English and a model compiled — the same
 * reasoning `orgGuard` above already applied to "an invoice cannot
 * finish without an organisational unit."
 *
 * **Reads `facts["supplier.*"]`, not a live join — reversed from this
 * decision's own first draft, on what real tests caught.** A live
 * join looked like the safer choice on paper: `handleSetInvoiceSupplier`
 * really did leave stale facts behind (fixed alongside this decision,
 * load-suppliers.ts), so "read the database, not a snapshot" sounded
 * like the fix that generalizes. It does not. Decision 0434's own
 * documented choice is that `buildIntakeEnricher` (source-capture-
 * route.ts) computes `supplier.matched`/`supplier.awaitingErp` and
 * hands them to THIS SAME cascading visit — the durable
 * `invoice_headers.supplier_id` write happens afterward, once capture
 * returns, on purpose ("a cascading visit can carry a fresh instance
 * clean through Validation, Matching, Coding and Approval to
 * `completed` in that one call"). A live join here would read that
 * column before decision 0434's own write ever ran, and block every
 * single invoice on its first, cleanest capture — confirmed by
 * running this exact change against the real test suite, not assumed.
 * `facts` is the value every rule at every earlier stage in this same
 * visit already evaluated against; reading anything else would make
 * this gate disagree with the rules it exists to backstop. The actual
 * fix for staleness was never "stop trusting facts" — it was
 * `handleSetInvoiceSupplier` keeping them in sync on every mutation,
 * which decision 0434's own `followUpAfterTaskCompletion` path
 * (index.ts) already depends on for exactly this reason.
 *
 * `facts["supplier.matched"]`/`.awaitingErp"]` are read loosely
 * (`!!value`), not `=== true`: `buildIntakeEnricher` writes real JS
 * booleans, but a value that reached `facts_json` via `json_set`
 * (`handleSetInvoiceSupplier`) is SQLite's own `1`/`0` once round-tripped
 * through `JSON.parse` — the same looseness the rule engine's own
 * condition evaluator already has to tolerate for the same reason.
 *
 * **Fires only at the hand-off out of the last checkpoint** — the
 * caller checks this, not the function: called only when the stage
 * about to be entered is automatic (`rule_set_id IS NULL`, nothing
 * left that could ever block this invoice again) or there is no next
 * stage at all. Deliberately not hardcoded to any stage name or id —
 * this tenant's process happens to land it precisely on `review` ->
 * `payment-eligible`, but nothing here assumes that shape.
 *
 * **Three distinct reasons** (migrations/0080's own vocabulary), the
 * PO/Non-PO split per the operator's own two confirmed AskUserQuestion
 * answers: a Non-PO invoice matching nothing at all is the ordinary
 * New Seller case (`supplier_unidentified`); a Non-PO invoice already
 * matched to a real, locally-recorded supplier still awaiting its ERP
 * identifier has nothing left to self-serve (`supplier_awaiting_erp`);
 * a PO invoice reaching this gate with no supplier at all is the
 * anomaly the operator said "should not happen" and gets no
 * self-service path either (`po_supplier_unidentified`) — PO-ness read
 * from BT-13, the same field `resolveInvoiceCollaboratorIds`'s own
 * caller already reads for Non-PO Approval routing.
 *
 * Returns the number of tasks it created — 0 or 1, the same shape the
 * rule-bearing branch's own `tasksCreated` already returns, so the
 * caller can fold it into the same blocking decision without a
 * separate code path — or a `RouteResult` if it could not even do
 * that much (its own `handleCreateTask` call was refused), for the
 * caller to return as-is. Never throws: every other failure path in
 * this module returns a `RouteResult` rather than an unhandled
 * exception, and a safety net whose own plumbing failure could crash
 * the very capture/task pipeline it is meant to protect would be a
 * worse outcome than the bug it exists to catch. Decision 0435's own
 * capture-route handling already treats a >=400 `RouteResult` from a
 * stage visit as "recorded on the invoice as `workflow.stageError`,
 * never a failed capture" — this reuses exactly that path rather than
 * inventing a second way to fail.
 */
async function erpReleaseGuard(
  db: D1Database,
  stage: StageRow,
  next: StageRow | null,
  instance: { subject_type: string; subject_id: string },
  facts: InvoiceFacts,
  visitId: string
): Promise<number | RouteResult> {
  if (instance.subject_type !== "invoice") return 0;
  // Defense-in-depth: every call site already checks this before
  // calling, the same "never assume the caller checked" discipline
  // orgGuard's own callers follow — but a guard that trusts its
  // caller for its own firing condition is one refactor away from
  // firing at the wrong hand-off.
  if (next && next.rule_set_id) return 0;

  // No invoice_headers row at all — subject_type "invoice" names the
  // engine's own generic subject typing (decision 0015), not a
  // guarantee that a real invoice record exists (this module never
  // assumes how a subject_type is backed, the same boundary `orgGuard`
  // and the header-fact loaders above already respect). Existence
  // only, deliberately the cheapest possible query: the actual
  // matched/awaitingErp answer comes from `facts` just below, not from
  // here, per this function's own comment above.
  const exists = await db.prepare("SELECT 1 FROM invoice_headers WHERE id = ?").bind(instance.subject_id).first();
  if (!exists) return 0;

  // A supplier is attached and the ERP already knows it — releasable.
  // decisions 0209/0231's own two claims, read exactly as any rule
  // testing them would.
  const matched = !!facts["supplier.matched"];
  const awaitingErp = !!facts["supplier.awaitingErp"];
  if (matched && !awaitingErp) return 0;

  // Three distinct reasons, migrations/0080's own vocabulary — which
  // one names what a human (or a "New Seller" button) should actually
  // do next, not just "supplier problem":
  //   - a PO invoice with no supplier matched is the anomaly the
  //     operator said "should not happen" — no self-service;
  //   - a Non-PO invoice with no supplier matched at all is the
  //     ordinary New Seller case — nothing on file to conflict with;
  //   - `matched && awaitingErp` (the only way past the `return 0`
  //     above) means a real local record already exists and is
  //     mid-onboarding — no self-service left to offer, since the
  //     record itself is not the gap.
  const poNumber = typeof facts["BT-13"] === "string" ? facts["BT-13"].trim() : "";
  const systemReason = matched
    ? "supplier_awaiting_erp"
    : poNumber !== ""
      ? "po_supplier_unidentified"
      : "supplier_unidentified";

  const createResult = await handleCreateTask(db, {
    id: crypto.randomUUID(),
    stageId: stage.id,
    teamId: "ap-team",
    // Falls back to AP.Review, not the stage's own name — the stage
    // handing off here can structurally be any stage in principle, but
    // the reason a task lands here is always "the ERP cannot be told
    // about this supplier yet," which is AP Review's own remit per the
    // operator's own words: "this is the final stage before releasing
    // to the ERP system."
    requiredPermission: stage.required_permission ?? "AP.Review",
  });
  if (createResult.status !== 201) {
    return {
      status: 500,
      body: { error: `erpReleaseGuard could not create its own task: ${JSON.stringify(createResult.body)}` },
    };
  }
  const taskId = (createResult.body as { id: string }).id;
  await db
    .prepare("UPDATE tasks SET stage_visit_id = ?, system_reason = ? WHERE id = ?")
    .bind(visitId, systemReason, taskId)
    .run();

  return 1;
}

/**
 * **Non-PO Approval routing's own "who" — decisions 0468/0469/0471.**
 * Feeds `resolveApprovalTargets`'s `collaboratorUserIds`, which only
 * ever matters when `org_approval_config.route_non_po_to_requester` is
 * on and the invoice carries no PO reference — this always runs
 * regardless, the same "compute it, let the resolver decide whether it
 * applies" shape `costCentreId`/`costObjectValues` already get at the
 * call site below, rather than this module trying to guess when the
 * toggle is on.
 *
 * **Every collaborator, not just the earliest one — decision 0471.**
 * Decision 0469 read this back as a single "requester" (`ORDER BY
 * added_at ASC LIMIT 1`), a reasonable default before there was any
 * real usage to judge it against. The operator's own instruction for
 * Business Approver routing needs the whole list instead: *"all users
 * who require to provide approval should be added as collaborators"* —
 * `resolveNonPoApprovers` (`approval-hierarchy.ts`) is what actually
 * narrows this down, by checking which of them hold
 * `Procurement.Approve`, so this function's own job stays simple: name
 * everyone who was added, in the order they were, and let the resolver
 * decide who among them is really a Business Approver.
 */
async function resolveInvoiceCollaboratorIds(
  db: D1Database,
  instance: { subject_type: string; subject_id: string }
): Promise<string[]> {
  if (instance.subject_type !== "invoice") return [];

  const rows = await db
    .prepare("SELECT user_id FROM invoice_collaborators WHERE invoice_id = ? ORDER BY added_at ASC")
    .bind(instance.subject_id)
    .all<{ user_id: string }>();
  return rows.results.map((r) => r.user_id);
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
  // **The version an instance starts under** — decision 0150. Whatever
  // the process is publishing now; it keeps it for life.
  const process = await db
    .prepare("SELECT id, version FROM processes WHERE id = ?")
    .bind(processId)
    .first<{ id: string; version: number }>();
  if (!process) {
    return { status: 404, body: { error: `process ${processId} does not exist` } };
  }
  /**
   * The first stage of the version this instance runs under — decision
   * 0150.
   *
   * **Not `process_stages.sequence`.** That column describes a stage;
   * the *order* belongs to a version, so an invoice started under v1
   * keeps v1's path even after v2 is published.
   */
  const firstStage = await db
    .prepare(
      `SELECT v.stage_id AS id FROM process_stage_versions v
       WHERE v.process_id = ? AND v.version = ?
       ORDER BY v.sequence ASC LIMIT 1`
    )
    .bind(processId, process.version)
    .first<{ id: string }>();
  if (!firstStage) {
    return { status: 422, body: { error: `process ${processId} has no stages — nothing to start an instance at` } };
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      // **Stamped with the version it starts under** — decision 0150.
      // The operator's requirement: the invoice finished on v1, and the
      // item has no knowledge of v2.
      `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, process_version)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, processId, subjectType, subjectId, firstStage.id, process.version)
    .run();

  return { status: 201, body: { id, processId, subjectType, subjectId, currentStageId: firstStage.id, status: "in_progress" } };
}

/**
 * **Exported since decision 0495** — Route To Approver's own
 * candidate-list route (`handleRouteToApproverCandidates`,
 * `task-route.ts`) needs to know, from the task someone is completing
 * right now, whether the stage it leads to is one Approval Hierarchy
 * will resolve — the identical question this function's own callers
 * below already ask when actually advancing. One query, not a second
 * copy of it living in `task-list-route.ts`/`task-route.ts` that could
 * drift from what completing the task will actually do.
 */
export async function nextStageInSequence(
  db: D1Database,
  processId: string,
  currentSequence: number,
  // **The instance's version, not the process's** — decision 0150. An
  // invoice finishes the path it started on.
  processVersion: number
): Promise<StageRow | null> {
  return db
    .prepare(
      /**
       * What comes next, in this instance's own version — decision
       * 0150.
       *
       * A stage removed in v2 is simply absent from v2's membership,
       * so an invoice on v1 still visits it and one on v2 does not —
       * without deleting a row six tables reference.
       *
       * **`uses_approval_hierarchy` added — decision 0495.** Every
       * existing caller below reads it the same way the top-level
       * stage fetch inside the main loop already does; adding it here
       * is not a new fact, only the first caller that needed to know
       * it about the NEXT stage rather than the current one.
       */
      `SELECT s.id, s.process_id, v.sequence, s.rule_set_id, s.evaluation_scope, s.requires_org,
              s.required_permission, s.uses_approval_hierarchy
       FROM process_stage_versions v
       JOIN process_stages s ON s.id = v.stage_id
       WHERE v.process_id = ? AND v.version = ? AND v.sequence > ?
       ORDER BY v.sequence ASC LIMIT 1`
    )
    .bind(processId, processVersion, currentSequence)
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
  validationSettings?: ValidationSettings,
  /**
   * **Route To Approver's own choice — decision 0495.** Threaded all
   * the way from `POST /tasks/:id/complete`'s own `targetUserId`
   * through `index.ts`'s `followUpAfterTaskCompletion`, down to here.
   * Passed to every `resolveApprovalTargets` call this visit makes
   * (below); it changes anything only where `org_approval_config`'s
   * own mode is `"manual"` — see `resolveApprovalHierarchy`'s own
   * comment on why supplying it otherwise is silently ignored, per
   * the operator's own words.
   *
   * **Applied to the first approval-hierarchy stage this cascade
   * meets, not every one.** A single call completing one task and
   * cascading through more than one Approval stage in a row is not a
   * shape this process model has ever produced, but the guard exists
   * so one person's own choice for the stage they were actually
   * shown never silently reapplies to a second, unrelated one further
   * down the same cascade.
   */
  manualApproverUserId?: string
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
    // The subject too, since decision 0111: `assign_org` writes to the
    // invoice this instance is about, and the engine is otherwise
    // deliberately ignorant of what a subject is.
    .prepare(
      // `process_version` carried with the instance — decision 0150.
      // Every stage lookup for it reads that version's membership, so
      // an invoice finishes the path it started on.
      "SELECT id, process_id, current_stage_id, status, subject_type, subject_id, process_version FROM process_instances WHERE id = ?"
    )
    .bind(instanceId)
    .first<ProcessInstanceRow & { subject_type: string; subject_id: string }>();
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
  // Route To Approver — decision 0495. See `manualApproverUserId`'s
  // own parameter comment above for why this is consumed once.
  let manualApproverConsumed = false;

  for (let i = 0; i < MAX_STAGES_PER_VISIT; i++) {
    const stage = await db
      .prepare(
        "SELECT id, process_id, sequence, rule_set_id, evaluation_scope, requires_org, required_permission, uses_approval_hierarchy FROM process_stages WHERE id = ?"
      )
      .bind(currentStageId)
      .first<StageRow>();
    if (!stage) {
      return { status: 500, body: { error: `current stage ${currentStageId} no longer exists` } };
    }

    /**
     * **Which rules run here, for this invoice's unit** — decision
     * 0196.
     *
     * The stage's own `rule_set_id` is the group's answer, and a unit
     * may override it for this stage alone — so France and Germany
     * share a process and differ on one rule rather than duplicating
     * seven stages to change one threshold.
     *
     * Resolved in one place (`unit-config.ts`) and nowhere else,
     * because decision 0192's risk is that **forgetting the unit does
     * not fail** — it returns the group's answer, plausible and quietly
     * wrong.
     */
    const subjectUnitId =
      instance.subject_type === "invoice"
        ? (
            await db
              .prepare("SELECT org_unit_id FROM invoice_headers WHERE id = ?")
              .bind(instance.subject_id)
              .first<{ org_unit_id: string | null }>()
          )?.org_unit_id ?? null
        : null;

    const ruleSetId = await resolveRuleSetForStage(db, stage.id, subjectUnitId);

    if (!ruleSetId) {
      // An automatic stage advances without evaluating anything, so the
      // org guard runs here or not at all on this path.
      const refusal = await orgGuard(db, stage, instance);
      if (refusal) return refusal;


      // Automatic stage — nothing to evaluate, nothing a RULE could
      // spawn. Record the visit and always advance, unless decision
      // 0480's own hardcoded gate blocks it first.
      const visitId = crypto.randomUUID();
      await db
        .prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, ?, 'automatic', strftime('%Y-%m-%d %H:%M:%f', 'now'))")
        .bind(visitId, currentInstanceId, stage.id)
        .run();

      const next = await nextStageInSequence(db, stage.process_id, stage.sequence, instance.process_version);

      // decision 0480 — same hand-off guard as the rule-bearing branch
      // below. An automatic stage the invoice is entering now was
      // itself the previous hand-off's own "next" and so was already
      // checked once; this checks the one ahead of IT, the same
      // structural rule applied at every hand-off rather than assumed
      // to already be covered by an earlier one.
      const erpGuardResult =
        !next || !next.rule_set_id ? await erpReleaseGuard(db, stage, next, instance, facts, visitId) : 0;
      if (typeof erpGuardResult !== "number") return erpGuardResult;
      const erpTasksCreated = erpGuardResult;

      visitsThisCall.push({ stageId: stage.id, outcome: "automatic", tasksCreated: erpTasksCreated });

      if (erpTasksCreated > 0) {
        return { status: 200, body: { instanceId: currentInstanceId, status: "in_progress", currentStageId: stage.id, visits: visitsThisCall, correctedFacts } };
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
      continue;
    }

    // A real rule-set stage: load, evaluate, record, react.
    const ruleSet = await loadActiveRuleSet(db, ruleSetId);
    if (!ruleSet) {
      return { status: 500, body: { error: `rule set ${ruleSetId} for stage ${stage.id} does not exist` } };
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
    const orgTargets = new Set<string>();
    const stepStatements: D1PreparedStatement[] = [];
    const pendingTaskActions: Array<{
      params: Record<string, unknown>;
      lineNumber: number | null;
      facts: InvoiceFacts;
      /**
       * Which rule's own `assign_task` this is — decision 0478, the
       * "why is this task here" banner. `evaluateRuleSet`'s
       * `attributedActions` already carries this alongside every
       * action; only the older, unattributed `actions` array was ever
       * read here before, discarding it before a task was even
       * created. Nullable in principle (a future non-rule caller of
       * `handleCreateTask` has none), never actually null on this
       * path — every entry here came from a rule that matched.
       */
      ruleId: string;
    }> = [];
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
      for (const action of result.actions.filter((a) => a.type === "assign_org")) {
        orgTargets.add((action.params?.org as string) ?? "");
      }
      for (const attributed of result.attributedActions.filter((a) => a.action.type === "assign_task")) {
        /**
         * **The evaluation's own facts travel with the action** —
         * decision 0439. A line-scope evaluation's facts already
         * carry that line's own BT-131 (amount) and BT-133 (cost
         * centre) merged over the header's BT-5 (currency); a
         * header-scope one carries BT-112 (invoice total) and BT-5
         * alone. Needed only when this stage resolves through the
         * Approval Hierarchy rather than a rule-named team/user — see
         * the assign_task loop below.
         *
         * **`attributedActions`, not `actions`** — decision 0478.
         * Reading the flat, unattributed list here was never wrong for
         * anything this stage actually DID (both carry the same
         * `assign_task` params), only for what it could later SAY: a
         * task created from `actions` alone has no way back to the
         * rule that raised it once this call returns.
         */
        pendingTaskActions.push({
          params: (attributed.action.params ?? {}) as Record<string, unknown>,
          lineNumber: evaluation.lineNumber,
          facts: evaluation.facts,
          ruleId: attributed.ruleId,
        });
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
          "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, validation_failures, validation_checked, validation_passed_after, validation_failures_after, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))"
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
    // assign_org (decision 0111) — the same single-target discipline as
    // route_to above. **An invoice belongs to one part of the
    // enterprise**, and a rule set that cannot decide should say so
    // rather than pick: posting to the wrong books is the thing this
    // exists to prevent.
    if (orgTargets.size > 1) {
      return {
        status: 409,
        body: { error: `stage ${stage.id} fired conflicting assign_org targets: ${[...orgTargets].join(", ")}` },
      };
    }
    const orgTarget = orgTargets.size === 1 ? [...orgTargets][0] : null;
    // Invoices only. The engine is generic about subjects (decision
    // 0018) and an expense has no org column — so this reaches past the
    // abstraction for exactly one type, deliberately and visibly.
    if (orgTarget && instance.subject_type === "invoice") {
      const org = await db
        .prepare("SELECT id, kind FROM org_units WHERE id = ?")
        .bind(orgTarget)
        .first<{ id: string; kind: string }>();

      if (!org) {
        return {
          status: 409,
          body: { error: `stage ${stage.id} assigned an org that does not exist: ${orgTarget}` },
        };
      }
      if (org.kind !== "operating_unit") {
        // A legal entity is a tax and reporting boundary; the operating
        // unit is where payables happen. A standing invariant refuses
        // this too — checked here so the rule's author gets a reason.
        return {
          status: 409,
          body: {
            error:
              `${orgTarget} is ${org.kind === "legal_entity" ? "a legal entity" : "an operating unit"}, ` +
              "and an invoice is assigned to an operating unit",
          },
        };
      }

      await db
        .prepare("UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'rule' WHERE id = ?")
        .bind(orgTarget, instance.subject_id)
        .run();
    }

    // After the stage's own rules, so a rule here can be what places
    // the invoice — and before advancing, so it cannot leave unplaced.
    const orgRefusal = await orgGuard(db, stage, instance);
    if (orgRefusal) return orgRefusal;

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

    // Non-PO Approval routing's own "who" — decisions 0468/0469/0471.
    // One invoice, one collaborator list, for the whole visit —
    // computed once here rather than once per pendingTaskActions entry
    // below, since it never varies within a single stage visit the way
    // a line's own cost centre or coding can. Only worth the query at
    // all when this stage could actually use it.
    const collaboratorUserIds = stage.uses_approval_hierarchy ? await resolveInvoiceCollaboratorIds(db, instance) : [];

    // assign_task — spawn a real task for each one, tied to this
    // visit and, for a line-scope evaluation, to the specific line
    // responsible. Each matching line spawns its own separate task —
    // decision 0015's own confirmed behaviour — since different lines
    // can genuinely need different approvers. Now safe: the
    // stage_visits row this references was already inserted above.
    let tasksCreated = 0;
    for (const { params, lineNumber, facts: taskFacts, ruleId } of pendingTaskActions) {
      /**
       * **The stage's own, where it declares one** — decision 0200.
       *
       * `assign_task` takes a permission the **rule author types**, so
       * a rule at Validation could demand `AP.Review` and nothing
       * objected — both are valid strings. That is not hypothetical: it
       * happened, and cost a day of invoices sitting in a queue nobody
       * could see.
       *
       * A stage that declares its permission makes the mistake
       * **unsayable** rather than merely unlikely, and a rule
       * disagreeing with it is refused rather than quietly preferred —
       * because silently overriding what somebody wrote is how a rule
       * comes to mean something other than it says.
       */
      if (stage.required_permission && params.permission &&
          params.permission !== stage.required_permission) {
        return {
          status: 409,
          body: {
            error: `stage ${stage.id} requires ${stage.required_permission}, and this rule asks for ${String(params.permission)}`,
            reason: "permission_disagrees_with_stage",
          },
        };
      }

      /**
       * **A stage marked `uses_approval_hierarchy` resolves its own
       * target(s) — decision 0439, generalized to more than one by
       * decision 0452.** Whatever team/user the rule names is ignored
       * here, the same "the stage's own wins" shape `required_permission`
       * above already established, not a second vocabulary a rule
       * author could disagree with. The amount tested is the line's
       * own net amount (BT-131) for a line-scope evaluation, or the
       * invoice total (BT-112) for a header-scope one — whichever this
       * evaluation's own facts carry.
       *
       * **One task per resolved target, not one task per line** —
       * decision 0452's own multi-dimension Cost-Object mode can
       * resolve more than one, each raised independently and
       * completable in parallel, per the operator's own envisaged
       * design. Every other mode still resolves to exactly one, so
       * this is a one-element loop for them — no behaviour change.
       */
      let targets: Array<{ teamId?: string; userId?: string; requiredPermission?: string }>;
      if (stage.uses_approval_hierarchy) {
        const amountRaw = lineNumber !== null ? taskFacts["BT-131"] : taskFacts["BT-112"];
        const resolutions = await resolveApprovalTargets(db, {
          instanceId: currentInstanceId,
          processId: stage.process_id,
          currentSequence: stage.sequence,
          processVersion: instance.process_version,
          lineNumber,
          unitId: subjectUnitId,
          currency: typeof taskFacts["BT-5"] === "string" ? (taskFacts["BT-5"] as string) : null,
          amount: typeof amountRaw === "number" ? amountRaw : null,
          costCentreId: typeof taskFacts["BT-133"] === "string" ? (taskFacts["BT-133"] as string) : null,
          costObjectValues: {
            project: typeof taskFacts["coding.project"] === "string" ? (taskFacts["coding.project"] as string) : null,
            commodity_code:
              typeof taskFacts["coding.commodity_code"] === "string" ? (taskFacts["coding.commodity_code"] as string) : null,
            gl_code: typeof taskFacts["coding.gl_code"] === "string" ? (taskFacts["coding.gl_code"] as string) : null,
          },
          // Non-PO Approval routing — decisions 0468/0469/0471. Only
          // ever changes anything when org_approval_config's own
          // toggle is on; see resolveNonPoApprovers's own comment in
          // approval-hierarchy.ts.
          poReferenced: typeof taskFacts["BT-13"] === "string" && taskFacts["BT-13"].trim() !== "",
          collaboratorUserIds,
          // Route To Approver — decision 0495. Consumed once: the
          // first approval-hierarchy stage this cascade meets, never
          // a second one further down the same visit — see this
          // function's own parameter comment for why.
          manualTargetUserId: manualApproverConsumed ? undefined : manualApproverUserId,
        });
        manualApproverConsumed = true;
        // All-or-nothing: a line where even one applicable dimension
        // could not resolve refuses the whole stage visit, the same
        // discipline decision 0439 already applied to a single
        // unresolved chain — never create some of a line's approval
        // tasks and silently skip the rest.
        const unresolved = resolutions.find((r) => "unresolved" in r);
        if (unresolved && "reason" in unresolved) {
          return {
            status: 409,
            body: { error: `approval hierarchy could not resolve a target for stage ${stage.id}: ${unresolved.reason}`, reason: "approval_hierarchy_unresolved" },
          };
        }
        targets = (resolutions as ApprovalResolution[]).map((r) => ({
          userId: r.targetUserId,
          requiredPermission: r.requiredPermission,
        }));
      } else {
        targets = [{ teamId: params.team as string | undefined, userId: params.user as string | undefined }];
      }

      for (const { teamId, userId, requiredPermission } of targets) {
        const createResult = await handleCreateTask(db, {
          id: crypto.randomUUID(),
          stageId: stage.id,
          teamId,
          userId,
          // **A resolution's own permission wins when it names one —
          // decision 0471.** Falls back to the stage's declared
          // permission exactly as before for every resolver that
          // doesn't (Employee-Supervisor, Cost-Object, Manual, API,
          // and the non-approval-hierarchy branch above, none of which
          // ever set `requiredPermission` on their own resolution) —
          // additive, not a behaviour change for any of them.
          requiredPermission: requiredPermission ?? stage.required_permission ?? params.permission,
        });
        if (createResult.status !== 201) {
          return { status: 500, body: { error: `assign_task fired an invalid task: ${JSON.stringify(createResult.body)}` } };
        }
        const newTaskId = (createResult.body as { id: string }).id;
        await db
          // rule_id — decision 0478. Set here, not in handleCreateTask
          // itself, the same reason stage_visit_id and line_number
          // already are: that function is also the manual/API task
          // creation path (task-route.ts's own POST /tasks), which has
          // no rule and must not be made to invent one.
          .prepare("UPDATE tasks SET stage_visit_id = ?, line_number = ?, rule_id = ? WHERE id = ?")
          .bind(visitId, lineNumber, ruleId, newTaskId)
          .run();
        tasksCreated++;
      }
    }

    if (tasksCreated > 0) {
      visitsThisCall.push({ stageId: stage.id, outcome: anyMatched ? "matched" : "no_match", tasksCreated });
      // Blocked — real, open tasks now exist for this visit. The
      // instance stays here until they're all completed (see
      // onTaskCompleted below), never advances on its own.
      return { status: 200, body: { instanceId: currentInstanceId, status: "in_progress", currentStageId: stage.id, visits: visitsThisCall, correctedFacts } };
    }

    // No tasks spawned — advance now, per route_to if given, else sequence.
    let next: StageRow | null = null;
    if (routeTarget) {
      next = await db
        .prepare(
        "SELECT id, process_id, sequence, rule_set_id, evaluation_scope, requires_org, required_permission FROM process_stages WHERE id = ?"
      )
        .bind(routeTarget)
        .first<StageRow>();
    } else {
      next = await nextStageInSequence(db, stage.process_id, stage.sequence, instance.process_version);
    }

    // decision 0480: an invoice cannot leave its last real checkpoint —
    // the hand-off into an automatic stage, or off the end of the
    // process entirely — without a supplier the ERP can be told about.
    // See erpReleaseGuard's own comment for why this is hardcoded
    // rather than another tenant rule.
    const erpGuardResult =
      !next || !next.rule_set_id ? await erpReleaseGuard(db, stage, next, instance, facts, visitId) : 0;
    if (typeof erpGuardResult !== "number") return erpGuardResult;
    const erpTasksCreated = erpGuardResult;

    visitsThisCall.push({ stageId: stage.id, outcome: anyMatched ? "matched" : "no_match", tasksCreated: erpTasksCreated });

    if (erpTasksCreated > 0) {
      return { status: 200, body: { instanceId: currentInstanceId, status: "in_progress", currentStageId: stage.id, visits: visitsThisCall, correctedFacts } };
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
 * What `onTaskCompleted` learned, for its caller to act on —
 * decision 0454.
 *
 * This function never loads facts for a subject (workflow-engine.ts's
 * own long-standing, deliberate boundary — the engine is subject-
 * agnostic, and nothing here assumes what a given subject_type's
 * facts even look like). So the moment its cascade reaches a stage
 * that genuinely needs a real, fact-aware evaluation to go further,
 * it cannot finish the job itself — it reports exactly where it
 * stopped instead, so a caller that DOES know how to load facts for
 * this subject (index.ts, which already does for the `/visit` route)
 * can make the one call — `visitCurrentStage`, with real facts — that
 * stage actually needs.
 */
export interface TaskCompletionCascadeResult {
  /** Absent when the cascade ran to completion, or is still blocked on other open tasks at the same visit — nothing further for the caller to do. */
  needsEvaluationAt?: { instanceId: string; stageId: string };
}

/**
 * Called after a task completes (task-route.ts) — checks whether it
 * was the last open task for its stage visit, and if so, advances the
 * owning instance. Cascades through every genuinely automatic stage
 * (`rule_set_id IS NULL` — no facts are needed to know nothing there
 * could ever block it) and stops, still `in_progress`, the moment it
 * reaches a stage that has one attached — reporting that stage back
 * via `needsEvaluationAt` rather than silently leaving the instance
 * parked there.
 *
 * **Not a guess about whether that rule set has any live rules in
 * it.** Before decision 0454, this stopped and returned regardless —
 * the caller had no way to learn it had happened, and a stage whose
 * rule set turned out to hold no rules at all (so a real evaluation
 * would have advanced straight past it) was stranded exactly as hard
 * as one that genuinely needed a task. Found live: an invoice needed
 * a person to clear a Validation task, and once they did, it sat at
 * the very next stage indefinitely — no task, no error, nothing
 * anywhere to explain it, because nothing had ever actually evaluated
 * that stage. Every invoice that validated cleanly, with no task ever
 * raised, never touched this path at all — it cascaded through the
 * identical stage correctly, via the intake call's own
 * `visitCurrentStage`, which does load real facts. Only the ones that
 * needed a person to clear a task anywhere upstream were at risk.
 */
export async function onTaskCompleted(db: D1Database, taskId: string): Promise<TaskCompletionCascadeResult> {
  const task = await db
    .prepare("SELECT stage_visit_id FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<{ stage_visit_id: string | null }>();
  if (!task?.stage_visit_id) return {};

  const openCount = await db
    // 'open', not `completed_by IS NULL` — decision 0075. A returned or
    // cancelled task is not waiting on anybody, and counting it as open
    // would block its instance forever with nothing left to complete.
    .prepare("SELECT count(*) AS n FROM tasks WHERE stage_visit_id = ? AND status = 'open'")
    .bind(task.stage_visit_id)
    .first<{ n: number }>();
  if ((openCount?.n ?? 0) > 0) return {};

  const visit = await db
    .prepare("SELECT process_instance_id, stage_id FROM stage_visits WHERE id = ?")
    .bind(task.stage_visit_id)
    .first<{ process_instance_id: string; stage_id: string }>();
  if (!visit) return {};

  const instance = await db
    .prepare("SELECT id, status, process_version FROM process_instances WHERE id = ?")
    .bind(visit.process_instance_id)
    .first<{ id: string; status: string; process_version: number }>();
  if (!instance || instance.status !== "in_progress") return {};

  const stage = await db
    .prepare("SELECT id, process_id, sequence FROM process_stages WHERE id = ?")
    .bind(visit.stage_id)
    .first<StageRow>();
  if (!stage) return {};

  let currentSequence = stage.sequence;
  for (let i = 0; i < MAX_STAGES_PER_VISIT; i++) {
    const next = await nextStageInSequence(db, stage.process_id, currentSequence, instance.process_version);
    if (!next) {
      await db
        .prepare("UPDATE process_instances SET status = 'completed', updated_at = ? WHERE id = ?")
        .bind(new Date().toISOString(), instance.id)
        .run();
      return {};
    }
    currentSequence = next.sequence;
    await db
      .prepare("UPDATE process_instances SET current_stage_id = ?, updated_at = ? WHERE id = ?")
      .bind(next.id, new Date().toISOString(), instance.id)
      .run();
    if (next.rule_set_id) {
      // Stop here — this function never loads facts for a subject, so
      // it cannot evaluate a real rule set itself. Reported, not
      // silently swallowed (decision 0454) — see the caller in
      // index.ts, which follows up with a genuine visitCurrentStage
      // call using real facts.
      return { needsEvaluationAt: { instanceId: instance.id, stageId: next.id } };
    }
    await db
      .prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, ?, 'automatic', strftime('%Y-%m-%d %H:%M:%f', 'now'))")
      .bind(crypto.randomUUID(), instance.id, next.id)
      .run();
  }
  return {};
}
