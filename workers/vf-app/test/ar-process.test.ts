import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcessInstance, visitCurrentStage } from "../src/workflow-engine.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateTeam, handleAddTeamMember } from "../src/team-route.js";
import { handleCreateUser } from "../src/org-route.js";

/**
 * The first genuine test of decision 0015's vocabulary-sharing
 * hypothesis: does the SAME closed vocabulary — the same operators,
 * the same actions, the same INVOICE_FIELDS, including `direction` —
 * and the SAME workflow engine, genuinely serve Accounts Receivable
 * without any code change at all, or does something in this codebase
 * quietly assume AP. Nothing here is new production code; every
 * function under test (evaluateRuleSet, the workflow engine,
 * handleCreateTask) was already built and tested for AP. This file's
 * only job is to prove — not assume — that reusing it for AR actually
 * works, using AR.Collect (decision 0009's own honest note: a real
 * permission with no route backing it yet) as the permission a real
 * spawned task requires for the first time anywhere in this codebase.
 */

async function seedRuleSet(id: string, compiledJson: Record<string, unknown>): Promise<void> {
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind(id, "test", "first_match", "active")
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

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("Accounts Receivable, through the real workflow engine — the vocabulary-sharing hypothesis", () => {
  async function seedArProcess(): Promise<void> {
    // The overdue-collection rule: entirely EXISTING vocabulary —
    // `direction` (an existing derived field), `older_than_days` (an
    // existing operator), `assign_task` (an existing action) — no new
    // field, operator, or action was added for this. If this
    // compiles and evaluates correctly, the vocabulary genuinely
    // wasn't AP-specific to begin with.
    await seedRuleSet("ar-collections", {
      conditions: {
        all: [
          { field: "direction", operator: "is", value: "receivable" },
          { field: "BT-9", operator: "older_than_days", value: 30 },
        ],
      },
      actions: [{ type: "assign_task", params: { team: "AR team", permission: "AR.Collect" } }],
    });
    await handleCreateProcess(env.DB, { id: "ar-live", name: "Standard AR" });
    await handleCreateStage(env.DB, "ar-live", { id: "issued", name: "Issued", sequence: 1 });
    await handleCreateStage(env.DB, "ar-live", { id: "awaiting-payment", name: "Awaiting Payment", sequence: 2, ruleSetId: "ar-collections" });
    await handleCreateStage(env.DB, "ar-live", { id: "paid", name: "Paid", sequence: 3 });
    await handleCreateTeam(env.DB, { id: "AR team", name: "AR Team" });
    await handleCreateUser(env.DB, { id: "carol", email: "carol@acme.com", name: "Carol" });
    await handleAddTeamMember(env.DB, "AR team", "carol");
  }

  it("an overdue receivable invoice: the rule matches and spawns a real task requiring AR.Collect", async () => {
    await seedArProcess();
    const created = await handleCreateProcessInstance(env.DB, "ar-live", { subjectType: "invoice", subjectId: "ar-inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      direction: "receivable",
      "BT-9": daysAgo(45), // due 45 days ago — well past the 30-day threshold
    });

    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("in_progress");
    expect((result.body as { currentStageId: string }).currentStageId).toBe("awaiting-payment");

    const task = await env.DB.prepare("SELECT owner_team_id, required_permission FROM tasks WHERE stage_id = 'awaiting-payment'")
      .first<{ owner_team_id: string; required_permission: string }>();
    expect(task).toEqual({ owner_team_id: "AR team", required_permission: "AR.Collect" });
  });

  it("a receivable invoice not yet overdue: no task, the process completes on its own", async () => {
    await seedArProcess();
    const created = await handleCreateProcessInstance(env.DB, "ar-live", { subjectType: "invoice", subjectId: "ar-inv-2" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      direction: "receivable",
      "BT-9": daysAgo(5), // due only 5 days ago — not overdue yet
    });

    expect((result.body as { status: string }).status).toBe("completed");
    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("the critical negative case: a PAYABLE invoice, even if equally overdue, never fires the AR rule — direction genuinely discriminates", async () => {
    await seedArProcess();
    const created = await handleCreateProcessInstance(env.DB, "ar-live", { subjectType: "invoice", subjectId: "ap-inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {
      direction: "payable", // the AP direction, not AR
      "BT-9": daysAgo(90), // just as overdue as the AR case above
    });

    // Same overdue age, opposite direction — must NOT spawn a
    // collections task. If this failed, it would mean `direction`
    // isn't actually discriminating, and the same rule set would
    // wrongly fire AR collection actions against AP's own invoices.
    expect((result.body as { status: string }).status).toBe("completed");
    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("AR and AP processes coexist independently in the same database with no interference", async () => {
    // A real AP process alongside the AR one, both using rule sets
    // and process definitions, proving the two domains don't collide
    // or share any hidden state.
    await seedArProcess();
    await seedRuleSet("ap-approval", {
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "flag" }],
    });
    await handleCreateProcess(env.DB, { id: "ap-live", name: "Standard AP" });
    await handleCreateStage(env.DB, "ap-live", { id: "ap-approval", name: "Approval", sequence: 1, ruleSetId: "ap-approval" });

    const arCreated = await handleCreateProcessInstance(env.DB, "ar-live", { subjectType: "invoice", subjectId: "ar-inv-3" });
    const apCreated = await handleCreateProcessInstance(env.DB, "ap-live", { subjectType: "invoice", subjectId: "ap-inv-2" });

    await visitCurrentStage(env.DB, (arCreated.body as { id: string }).id, { direction: "receivable", "BT-9": daysAgo(45) });
    await visitCurrentStage(env.DB, (apCreated.body as { id: string }).id, { "BT-112": 500 }); // below threshold, no match

    const arInstance = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind((arCreated.body as { id: string }).id)
      .first();
    const apInstance = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind((apCreated.body as { id: string }).id)
      .first();

    expect(arInstance).toEqual({ status: "in_progress", current_stage_id: "awaiting-payment" });
    expect(apInstance).toEqual({ status: "completed", current_stage_id: "ap-approval" });
  });
});
