import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import {
  handleSetStageAction,
  stageReverifiesRuleOnComplete,
  ruleStillFiresForTask,
} from "../src/stage-actions-route.js";

async function seedStage(): Promise<string> {
  await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
  await handleCreateStage(env.DB, "p1", { id: "s1", name: "Coding", sequence: 1 });
  return "s1";
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleSetStageAction — decision 0487", () => {
  it("422s an action outside the closed TaskAction vocabulary", async () => {
    const stageId = await seedStage();
    const result = await handleSetStageAction(env.DB, stageId, "approve", { reverifyRuleOnComplete: true });
    expect(result.status).toBe(422);
  });

  it("404s a stage that does not exist", async () => {
    const result = await handleSetStageAction(env.DB, "no-such-stage", "complete", { reverifyRuleOnComplete: true });
    expect(result.status).toBe(404);
  });

  it("400s when reverifyRuleOnComplete is missing or not a boolean", async () => {
    const stageId = await seedStage();
    const missing = await handleSetStageAction(env.DB, stageId, "complete", {});
    expect(missing.status).toBe(400);
    const wrongType = await handleSetStageAction(env.DB, stageId, "complete", { reverifyRuleOnComplete: "yes" });
    expect(wrongType.status).toBe(400);
  });

  it("turns it on, then off again — an UPSERT, not an INSERT that fails the second time", async () => {
    const stageId = await seedStage();
    const on = await handleSetStageAction(env.DB, stageId, "complete", { reverifyRuleOnComplete: true });
    expect(on.status).toBe(200);
    expect(await stageReverifiesRuleOnComplete(env.DB, stageId)).toBe(true);

    const off = await handleSetStageAction(env.DB, stageId, "complete", { reverifyRuleOnComplete: false });
    expect(off.status).toBe(200);
    expect(await stageReverifiesRuleOnComplete(env.DB, stageId)).toBe(false);
  });

  it("accepts a value for an action nothing reads yet — storing it is harmless, only complete is wired up", async () => {
    const stageId = await seedStage();
    const result = await handleSetStageAction(env.DB, stageId, "return", { reverifyRuleOnComplete: true });
    expect(result.status).toBe(200);
  });
});

describe("stageReverifiesRuleOnComplete — decision 0487", () => {
  it("is false for a stage nobody has configured — the sparse table's own default", async () => {
    const stageId = await seedStage();
    expect(await stageReverifiesRuleOnComplete(env.DB, stageId)).toBe(false);
  });
});

describe("ruleStillFiresForTask fails open when the exact thing to re-check cannot be pinned down — decision 0487", () => {
  async function seedTeamTask(overrides: {
    ruleId?: string | null;
    stageVisitId?: string | null;
    lineNumber?: number | null;
  }): Promise<string> {
    const stageId = await seedStage();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme') ON CONFLICT(id) DO NOTHING").run();
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team1', 'AP Team', 'u1')").run();
    const taskId = "t1";
    await env.DB
      .prepare(
        `INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, rule_id, stage_visit_id, line_number)
         VALUES (?, ?, 'team1', 'AP.Code', ?, ?, ?)`
      )
      .bind(taskId, stageId, overrides.ruleId ?? null, overrides.stageVisitId ?? null, overrides.lineNumber ?? null)
      .run();
    return taskId;
  }

  it("a system_reason task (decision 0480) has no rule_id — nothing to re-check", async () => {
    const taskId = await seedTeamTask({ ruleId: null, stageVisitId: null });
    const result = await ruleStillFiresForTask(env.DB, taskId);
    expect(result).toEqual({ blocked: false, ruleName: null });
  });

  it("a task created directly via POST /tasks (decision 0018) has a rule_id but no stage_visit_id", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs1', 'test', 'first_match', 'active')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES ('r1', 'rs1', 0, 1)").run();
    const taskId = await seedTeamTask({ ruleId: "r1", stageVisitId: null });
    const result = await ruleStillFiresForTask(env.DB, taskId);
    expect(result).toEqual({ blocked: false, ruleName: null });
  });

  it("no matching stage_visit_steps row — should not happen per migration 0009, but does not become a permanent lock if it does", async () => {
    // The stage (and its process, 'p1'/'s1') has to exist before
    // process_instances/stage_visits can reference it — seedStage()
    // first, unlike the two tests above where seedTeamTask's own
    // internal call to it was enough.
    const stageId = await seedStage();
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs1', 'test', 'first_match', 'active')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES ('r1', 'rs1', 0, 1)").run();
    await env.DB
      .prepare(
        `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
         VALUES ('pi1', 'p1', 'invoice', 'inv1', ?, 'in_progress')`
      )
      .bind(stageId)
      .run();
    await env.DB
      .prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('sv1', 'pi1', ?, 'matched')")
      .bind(stageId)
      .run();
    // Deliberately no stage_visit_steps row for ('sv1', 'r1').
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme') ON CONFLICT(id) DO NOTHING").run();
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team1', 'AP Team', 'u1')").run();
    const taskId = "t1";
    await env.DB
      .prepare(
        `INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, rule_id, stage_visit_id)
         VALUES (?, ?, 'team1', 'AP.Code', 'r1', 'sv1')`
      )
      .bind(taskId, stageId)
      .run();

    const result = await ruleStillFiresForTask(env.DB, taskId);
    expect(result).toEqual({ blocked: false, ruleName: null });
  });
});
