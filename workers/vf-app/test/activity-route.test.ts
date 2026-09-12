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
  opts: { name?: string; sourceText: string; actions: unknown[] }
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
    "INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched) VALUES (?, 0, ?, 1, 1)"
  )
    .bind(visitId, ruleId)
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
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('team-ap', 'AP Team')").run();
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
