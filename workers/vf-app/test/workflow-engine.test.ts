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

describe("validation facts reach rule evaluation (decision 0044)", () => {
  async function setupWithRule(compiled: Record<string, unknown>) {
    await handleCreateProcess(env.DB, { id: "p-val", name: "Validation" });
    await seedRuleSet("rs-val", compiled);
    await handleCreateStage(env.DB, "p-val", { id: "s-val", name: "Check", sequence: 1, ruleSetId: "rs-val" });
    const created = await handleCreateProcessInstance(env.DB, "p-val", { subjectType: "invoice", subjectId: "inv-val" });
    return (created.body as { id: string }).id;
  }

  it("fires a rule when validation fails", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "validation.passed", operator: "is", value: false }] },
      actions: [{ type: "flag", params: {} }],
    });
    // No total anywhere — validation must fail, and the rule must see it.
    const result = await visitCurrentStage(env.DB, instanceId, { "BT-1": "SKELS26003894" });
    expect(result.status).toBe(200);
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("matched");
  });

  it("does NOT fire that rule when the invoice is sound", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "validation.passed", operator: "is", value: false }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, {
      "BT-106": 2099,
      "BT-110": 419.8,
      "BT-112": 2518.8,
    });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("no_match");
  });

  it("a rule can test for a SPECIFIC failure using the existing contains operator", async () => {
    // Why validation.failures is a string, not an array: this needs
    // no new operator and no new concept.
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "validation.failures", operator: "contains", value: "total_missing" }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, { "BT-1": "X" });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("matched");
  });

  it("does not fire on a failure that did not occur", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "validation.failures", operator: "contains", value: "date_order" }] },
      actions: [{ type: "flag", params: {} }],
    });
    // Total is missing, but the dates are fine.
    const result = await visitCurrentStage(env.DB, instanceId, { "BT-2": "2026-01-01", "BT-9": "2026-02-01" });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("no_match");
  });

  it("validation never overwrites a real invoice fact", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "BT-112", operator: "greater_than", value: 1000 }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, { "BT-112": 2518.8 });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("matched");
  });
});

