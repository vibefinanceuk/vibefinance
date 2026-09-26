import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleGetActivity, handlePostComment } from "../src/activity-route.js";

/**
 * The document activity feed — decision 0267.
 *
 * **The highest-risk part of this build.** Four different sources
 * (an invoice's own creation, completed tasks, fired rules, and real
 * comments) are merged into one chronological feed; each source needs
 * its own seeding and its own check that the feed says exactly what
 * the underlying data says — no more, no less.
 */

async function seedProcess() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
}

async function seedStage(id: string, name: string, sequence = 1) {
  await env.DB.prepare(
    "INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES (?, 'ap', ?, ?)"
  )
    .bind(id, name, sequence)
    .run();
}

async function seedUser(id: string, name: string) {
  await env.DB.prepare("INSERT OR IGNORE INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, name)
    .run();
}

async function seedInvoice(id: string, createdAt = "2026-09-01 09:00:00") {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, created_at) VALUES (?, '{}', ?)")
    .bind(id, createdAt)
    .run();
}

/** A real stage visit, for a task or a rule firing to hang off. */
async function seedVisit(visitId: string, invoiceId: string, stageId: string, createdAt: string) {
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, ?, 'in_progress')"
  )
    .bind(`pi-${visitId}`, invoiceId, stageId)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, ?, 'matched', ?)"
  )
    .bind(visitId, `pi-${visitId}`, stageId, createdAt)
    .run();
}

/** An open task, hung off a real stage visit — decision 0488's own tests. */
async function seedOpenTask(taskId: string, visitId: string, stageId: string) {
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, required_permission, status)
     VALUES (?, ?, ?, 'AP.Validate', 'open')`
  )
    .bind(taskId, stageId, visitId)
    .run();
}

/**
 * A row in the one genuinely new table decisions 0488/0489/0497 add.
 * `targetUserId` is meaningful only for `reassign` and
 * `route_to_approver` — the one fact those two actions carry that
 * claim/release do not (migration 0086's own standing invariant).
 */
async function recordTaskAction(
  eventId: string,
  taskId: string,
  action: "claim" | "release" | "reassign" | "route_to_approver",
  actorId: string,
  at: string,
  comment: string | null = null,
  targetUserId: string | null = null
) {
  await env.DB.prepare(
    "INSERT INTO task_action_events (id, task_id, action, actor_id, at, comment, target_user_id) VALUES (?, ?, ?, ?, ?, ?, ?)"
  )
    .bind(eventId, taskId, action, actorId, at, comment, targetUserId)
    .run();
}

/**
 * Return / return-to-supplier / discard, written the same way
 * `endTaskAndSiblings` (return-route.ts) actually writes them —
 * directly on `tasks`, nothing in `task_action_events`, since decision
 * 0488 derives these three read-time rather than storing them twice.
 */
async function endTask(
  taskId: string,
  visitId: string,
  stageId: string,
  endedBy: string,
  at: string,
  opts: { status: "returned" | "discarded" | "cancelled"; reason: string; returnedToStageId?: string | null }
) {
  await seedOpenTask(taskId, visitId, stageId);
  await env.DB.prepare(
    `UPDATE tasks SET status = ?, ended_by = ?, ended_at = ?, end_reason = ?, returned_to_stage_id = ? WHERE id = ?`
  )
    .bind(opts.status, endedBy, at, opts.reason, opts.returnedToStageId ?? null, taskId)
    .run();
}

async function completeTask(
  taskId: string,
  visitId: string,
  stageId: string,
  completedBy: string,
  completedAt: string
) {
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, required_permission, status, completed_by, completed_at)
     VALUES (?, ?, ?, 'AP.Validate', 'completed', ?, ?)`
  )
    .bind(taskId, stageId, visitId, completedBy, completedAt)
    .run();
}

async function fireRule(
  visitId: string,
  ruleId: string,
  opts: { name?: string; sourceText: string; actions: unknown[]; lineNumber?: number | null }
) {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode) VALUES ('rs-1', 'rs', 'all_matches')").run();
  await env.DB.prepare(
    "INSERT OR IGNORE INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, 'rs-1', 0, 1, ?)"
  )
    .bind(ruleId, opts.name ?? null)
    .run();
  await env.DB.prepare(
    `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by)
     VALUES (?, 1, ?, ?, 'test-model@v1')`
  )
    .bind(ruleId, opts.sourceText, JSON.stringify({ conditions: {}, actions: opts.actions }))
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched, line_number) VALUES (?, 0, ?, 1, 1, ?)"
  )
    .bind(visitId, ruleId, opts.lineNumber ?? null)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedProcess();
});

