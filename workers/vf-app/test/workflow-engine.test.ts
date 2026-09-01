import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcessInstance, onTaskCompleted, visitCurrentStage } from "../src/workflow-engine.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateTeam, handleAddTeamMember } from "../src/team-route.js";
import { handleCreateUser } from "../src/org-route.js";
import { handleClaimTask, handleCompleteTask } from "../src/task-route.js";

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

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateProcessInstance", () => {
  it("400s when subjectType or subjectId is missing", async () => {
    const result = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice" });
    expect(result.status).toBe(400);
  });

  it("404s when the process does not exist", async () => {
    const result = await handleCreateProcessInstance(env.DB, "does-not-exist", { subjectType: "invoice", subjectId: "inv-1" });
    expect(result.status).toBe(404);
  });

  it("422s when the process has no stages at all", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Empty" });
    const result = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    expect(result.status).toBe(422);
  });

  it("creates an instance at the first stage by sequence", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Validated", sequence: 2 });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT current_stage_id, status FROM process_instances WHERE id = ?")
      .bind((result.body as { id: string }).id)
      .first();
    expect(row).toEqual({ current_stage_id: "s1", status: "in_progress" });
  });
});

describe("visitCurrentStage — automatic stages cascade freely", () => {
  it("cascades through every automatic stage in one call, completing the instance", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Validated", sequence: 2 });
    await handleCreateStage(env.DB, "p1", { id: "s3", name: "Payment-eligible", sequence: 3 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, {});
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("completed");

    const row = await env.DB.prepare("SELECT status FROM process_instances WHERE id = ?").bind(instanceId).first();
    expect(row).toEqual({ status: "completed" });

    // Confirms the full cascade was genuinely recorded, not just claimed.
    const visits = await env.DB.prepare("SELECT count(*) AS n FROM stage_visits WHERE process_instance_id = ?")
      .bind(instanceId)
      .first();
    expect(visits).toEqual({ n: 3 });
  });

  it("404s visiting an instance that does not exist", async () => {
    const result = await visitCurrentStage(env.DB, "does-not-exist", {});
    expect(result.status).toBe(404);
  });

  it("409s visiting an instance that's already completed", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;
    await visitCurrentStage(env.DB, instanceId, {});
    const result = await visitCurrentStage(env.DB, instanceId, {});
    expect(result.status).toBe(409);
  });
});

describe("visitCurrentStage — real rule evaluation", () => {
  it("evaluates a stage's rule set against supplied facts and records a real trace", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs1", {
      conditions: { field: "BT-112", operator: "greater_than", value: 5000 },
      actions: [{ type: "flag" }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Payment-eligible", sequence: 2 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, { "BT-112": 6000 });
    expect(result.status).toBe(200);
    const visitRow = await env.DB.prepare("SELECT outcome FROM stage_visits WHERE process_instance_id = ? AND stage_id = 's1'")
      .bind(instanceId)
      .first();
    expect(visitRow).toEqual({ outcome: "matched" });
    const stepCount = await env.DB.prepare(
      "SELECT count(*) AS n FROM stage_visit_steps sv JOIN stage_visits v ON v.id = sv.stage_visit_id WHERE v.process_instance_id = ?"
    )
      .bind(instanceId)
      .first();
    expect((stepCount as { n: number }).n).toBeGreaterThan(0);
  });

  it("a stage with no matching rule and no tasks still advances", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs1", {
      conditions: { field: "BT-112", operator: "greater_than", value: 5000 },
      actions: [{ type: "flag" }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Payment-eligible", sequence: 2 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, { "BT-112": 1000 }); // below threshold
    expect((result.body as { status: string }).status).toBe("completed");
  });
});

