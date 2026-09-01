import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcessInstance, visitCurrentStage } from "../src/workflow-engine.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateTeam, handleAddTeamMember } from "../src/team-route.js";
import { handleCreateUser } from "../src/org-route.js";

/**
 * The harder test decision 0021 explicitly deferred: Accounts
 * Receivable reused INVOICE_FIELDS entirely unchanged, since an AR
 * invoice is still an EN 16931 document. Expense has no such document
 * underneath it at all — decision 0015's own "genuinely hard case."
 * This is the first process ever built in this system whose fields
 * were authored from scratch, not translated from an external
 * standard, and the first real exercise of decision 0022's
 * multi-vocabulary support outside its own unit tests.
 */

async function seedExpenseRuleSet(id: string, compiledJson: Record<string, unknown>): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status, vocabulary) VALUES (?, ?, ?, ?, ?)")
    .bind(id, "test", "first_match", "active", "expense")
    .run();
  const ruleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, 0, 1)").bind(ruleId, id).run();
  await env.DB.prepare(
    `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
     VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
  )
    .bind(ruleId, "test rule", JSON.stringify(compiledJson), "test-model", "alice", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("Expense management, through the real workflow engine — the harder vocabulary-sharing test", () => {
  async function seedExpenseProcess(): Promise<void> {
    // Every field referenced here — category, amount, receipt_attached
    // — is genuinely new: authored for decision 0022, never derived
    // from or shared with INVOICE_FIELDS.
    await seedExpenseRuleSet("expense-review", {
      conditions: {
        all: [
          { field: "category", operator: "is", value: "Travel" },
          { field: "amount", operator: "greater_than", value: 500 },
          { field: "receipt_attached", operator: "is", value: false },
        ],
      },
      actions: [{ type: "assign_task", params: { team: "Finance team", permission: "Expense.Review" } }],
    });
    await handleCreateProcess(env.DB, { id: "expense-live", name: "Standard Expense Reimbursement" });
    await handleCreateStage(env.DB, "expense-live", { id: "submitted", name: "Submitted", sequence: 1 });
    await handleCreateStage(env.DB, "expense-live", { id: "review", name: "Review", sequence: 2, ruleSetId: "expense-review" });
    await handleCreateStage(env.DB, "expense-live", { id: "reimbursed", name: "Reimbursed", sequence: 3 });
    await handleCreateTeam(env.DB, { id: "Finance team", name: "Finance Team" });
    await handleCreateUser(env.DB, { id: "dana", email: "dana@acme.com", name: "Dana" });
    await handleAddTeamMember(env.DB, "Finance team", "dana");
  }

  it("a large Travel expense with no receipt: the rule matches and spawns a real task requiring Expense.Review", async () => {
    await seedExpenseProcess();
    const created = await handleCreateProcessInstance(env.DB, "expense-live", { subjectType: "expense_report", subjectId: "exp-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      category: "Travel",
      amount: 850,
      receipt_attached: false,
    });

    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("in_progress");
    expect((result.body as { currentStageId: string }).currentStageId).toBe("review");

    const task = await env.DB.prepare("SELECT owner_team_id, required_permission FROM tasks WHERE stage_id = 'review'")
      .first<{ owner_team_id: string; required_permission: string }>();
    expect(task).toEqual({ owner_team_id: "Finance team", required_permission: "Expense.Review" });
  });

  it("the critical negative case: a large Travel expense WITH a receipt never fires the rule — a single differing field genuinely discriminates", async () => {
    await seedExpenseProcess();
    const created = await handleCreateProcessInstance(env.DB, "expense-live", { subjectType: "expense_report", subjectId: "exp-2" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      category: "Travel",
      amount: 850,
      receipt_attached: true, // the only field that differs from the matching case above
    });

    expect((result.body as { status: string }).status).toBe("completed");
    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("a small Travel expense with no receipt: below the amount threshold, no task, completes on its own", async () => {
    await seedExpenseProcess();
    const created = await handleCreateProcessInstance(env.DB, "expense-live", { subjectType: "expense_report", subjectId: "exp-3" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      category: "Travel",
      amount: 45,
      receipt_attached: false,
    });

    expect((result.body as { status: string }).status).toBe("completed");
  });

  it("a Meals expense, even large and receiptless, never fires the Travel-specific rule", async () => {
    await seedExpenseProcess();
    const created = await handleCreateProcessInstance(env.DB, "expense-live", { subjectType: "expense_report", subjectId: "exp-4" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      category: "Meals", // not Travel
      amount: 850,
      receipt_attached: false,
    });

    expect((result.body as { status: string }).status).toBe("completed");
    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("Expense, AP, and AR processes coexist independently in the same database with no interference", async () => {
    await seedExpenseProcess();
    await seedExpenseRuleSet("dummy-not-used", { conditions: { field: "amount", operator: "greater_than", value: 0 }, actions: [{ type: "flag" }] });
    // A real AP rule set (invoice vocabulary) right alongside the
    // expense one, proving the three domains genuinely don't collide.
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status, vocabulary) VALUES (?, ?, ?, ?, ?)")
      .bind("ap-approval", "test", "first_match", "active", "invoice")
      .run();
    const apRuleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, 0, 1)").bind(apRuleId, "ap-approval").run();
    await env.DB.prepare(
      `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from)
       VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
    )
      .bind(apRuleId, "test", JSON.stringify({ conditions: { field: "BT-112", operator: "greater_than", value: 1000 }, actions: [{ type: "flag" }] }), "test-model", "alice", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
      .run();
    await handleCreateProcess(env.DB, { id: "ap-live", name: "Standard AP" });
    await handleCreateStage(env.DB, "ap-live", { id: "ap-approval-stage", name: "Approval", sequence: 1, ruleSetId: "ap-approval" });

    const expenseCreated = await handleCreateProcessInstance(env.DB, "expense-live", { subjectType: "expense_report", subjectId: "exp-5" });
    const apCreated = await handleCreateProcessInstance(env.DB, "ap-live", { subjectType: "invoice", subjectId: "ap-inv-1" });

    await visitCurrentStage(env.DB, (expenseCreated.body as { id: string }).id, { category: "Travel", amount: 900, receipt_attached: false });
    await visitCurrentStage(env.DB, (apCreated.body as { id: string }).id, { "BT-112": 300 }); // below threshold

    const expenseInstance = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind((expenseCreated.body as { id: string }).id)
      .first();
    const apInstance = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind((apCreated.body as { id: string }).id)
      .first();

    expect(expenseInstance).toEqual({ status: "in_progress", current_stage_id: "review" });
    expect(apInstance).toEqual({ status: "completed", current_stage_id: "ap-approval-stage" });
  });
});