describe("what the feed contains, per source (decision 0267)", () => {
  it("404s for a document that does not exist", async () => {
    const result = await handleGetActivity(env.DB, "nope");
    expect(result.status).toBe(404);
  });

  it("carries the received event, from the invoice's own creation", async () => {
    await seedInvoice("inv-1", "2026-09-01 09:00:00");
    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: { kind: string; at: string }[] }).items;
    expect(items).toEqual([{ kind: "received", at: "2026-09-01 09:00:00" }]);
  });

  it("names the stage and the person for a completed task", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await completeTask("t-1", "v-1", "validation", "u-priya", "2026-09-01 11:00:00");

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const completion = items.find((i) => i.kind === "stage_completed");
    expect(completion).toEqual({
      kind: "stage_completed",
      at: "2026-09-01 11:00:00",
      stageName: "Validation",
      userName: "Priya Patel",
    });
  });

  it("names a rule by its own name, when it has one", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", {
      name: "Spend Threshold",
      sourceText: "flag anything over 10000",
      actions: [{ type: "flag" }],
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "rule_fired")?.ruleName).toBe("Spend Threshold");
  });

  it("falls back to the compiled sentence when a rule has no name", async () => {
    // **No "completer row is gone" test either, for the same reason.**
    // completed_by and author_id are both FK-enforced and NOT NULL, and
    // org_users.name is itself NOT NULL — a completed task's completer
    // and a comment's author always have a real name to read. Confirmed
    // directly: the schema itself refuses the insert this would need.
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", { sourceText: "flag anything over 10000", actions: [{ type: "flag" }] });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "rule_fired")?.ruleName).toBe("flag anything over 10000");
  });

  it("describes route_to and assign_task firing together, the operator's own example", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedStage("ap-review", "AP Review", 2);
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-ap', 'AP Team', 'u1')").run();
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", {
      name: "Spend Threshold",
      sourceText: "route invoices over 10000 to the AP team for review",
      actions: [
        { type: "route_to", params: { stage: "ap-review" } },
        { type: "assign_task", params: { team: "team-ap", permission: "AP.Review" } },
      ],
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const fired = items.find((i) => i.kind === "rule_fired");
    expect(fired?.actionDescriptions).toEqual(["routed to AP Review", "assigned to AP Team"]);
  });

  it("only ever describes a matched firing, never one the interpreter evaluated but rejected", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", { sourceText: "flag it", actions: [{ type: "flag" }] });
    // A second rule at the same visit, evaluated and NOT matched.
    await env.DB.prepare(
      "INSERT OR IGNORE INTO rules (id, rule_set_id, sort_order, enabled) VALUES ('r-2', 'rs-1', 1, 1)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by) VALUES ('r-2', 1, 'unmatched rule', '{\"conditions\":{},\"actions\":[]}', 'test')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched) VALUES ('v-1', 1, 'r-2', 1, 0)"
    ).run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.filter((i) => i.kind === "rule_fired")).toHaveLength(1);
  });

  it("describes every real action, not just route_to and assign_task", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('unit-fr', 'Acme France', 'legal_entity')").run();
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", {
      sourceText: "the whole vocabulary at once",
      actions: [
        { type: "assign_org", params: { org: "unit-fr" } },
        { type: "assign_cost_centre", params: { value: "CC-100" } },
        { type: "hold_until", params: { date: "2026-10-01" } },
        { type: "reject" },
        { type: "tag", params: { value: "urgent" } },
        { type: "set_field", params: { field: "BT-13", value: "PO-9" } },
        { type: "notify", params: { target: "finance@acme.com" } },
        { type: "escalate_after", params: { after: "2d" } },
      ],
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "rule_fired")?.actionDescriptions).toEqual([
      "assigned to Acme France",
      "assigned cost centre CC-100",
      "held until 2026-10-01",
      "rejected it",
      "tagged it \u2018urgent\u2019",
      "set BT-13",
      "sent a notification to finance@acme.com",
      "will escalate after 2d",
    ]);
  });

  /**
   * **A line-scoped rule set (decision 0027) evaluates once per
   * invoice line** — `evaluateRuleSet` runs against each line in
   * turn, and every matched evaluation gets its own `stage_visit_steps`
   * row, `line_number` included. A rule that matches on several lines
   * of the same invoice, at the same stage visit, produced one
   * identical, same-timestamp `rule_fired` entry per line — nothing
   * told them apart. This collapses them into one entry per (visit,
   * rule), carrying which lines it fired on rather than discarding
   * that and just deduplicating blindly.
   */
  it("collapses a line-scoped rule's own firings into one entry, not one per line", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", {
      name: "Line Threshold",
      sourceText: "flag any line over 5000",
      actions: [{ type: "flag" }],
      lineNumber: 5,
    });
    // The same rule, matched again for two more lines at the same
    // visit — the real shape decision 0027's per-line evaluation
    // produces, not a hypothetical one.
    await env.DB.prepare(
      "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched, line_number) VALUES ('v-1', 1, 'r-1', 1, 1, 2)"
    ).run();
    await env.DB.prepare(
      "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched, line_number) VALUES ('v-1', 2, 'r-1', 1, 1, 7)"
    ).run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const fired = items.filter((i) => i.kind === "rule_fired");

    expect(fired).toHaveLength(1);
    // Sorted, not insertion order — line 5 fired first here.
    expect(fired[0].lines).toEqual([2, 5, 7]);
  });

  it("carries no lines at all for an ordinary header-scoped firing", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 10:00:00");
    await fireRule("v-1", "r-1", { sourceText: "flag it", actions: [{ type: "flag" }] });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "rule_fired")?.lines).toEqual([]);
  });

  it("carries a comment, with the commenter's name", async () => {
    await seedInvoice("inv-1");
    await seedUser("u-priya", "Priya Patel");
    await env.DB.prepare(
      "INSERT INTO document_comments (id, invoice_id, author_id, body, created_at) VALUES ('c-1', 'inv-1', 'u-priya', 'Checked with procurement.', '2026-09-01 12:00:00')"
    ).run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "comment")).toEqual({
      kind: "comment",
      at: "2026-09-01 12:00:00",
      id: "c-1",
      body: "Checked with procurement.",
      userName: "Priya Patel",
    });
  });

  it("merges every source into one feed, in chronological order", async () => {
    await seedInvoice("inv-1", "2026-09-01 09:00:00");
    await seedStage("validation", "Validation");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "validation", "2026-09-01 09:30:00");
    await fireRule("v-1", "r-1", { sourceText: "flag it", actions: [{ type: "flag" }] });
    await completeTask("t-1", "v-1", "validation", "u-priya", "2026-09-01 11:00:00");
    await env.DB.prepare(
      "INSERT INTO document_comments (id, invoice_id, author_id, body, created_at) VALUES ('c-1', 'inv-1', 'u-priya', 'Done.', '2026-09-01 10:00:00')"
    ).run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: { kind: string }[] }).items;
    expect(items.map((i) => i.kind)).toEqual(["received", "rule_fired", "comment", "stage_completed"]);
  });
});