describe("validation results are recorded on the stage visit (0044 addendum)", () => {
  async function setupWithRule(compiled: Record<string, unknown>) {
    await handleCreateProcess(env.DB, { id: "p-rec", name: "Recorded" });
    await seedRuleSet("rs-rec", compiled);
    await handleCreateStage(env.DB, "p-rec", { id: "s-rec", name: "Check", sequence: 1, ruleSetId: "rs-rec" });
    const created = await handleCreateProcessInstance(env.DB, "p-rec", {
      subjectType: "invoice",
      subjectId: "inv-rec",
    });
    return (created.body as { id: string }).id;
  }

  const ALWAYS = {
    id: "r1",
    conditions: { all: [{ field: "BT-1", operator: "is_present" }] },
    actions: [{ type: "flag", params: {} }],
  };

  async function visitRow(instanceId: string) {
    return env.DB.prepare(
      "SELECT validation_passed, validation_failures, validation_checked FROM stage_visits WHERE process_instance_id = ?"
    )
      .bind(instanceId)
      .first<{ validation_passed: number; validation_failures: string; validation_checked: string }>();
  }

  it("records a failure, so the audit trail answers 'why was this held' directly", async () => {
    // The gap this closes: establishing whether a real invoice passed
    // validation previously meant joining two tables and inferring
    // from which rule id had matched.
    const instanceId = await setupWithRule(ALWAYS);
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "SKELS26003894" });

    const row = await visitRow(instanceId);
    expect(row?.validation_passed).toBe(0);
    expect(row?.validation_failures).toBe("total_missing");
  });

  it("records a pass, with an empty failure list rather than null", async () => {
    const instanceId = await setupWithRule(ALWAYS);
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1", "BT-112": 2518.8 });

    const row = await visitRow(instanceId);
    expect(row?.validation_passed).toBe(1);
    expect(row?.validation_failures).toBe("");
  });

  it("records WHICH checks ran, so a pass cannot quietly mean 'nothing was checked'", async () => {
    const instanceId = await setupWithRule(ALWAYS);
    await visitCurrentStage(env.DB, instanceId, {
      "BT-1": "INV-1",
      "BT-106": 2099,
      "BT-110": 419.8,
      "BT-112": 2518.8,
    });

    const row = await visitRow(instanceId);
    expect(row?.validation_checked).toContain("vat_arithmetic");
    // The line-sum check could not run — no lines were supplied — and
    // must not appear as though it had.
    expect(row?.validation_checked).not.toContain("line_sum");
  });

  it("records every failure, not just the first", async () => {
    const instanceId = await setupWithRule(ALWAYS);
    await visitCurrentStage(env.DB, instanceId, {
      "BT-1": "INV-1",
      "BT-2": "2026-12-01",
      "BT-9": "2026-01-01",
    });

    const row = await visitRow(instanceId);
    expect(row?.validation_failures).toContain("total_missing");
    expect(row?.validation_failures).toContain("date_order");
  });

  it("a re-visit produces its own row, so a correction does not erase the original verdict", async () => {
    // Why this lives on the visit rather than the invoice: validation
    // describes a moment, not a permanent property of a document.
    const instanceId = await setupWithRule(ALWAYS);
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1" });

    // Re-open the instance and visit again, this time with a total.
    await env.DB.prepare(
      "UPDATE process_instances SET status = 'in_progress', current_stage_id = 's-rec' WHERE id = ?"
    )
      .bind(instanceId)
      .run();
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1", "BT-112": 100 });

    const rows = await env.DB.prepare(
      "SELECT validation_passed FROM stage_visits WHERE process_instance_id = ? ORDER BY created_at, rowid"
    )
      .bind(instanceId)
      .all<{ validation_passed: number }>();
    expect(rows.results.map((r: { validation_passed: number }) => r.validation_passed)).toEqual([0, 1]);
  });

  it("an automatic stage claims no validation result at all", async () => {
    // It never consults validation, so recording a verdict there
    // would assert something that did not happen.
    await handleCreateProcess(env.DB, { id: "p-auto", name: "Auto" });
    await handleCreateStage(env.DB, "p-auto", { id: "s-auto", name: "Received", sequence: 1 });
    const created = await handleCreateProcessInstance(env.DB, "p-auto", {
      subjectType: "invoice",
      subjectId: "inv-auto",
    });
    const instanceId = (created.body as { id: string }).id;
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1" });

    const row = await visitRow(instanceId);
    expect(row?.validation_passed).toBeNull();
    expect(row?.validation_checked).toBeNull();
  });
});

describe("a conflict raises a task for a human (decision 0048)", () => {
  async function setupWithRule(compiled: Record<string, unknown>) {
    await handleCreateProcess(env.DB, { id: "p-conf", name: "Conflict" });
    await seedRuleSet("rs-conf", compiled);
    await handleCreateStage(env.DB, "p-conf", { id: "s-conf", name: "Validation", sequence: 1, ruleSetId: "rs-conf" });
    const created = await handleCreateProcessInstance(env.DB, "p-conf", {
      subjectType: "invoice",
      subjectId: "inv-conf",
    });
    return (created.body as { id: string }).id;
  }

  it("fires when any field's pages disagreed", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "extraction.conflicts", operator: "is_not", value: "" }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, {
      "BT-112": 2272.47,
      "extraction.conflicts": "BT-112",
    });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("matched");
  });

  it("does not fire when the pages agreed", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "extraction.conflicts", operator: "is_not", value: "" }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, {
      "BT-112": 3137.47,
      "extraction.conflicts": "",
    });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("no_match");
  });

  it("can target a SPECIFIC disagreeing field, using the existing contains operator", async () => {
    // A disagreement about the total warrants different handling from
    // one about a reference code.
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "extraction.conflicts", operator: "contains", value: "BT-112" }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, {
      "extraction.conflicts": "BT-106,BT-112",
    });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("matched");
  });

  it("fires on a failed page, which is often why a total does not match", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "extraction.pagesFailed", operator: "greater_than", value: 0 }] },
      actions: [{ type: "flag", params: {} }],
    });
    const result = await visitCurrentStage(env.DB, instanceId, { "extraction.pagesFailed": 1 });
    expect((result.body as { visits: { outcome: string }[] }).visits[0].outcome).toBe("matched");
  });
});