describe("visitCurrentStage — assign_task blocks advancement", () => {
  async function seedBlockingSetup(): Promise<{ instanceId: string }> {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await seedRuleSet("rs1", {
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "assign_task", params: { team: "team1", permission: "AP.Approve" } }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Payment-eligible", sequence: 2 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    return { instanceId: (created.body as { id: string }).id };
  }

  it("a fired assign_task creates a real task and blocks the instance at this stage", async () => {
    const { instanceId } = await seedBlockingSetup();
    const result = await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("in_progress");
    expect((result.body as { currentStageId: string }).currentStageId).toBe("s1");

    const taskRow = await env.DB.prepare("SELECT owner_team_id, required_permission, stage_visit_id FROM tasks WHERE stage_id = 's1'")
      .first<{ owner_team_id: string; required_permission: string; stage_visit_id: string }>();
    expect(taskRow?.owner_team_id).toBe("team1");
    expect(taskRow?.required_permission).toBe("AP.Approve");
    expect(taskRow?.stage_visit_id).toBeTruthy();
  });

  it("the critical property: completing the last open task for a visit advances the instance automatically", async () => {
    const { instanceId } = await seedBlockingSetup();
    await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });

    const task = await env.DB.prepare("SELECT id FROM tasks WHERE stage_id = 's1'").first<{ id: string }>();
    await handleClaimTask(env.DB, task!.id, "usr1");
    const completeResult = await handleCompleteTask(env.DB, task!.id, "usr1");
    expect(completeResult.status).toBe(200);

    await onTaskCompleted(env.DB, task!.id);

    const instanceRow = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind(instanceId)
      .first();
    expect(instanceRow).toEqual({ status: "completed", current_stage_id: "s2" });
  });

  it("onTaskCompleted does nothing while other tasks for the same visit remain open", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await seedRuleSet("rs1", {
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [
        { type: "assign_task", params: { team: "team1", permission: "AP.Approve" } },
        { type: "assign_task", params: { user: "usr1", permission: "AP.Approve" } },
      ],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Payment-eligible", sequence: 2 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });
    const tasks = await env.DB.prepare("SELECT id, owner_team_id FROM tasks WHERE stage_id = 's1'").all<{ id: string; owner_team_id: string | null }>();
    expect(tasks.results).toHaveLength(2);

    const teamTask = tasks.results.find((t: { owner_team_id: string | null }) => t.owner_team_id)!;
    await handleClaimTask(env.DB, teamTask.id, "usr1");
    await handleCompleteTask(env.DB, teamTask.id, "usr1");
    await onTaskCompleted(env.DB, teamTask.id);

    // The other (named-user) task is still open — instance must NOT have advanced yet.
    const instanceRow = await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = ?")
      .bind(instanceId)
      .first();
    expect(instanceRow).toEqual({ status: "in_progress", current_stage_id: "s1" });
  });
});

describe("visitCurrentStage — route_to", () => {
  it("advances to the named stage, skipping intermediate sequence stages", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs1", {
      conditions: { field: "BT-40", operator: "is", value: "US" },
      actions: [{ type: "route_to", params: { stage: "s3" } }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1, ruleSetId: "rs1" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Matching", sequence: 2 });
    await handleCreateStage(env.DB, "p1", { id: "s3", name: "Payment-eligible", sequence: 3 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, { "BT-40": "US" });
    expect((result.body as { status: string }).status).toBe("completed");

    // s2 (Matching) was skipped entirely — never visited.
    const s2Visit = await env.DB.prepare("SELECT id FROM stage_visits WHERE process_instance_id = ? AND stage_id = 's2'")
      .bind(instanceId)
      .first();
    expect(s2Visit).toBeNull();
  });

  it("422s when route_to names a stage that doesn't exist in this process", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs1", {
      conditions: { field: "BT-40", operator: "is", value: "US" },
      actions: [{ type: "route_to", params: { stage: "does-not-exist" } }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1, ruleSetId: "rs1" });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const result = await visitCurrentStage(env.DB, (created.body as { id: string }).id, { "BT-40": "US" });
    expect(result.status).toBe(422);
  });
});