describe("task actions — claim/release/return/discard (decision 0488)", () => {
  it("carries a claim, with the actor's name and no comment", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await seedOpenTask("t-1", "v-1", "coding");
    await recordTaskAction("e-1", "t-1", "claim", "u-priya", "2026-09-01 09:05:00");

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "action_taken")).toEqual({
      kind: "action_taken",
      at: "2026-09-01 09:05:00",
      action: "claim",
      userName: "Priya Patel",
      comment: null,
    });
  });

  it("carries a release, with its comment", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await seedOpenTask("t-1", "v-1", "coding");
    await recordTaskAction("e-1", "t-1", "release", "u-priya", "2026-09-01 09:10:00", "Handing this to Sam.");

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "action_taken")).toEqual({
      kind: "action_taken",
      at: "2026-09-01 09:10:00",
      action: "release",
      userName: "Priya Patel",
      comment: "Handing this to Sam.",
    });
  });

  it("carries a reassign, naming who it went to", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedUser("u-sam", "Sam Okafor");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await seedOpenTask("t-1", "v-1", "coding");
    await recordTaskAction("e-1", "t-1", "reassign", "u-priya", "2026-09-01 09:15:00", "She knows this supplier.", "u-sam");

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "action_taken")).toEqual({
      kind: "action_taken",
      at: "2026-09-01 09:15:00",
      action: "reassign",
      userName: "Priya Patel",
      comment: "She knows this supplier.",
      targetUserName: "Sam Okafor",
    });
  });

  /**
   * Decision 0497 — the same shape as the reassign test directly
   * above, for the second (and, per migration 0086's own standing
   * invariant, only other) action that ever names a target user.
   */
  it("carries a route_to_approver, naming who it was routed to", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedUser("u-sam", "Sam Okafor");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await seedOpenTask("t-1", "v-1", "coding");
    await recordTaskAction(
      "e-1",
      "t-1",
      "route_to_approver",
      "u-priya",
      "2026-09-01 09:15:00",
      "Please check the VAT rate.",
      "u-sam"
    );

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "action_taken")).toEqual({
      kind: "action_taken",
      at: "2026-09-01 09:15:00",
      action: "route_to_approver",
      userName: "Priya Patel",
      comment: "Please check the VAT rate.",
      targetUserName: "Sam Okafor",
    });
  });

  it("carries every claim/release cycle on the same task, not only the latest", async () => {
    // The exact gap this decision's migration exists to close:
    // tasks.claimed_by/claimed_at only ever shows the most recent
    // cycle, and release leaves no trace there at all.
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedUser("u-sam", "Sam Okafor");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await seedOpenTask("t-1", "v-1", "coding");
    await recordTaskAction("e-1", "t-1", "claim", "u-priya", "2026-09-01 09:05:00");
    await recordTaskAction("e-2", "t-1", "release", "u-priya", "2026-09-01 09:10:00");
    await recordTaskAction("e-3", "t-1", "claim", "u-sam", "2026-09-01 09:15:00");

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const actions = items.filter((i) => i.kind === "action_taken");
    expect(actions.map((a) => [a.action, a.userName])).toEqual([
      ["claim", "Priya Patel"],
      ["release", "Priya Patel"],
      ["claim", "Sam Okafor"],
    ]);
  });

  it("derives a return-to-stage entry from tasks itself, naming the target stage", async () => {
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedStage("coding", "Coding", 2);
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await endTask("t-1", "v-1", "coding", "u-priya", "2026-09-01 09:20:00", {
      status: "returned",
      reason: "PO amount does not match",
      returnedToStageId: "validation",
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "action_taken")).toEqual({
      kind: "action_taken",
      at: "2026-09-01 09:20:00",
      action: "return",
      userName: "Priya Patel",
      comment: "PO amount does not match",
      targetStageName: "Validation",
    });
  });

  it("derives a return-to-supplier entry, with no target stage", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await endTask("t-1", "v-1", "coding", "u-priya", "2026-09-01 09:20:00", {
      status: "returned",
      reason: "Wrong supplier entirely",
      returnedToStageId: null,
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const item = items.find((i) => i.kind === "action_taken");
    expect(item?.action).toBe("return_to_supplier");
    expect(item?.targetStageName).toBeUndefined();
    // Neither column exists yet on this instance — decision 0498's own
    // fields render as absent, not as null or empty strings.
    expect(item?.supplierComment).toBeUndefined();
    expect(item?.emailStatus).toBeUndefined();
  });

  it("carries decision 0498's own supplier comment and email status on a return-to-supplier entry", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await endTask("t-1", "v-1", "coding", "u-priya", "2026-09-01 09:20:00", {
      status: "returned",
      reason: "Duplicate invoice",
      returnedToStageId: null,
    });
    await env.DB.prepare("UPDATE process_instances SET supplier_comment = ? WHERE id = 'pi-v-1'")
      .bind("please resend as a credit note")
      .run();
    await env.DB.prepare(
      `INSERT INTO supplier_return_emails
         (id, process_instance_id, task_id, to_address, subject, body, status, created_by)
       VALUES ('email-1', 'pi-v-1', 't-1', 'supplier@example.com', 'subj', 'body', 'delivered', 'u-priya')`
    ).run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const item = items.find((i) => i.kind === "action_taken");
    expect(item?.supplierComment).toBe("please resend as a credit note");
    expect(item?.emailStatus).toBe("delivered");
    expect(item?.emailToAddress).toBe("supplier@example.com");
  });

  it("never carries the supplier comment or email status on an ordinary return-to-a-stage entry", async () => {
    // Both columns live on process_instances, so a stray value there
    // must never leak onto a "return" item just because it shares the
    // same instance.
    await seedInvoice("inv-1");
    await seedStage("validation", "Validation");
    await seedStage("coding", "Coding", 2);
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await endTask("t-1", "v-1", "coding", "u-priya", "2026-09-01 09:20:00", {
      status: "returned",
      reason: "PO amount does not match",
      returnedToStageId: "validation",
    });
    await env.DB.prepare("UPDATE process_instances SET supplier_comment = 'unrelated' WHERE id = 'pi-v-1'").run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    const item = items.find((i) => i.kind === "action_taken");
    expect(item?.action).toBe("return");
    expect(item?.supplierComment).toBeUndefined();
    expect(item?.emailStatus).toBeUndefined();
  });

  it("derives a discard entry", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await endTask("t-1", "v-1", "coding", "u-priya", "2026-09-01 09:20:00", {
      status: "discarded",
      reason: "Duplicate of inv-0",
      returnedToStageId: null,
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "action_taken")?.action).toBe("discard");
  });

  /**
   * **The `cancelled` siblings `endTaskAndSiblings` produces are not a
   * person's own action** — a task moot because a sibling returned the
   * document should not read as if the person holding it did
   * something. Confirmed directly rather than assumed: `status IN
   * ('returned', 'discarded')` is what excludes it here.
   */
  it("never surfaces a cancelled sibling task as its own action", async () => {
    await seedInvoice("inv-1");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 09:00:00");
    await endTask("t-2", "v-1", "coding", "u-priya", "2026-09-01 09:20:00", {
      status: "cancelled",
      reason: "the document was returned from this stage",
      returnedToStageId: null,
    });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.filter((i) => i.kind === "action_taken")).toHaveLength(0);
  });

  it("merges claim, release and return alongside every other source, in chronological order", async () => {
    await seedInvoice("inv-1", "2026-09-01 08:00:00");
    await seedStage("coding", "Coding");
    await seedUser("u-priya", "Priya Patel");
    await seedVisit("v-1", "inv-1", "coding", "2026-09-01 08:30:00");
    await seedOpenTask("t-1", "v-1", "coding");
    await recordTaskAction("e-1", "t-1", "claim", "u-priya", "2026-09-01 09:00:00");
    await env.DB.prepare(
      `UPDATE tasks SET status = 'returned', ended_by = 'u-priya', ended_at = '2026-09-01 09:30:00',
              end_reason = 'Needs the seller to confirm the amount', returned_to_stage_id = NULL
       WHERE id = 't-1'`
    ).run();

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: { kind: string }[] }).items;
    expect(items.map((i) => i.kind)).toEqual(["received", "action_taken", "action_taken"]);
  });
});