describe("set_field is recorded, not silent (decision 0049)", () => {
  async function setupWithRule(compiled: Record<string, unknown>) {
    await handleCreateProcess(env.DB, { id: "p-set", name: "Set" });
    await seedRuleSet("rs-set", compiled);
    await handleCreateStage(env.DB, "p-set", { id: "s-set", name: "Validation", sequence: 1, ruleSetId: "rs-set" });
    const created = await handleCreateProcessInstance(env.DB, "p-set", {
      subjectType: "invoice",
      subjectId: "inv-set",
    });
    return (created.body as { id: string }).id;
  }

  it("records an overwrite with the value it replaced", async () => {
    // The Morrison case: page 1 fabricated 2272.47, and a rule
    // resolves it to the printed total.
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "extraction.conflicts", operator: "contains", value: "BT-112" }] },
      actions: [{ type: "set_field", params: { field: "BT-112", value: 3137.47 } }],
    });
    await visitCurrentStage(env.DB, instanceId, {
      "BT-112": 2272.47,
      "extraction.conflicts": "BT-112",
    });

    const row = await env.DB.prepare(
      `SELECT fo.field, fo.previous_value, fo.new_value
       FROM field_overrides fo
       JOIN stage_visits sv ON sv.id = fo.stage_visit_id
       WHERE sv.process_instance_id = ?`
    )
      .bind(instanceId)
      .first<{ field: string; previous_value: string; new_value: string }>();
    expect(row?.field).toBe("BT-112");
    expect(JSON.parse(row!.previous_value)).toBe(2272.47);
    expect(JSON.parse(row!.new_value)).toBe(3137.47);
  });

  it("attributes the change to the rule that made it", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "BT-1", operator: "is_present" }] },
      actions: [{ type: "set_field", params: { field: "BT-133", value: "CC-100" } }],
    });
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1" });

    const row = await env.DB.prepare(
      `SELECT fo.rule_id FROM field_overrides fo
       JOIN stage_visits sv ON sv.id = fo.stage_visit_id
       WHERE sv.process_instance_id = ?`
    )
      .bind(instanceId)
      .first<{ rule_id: string }>();
    // An unattributable change to financial data is what the record
    // exists to prevent.
    expect(row?.rule_id).toBeTruthy();
    expect(row?.rule_id).not.toBe("unknown");
  });

  it("records nothing when no rule matched", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "BT-1", operator: "is", value: "SOMETHING-ELSE" }] },
      actions: [{ type: "set_field", params: { field: "BT-133", value: "CC-100" } }],
    });
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1" });

    const count = await env.DB.prepare("SELECT count(*) AS n FROM field_overrides").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("copies one field to another, recorded the same way", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "BT-1", operator: "is_present" }] },
      actions: [{ type: "set_field", params: { field: "BT-112", fromField: "BT-106" } }],
    });
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1", "BT-106": 3137.47 });

    const row = await env.DB.prepare(
      `SELECT fo.field, fo.new_value FROM field_overrides fo
       JOIN stage_visits sv ON sv.id = fo.stage_visit_id
       WHERE sv.process_instance_id = ?`
    )
      .bind(instanceId)
      .first<{ field: string; new_value: string }>();
    expect(row?.field).toBe("BT-112");
    expect(JSON.parse(row!.new_value)).toBe(3137.47);
  });

  it("records a set with no previous value as genuinely null, not as an empty string", async () => {
    const instanceId = await setupWithRule({
      id: "r1",
      conditions: { all: [{ field: "BT-1", operator: "is_present" }] },
      actions: [{ type: "set_field", params: { field: "BT-133", value: "CC-100" } }],
    });
    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1" });

    const row = await env.DB.prepare(
      `SELECT fo.previous_value FROM field_overrides fo
       JOIN stage_visits sv ON sv.id = fo.stage_visit_id
       WHERE sv.process_instance_id = ?`
    )
      .bind(instanceId)
      .first<{ previous_value: string | null }>();
    // A rule SETTING a field differs from one OVERWRITING it.
    expect(row?.previous_value).toBeNull();
  });
});