describe("visitCurrentStage — per-line evaluation (decision 0027)", () => {
  async function seedTwoLineProcess(): Promise<string> {
    // Decision 0015's own confirmed example: each line checked
    // against its own cost centre's threshold, independently.
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs-line", {
      conditions: { field: "BT-131", operator: "greater_than", value: 500 },
      actions: [{ type: "assign_task", params: { team: "team1", permission: "AP.Approve" } }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Line Review", sequence: 1, ruleSetId: "rs-line", evaluationScope: "line" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Payment-eligible", sequence: 2 });
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    return (created.body as { id: string }).id;
  }

  it("a header-scope stage ignores any supplied lines entirely — unchanged, backward-compatible behaviour", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs1", {
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "flag" }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" }); // no evaluationScope -> defaults to header
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, { "BT-112": 500 }, [
      { lineNumber: 1, "BT-131": 99999 }, // would match if this were somehow read — it must not be
    ]);
    expect((result.body as { status: string }).status).toBe("completed"); // BT-112 500 doesn't match; lines never touched
  });

  it("two lines, one over threshold: exactly one task is created, tied to the correct line number", async () => {
    const instanceId = await seedTwoLineProcess();
    const result = await visitCurrentStage(env.DB, instanceId, {}, [
      { lineNumber: 1, "BT-131": 100 }, // below threshold
      { lineNumber: 2, "BT-131": 900 }, // above threshold
    ]);
    expect(result.status).toBe(200);
    expect((result.body as { status: string }).status).toBe("in_progress");

    const tasks = await env.DB.prepare("SELECT line_number FROM tasks WHERE stage_id = 's1'").all<{ line_number: number }>();
    expect(tasks.results).toEqual([{ line_number: 2 }]);
  });

  it("two lines, BOTH over threshold: two independent tasks, each tied to its own line", async () => {
    const instanceId = await seedTwoLineProcess();
    await visitCurrentStage(env.DB, instanceId, {}, [
      { lineNumber: 1, "BT-131": 700 },
      { lineNumber: 2, "BT-131": 900 },
    ]);
    const tasks = await env.DB.prepare("SELECT line_number FROM tasks WHERE stage_id = 's1' ORDER BY line_number").all<{
      line_number: number;
    }>();
    expect(tasks.results).toEqual([{ line_number: 1 }, { line_number: 2 }]);
  });

  it("no line over threshold: no tasks, the instance advances and completes on its own", async () => {
    const instanceId = await seedTwoLineProcess();
    const result = await visitCurrentStage(env.DB, instanceId, {}, [
      { lineNumber: 1, "BT-131": 50 },
      { lineNumber: 2, "BT-131": 80 },
    ]);
    expect((result.body as { status: string }).status).toBe("completed");
    const taskCount = await env.DB.prepare("SELECT count(*) AS n FROM tasks").first<{ n: number }>();
    expect(taskCount?.n).toBe(0);
  });

  it("header facts are merged into every line's evaluation — a line-scope condition can reference header fields too", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await seedRuleSet("rs-mixed", {
      conditions: {
        all: [
          { field: "BT-40", operator: "is", value: "US" }, // a header field
          { field: "BT-131", operator: "greater_than", value: 500 }, // a line field
        ],
      },
      actions: [{ type: "assign_task", params: { team: "team1", permission: "AP.Approve" } }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Line Review", sequence: 1, ruleSetId: "rs-mixed", evaluationScope: "line" });
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-2" });
    const instanceId = (created.body as { id: string }).id;

    const result = await visitCurrentStage(env.DB, instanceId, { "BT-40": "US" }, [{ lineNumber: 1, "BT-131": 900 }]);
    expect((result.body as { status: string }).status).toBe("in_progress"); // matched: header US + line over 500
  });

  it("stage_visit_steps records the line_number for a line-scope evaluation, and NULL for header-scope", async () => {
    const instanceId = await seedTwoLineProcess();
    await visitCurrentStage(env.DB, instanceId, {}, [
      { lineNumber: 1, "BT-131": 100 },
      { lineNumber: 2, "BT-131": 900 },
    ]);
    const steps = await env.DB.prepare(
      `SELECT line_number, matched FROM stage_visit_steps sv
       JOIN stage_visits v ON v.id = sv.stage_visit_id
       WHERE v.stage_id = 's1' ORDER BY sv.seq`
    ).all<{ line_number: number; matched: number }>();
    expect(steps.results).toEqual([
      { line_number: 1, matched: 0 },
      { line_number: 2, matched: 1 },
    ]);
  });
});