describe("posting a comment (decision 0267)", () => {
  it("stores it, with the author derived from the caller, never the body", async () => {
    await seedInvoice("inv-1");
    await seedUser("u-priya", "Priya Patel");

    const result = await handlePostComment(env.DB, "inv-1", "u-priya", {
      body: "Confirmed with the supplier.",
      // A spoofed author, the same shape of attack decision 0010's own
      // test proves against for confirmations and activations.
      authorId: "u-someone-else",
    });

    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT author_id, body FROM document_comments WHERE invoice_id = 'inv-1'")
      .first<{ author_id: string; body: string }>();
    expect(row?.author_id).toBe("u-priya");
    expect(row?.body).toBe("Confirmed with the supplier.");
  });

  it("400s on an empty body", async () => {
    await seedInvoice("inv-1");
    const result = await handlePostComment(env.DB, "inv-1", "u-priya", { body: "   " });
    expect(result.status).toBe(400);
  });

  it("400s when no body is given at all", async () => {
    await seedInvoice("inv-1");
    const result = await handlePostComment(env.DB, "inv-1", "u-priya", {});
    expect(result.status).toBe(400);
  });

  it("404s for a document that does not exist", async () => {
    const result = await handlePostComment(env.DB, "nope", "u-priya", { body: "Anything" });
    expect(result.status).toBe(404);
  });

  it("shows up in the feed immediately after posting", async () => {
    await seedInvoice("inv-1");
    await seedUser("u-priya", "Priya Patel");
    await handlePostComment(env.DB, "inv-1", "u-priya", { body: "Noted." });

    const result = await handleGetActivity(env.DB, "inv-1");
    const items = (result.body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.kind === "comment")?.body).toBe("Noted.");
  });
});