describe("a rule resolves a conflict to the other page's value (0050)", () => {
  it("copies the alternative over the merged value, and records it", async () => {
    // The whole arc, end to end: page 1 fabricates a total, page 2
    // reads the printed one, the merge keeps the first and reports
    // the disagreement, and a rule the customer wrote resolves it.
    await handleCreateProcess(env.DB, { id: "p-res", name: "Resolve" });
    await seedRuleSet("rs-res", {
      id: "r1",
      conditions: { all: [{ field: "extraction.conflicts", operator: "contains", value: "BT-112" }] },
      actions: [
        { type: "set_field", params: { field: "BT-112", fromField: "extraction.alternative(BT-112)" } },
      ],
    });
    await handleCreateStage(env.DB, "p-res", { id: "s-res", name: "Validation", sequence: 1, ruleSetId: "rs-res" });
    const created = await handleCreateProcessInstance(env.DB, "p-res", {
      subjectType: "invoice",
      subjectId: "inv-res",
    });
    const instanceId = (created.body as { id: string }).id;

    await visitCurrentStage(env.DB, instanceId, {
      "BT-112": 2272.47,
      "extraction.conflicts": "BT-112",
      "extraction.alternative(BT-112)": 3137.47,
    });

    const row = await env.DB.prepare(
      `SELECT fo.field, fo.previous_value, fo.new_value FROM field_overrides fo
       JOIN stage_visits sv ON sv.id = fo.stage_visit_id
       WHERE sv.process_instance_id = ?`
    )
      .bind(instanceId)
      .first<{ field: string; previous_value: string; new_value: string }>();
    expect(row?.field).toBe("BT-112");
    expect(JSON.parse(row!.previous_value)).toBe(2272.47);
    expect(JSON.parse(row!.new_value)).toBe(3137.47);
  });

  it("changes nothing when the pages agreed, so the rule is safe to leave active", async () => {
    // The alternative fact is absent when there was no conflict, so
    // the copy is a no-op rather than clearing a good value.
    await handleCreateProcess(env.DB, { id: "p-res2", name: "Resolve" });
    await seedRuleSet("rs-res2", {
      id: "r1",
      conditions: { all: [{ field: "BT-1", operator: "is_present" }] },
      actions: [
        { type: "set_field", params: { field: "BT-112", fromField: "extraction.alternative(BT-112)" } },
      ],
    });
    await handleCreateStage(env.DB, "p-res2", { id: "s-res2", name: "Validation", sequence: 1, ruleSetId: "rs-res2" });
    const created = await handleCreateProcessInstance(env.DB, "p-res2", {
      subjectType: "invoice",
      subjectId: "inv-res2",
    });
    const instanceId = (created.body as { id: string }).id;

    await visitCurrentStage(env.DB, instanceId, { "BT-1": "INV-1", "BT-112": 3137.47 });

    const count = await env.DB.prepare("SELECT count(*) AS n FROM field_overrides").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

describe("validation before and after rules (decision 0051)", () => {
  async function setupWithRule(compiled: Record<string, unknown>) {
    await handleCreateProcess(env.DB, { id: "p-rev", name: "Revalidate" });
    await seedRuleSet("rs-rev", compiled);
    await handleCreateStage(env.DB, "p-rev", { id: "s-rev", name: "Validation", sequence: 1, ruleSetId: "rs-rev" });
    const created = await handleCreateProcessInstance(env.DB, "p-rev", {
      subjectType: "invoice",
      subjectId: "inv-rev",
    });
    return (created.body as { id: string }).id;
  }

  const CORRECT_TOTAL = {
    id: "r1",
    conditions: { all: [{ field: "extraction.conflicts", operator: "contains", value: "BT-112" }] },
    actions: [{ type: "set_field", params: { field: "BT-112", value: 3137.47 } }],
  };

  it("keeps the arrival verdict unchanged, and records a second one", async () => {
    // Both questions matter and they are different: an auditor asks
    // whether the document arrived sound; the finance team acts on
    // whether what was stored is sound.
    const instanceId = await setupWithRule(CORRECT_TOTAL);
    await visitCurrentStage(env.DB, instanceId, {
      "extraction.conflicts": "BT-112",
      "BT-106": 3137.47,
      "BT-110": 0,
      "BT-112": 2272.47,
    });

    const row = await env.DB.prepare(
      `SELECT validation_passed, validation_failures, validation_passed_after, validation_failures_after
       FROM stage_visits WHERE process_instance_id = ? AND validation_checked IS NOT NULL`
    )
      .bind(instanceId)
      .first<{
        validation_passed: number;
        validation_failures: string;
        validation_passed_after: number;
        validation_failures_after: string;
      }>();

    // Arrived failing: 3137.47 + 0 does not equal 2272.47.
    expect(row?.validation_passed).toBe(0);
    expect(row?.validation_failures).toContain("vat_arithmetic");
    // Left passing, once the rule corrected the total.
    expect(row?.validation_passed_after).toBe(1);
    expect(row?.validation_failures_after).toBe("");
  });

  it("records nothing after when no rule changed anything", async () => {
    // An invoice nothing touched has one validation state, not two
    // saying the same thing.
    const instanceId = await setupWithRule(CORRECT_TOTAL);
    await visitCurrentStage(env.DB, instanceId, {
      "extraction.conflicts": "",
      "BT-112": 3137.47,
    });

    const row = await env.DB.prepare(
      `SELECT validation_passed, validation_passed_after FROM stage_visits
       WHERE process_instance_id = ? AND validation_checked IS NOT NULL`
    )
      .bind(instanceId)
      .first<{ validation_passed: number; validation_passed_after: number | null }>();
    expect(row?.validation_passed).toBe(1);
    expect(row?.validation_passed_after).toBeNull();
  });

  it("reports a correction that did NOT fix everything", async () => {
    // The real Morrison case: correcting the total left the net and
    // the lines still inconsistent.
    const instanceId = await setupWithRule(CORRECT_TOTAL);
    await visitCurrentStage(env.DB, instanceId, {
      "extraction.conflicts": "BT-112",
      "BT-106": 2272.47,
      "BT-110": 0,
      "BT-112": 2272.47,
    });

    const row = await env.DB.prepare(
      `SELECT validation_passed_after, validation_failures_after FROM stage_visits
       WHERE process_instance_id = ? AND validation_checked IS NOT NULL`
    )
      .bind(instanceId)
      .first<{ validation_passed_after: number; validation_failures_after: string }>();
    // Still failing: the net was never corrected.
    expect(row?.validation_passed_after).toBe(0);
    expect(row?.validation_failures_after).toContain("vat_arithmetic");
  });

  it("exposes both states as facts a rule could test", async () => {
    const instanceId = await setupWithRule(CORRECT_TOTAL);
    const result = await visitCurrentStage(env.DB, instanceId, {
      "extraction.conflicts": "BT-112",
      "BT-106": 3137.47,
      "BT-110": 0,
      "BT-112": 2272.47,
    });
    const corrected = (result.body as { correctedFacts?: Record<string, unknown> }).correctedFacts;
    expect(corrected?.["validation.passed"]).toBe(false);
    expect(corrected?.["validation.passedAfterRules"]).toBe(true);
  });
});

describe("visitCurrentStage refuses to re-visit a stage waiting on people (decision 0072)", () => {
  async function blockedInstance(): Promise<string> {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await seedRuleSet("rs1", {
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "assign_task", params: { team: "team1", permission: "AP.Approve" } }],
    });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1, ruleSetId: "rs1" });
    await handleCreateStage(env.DB, "p1", { id: "s2", name: "Paid", sequence: 2 });
    const created = await handleCreateProcessInstance(env.DB, "p1", { subjectType: "invoice", subjectId: "inv-1" });
    const instanceId = (created.body as { id: string }).id;
    await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });
    return instanceId;
  }

  it("409s rather than raising the same task a second time", async () => {
    // Blocking on tasks is the engine's own stated intent. The only
    // guard was on instance STATUS, and a blocked instance is still
    // in_progress — so a second visit re-evaluated the same rules
    // against the same stage.
    const instanceId = await blockedInstance();
    const again = await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });

    expect(again.status).toBe(409);
    expect(String((again.body as { error: string }).error)).toContain("waiting on 1 open task");
  });

  it("leaves exactly one task, not two", async () => {
    // The consequence the guard exists to prevent, asserted directly.
    const instanceId = await blockedInstance();
    await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });

    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id WHERE v.process_instance_id = ?"
    )
      .bind(instanceId)
      .first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("allows a visit again once the task is completed", async () => {
    // The guard must not strand an instance — completing the task is
    // what releases it, exactly as before.
    const instanceId = await blockedInstance();
    const task = await env.DB.prepare("SELECT id FROM tasks WHERE stage_id = 's1'").first<{ id: string }>();
    await env.DB.prepare("UPDATE tasks SET completed_by = 'usr1' WHERE id = ?").bind(task!.id).run();

    const after = await visitCurrentStage(env.DB, instanceId, { "BT-112": 3000 });
    expect(after.status).not.toBe(409);
  });
});
