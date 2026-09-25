import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleAddStageReturnTarget, handleRemoveStageReturnTarget } from "../src/stage-return-targets-route.js";

async function seedTwoStages(processId = "p1"): Promise<{ sourceId: string; targetId: string }> {
  await handleCreateProcess(env.DB, { id: processId, name: "AP" });
  await handleCreateStage(env.DB, processId, { id: `${processId}-s1`, name: "Approval", sequence: 1 });
  await handleCreateStage(env.DB, processId, { id: `${processId}-s2`, name: "Coding", sequence: 2 });
  return { sourceId: `${processId}-s1`, targetId: `${processId}-s2` };
}

async function seedTeam(id = "team-coding"): Promise<string> {
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme France')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, 'Coding', 'u1')").bind(id).run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleAddStageReturnTarget — decision 0490", () => {
  it("adds a configured target, returning its resolved names", async () => {
    const { sourceId, targetId } = await seedTwoStages();
    const teamId = await seedTeam();

    const result = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId, teamId });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      sourceStageId: sourceId,
      targetStageId: targetId,
      targetStageName: "Coding",
      teamId,
      teamName: "Coding",
    });
  });

  it("400s when targetStageId or teamId is missing", async () => {
    const { sourceId, targetId } = await seedTwoStages();
    const teamId = await seedTeam();
    expect((await handleAddStageReturnTarget(env.DB, sourceId, { teamId })).status).toBe(400);
    expect((await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId })).status).toBe(400);
  });

  it("422s a stage naming itself as its own return target", async () => {
    const { sourceId } = await seedTwoStages();
    const teamId = await seedTeam();
    const result = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: sourceId, teamId });
    expect(result.status).toBe(422);
  });

  it("404s a source stage that does not exist", async () => {
    const teamId = await seedTeam();
    const { targetId } = await seedTwoStages();
    const result = await handleAddStageReturnTarget(env.DB, "no-such-stage", { targetStageId: targetId, teamId });
    expect(result.status).toBe(404);
  });

  it("404s a target stage that does not exist", async () => {
    const { sourceId } = await seedTwoStages();
    const teamId = await seedTeam();
    const result = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: "no-such-stage", teamId });
    expect(result.status).toBe(404);
  });

  it("404s a team that does not exist", async () => {
    const { sourceId, targetId } = await seedTwoStages();
    const result = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId, teamId: "no-such-team" });
    expect(result.status).toBe(404);
  });

  it("422s a target stage that belongs to a different process", async () => {
    const { sourceId } = await seedTwoStages("p1");
    const other = await seedTwoStages("p2");
    const teamId = await seedTeam();
    const result = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: other.sourceId, teamId });
    expect(result.status).toBe(422);
  });

  it("409s the same (source, target) pair configured twice", async () => {
    const { sourceId, targetId } = await seedTwoStages();
    const teamId = await seedTeam();
    await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId, teamId });
    const second = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId, teamId });
    expect(second.status).toBe(409);
  });

  it("allows the same target stage from two different sources — a per-pair uniqueness, not per-target", async () => {
    const { sourceId, targetId } = await seedTwoStages();
    await handleCreateStage(env.DB, "p1", { id: "p1-s3", name: "Review", sequence: 3 });
    const teamId = await seedTeam();

    await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId, teamId });
    const second = await handleAddStageReturnTarget(env.DB, "p1-s3", { targetStageId: targetId, teamId });
    expect(second.status).toBe(201);
  });
});

describe("handleRemoveStageReturnTarget — decision 0490", () => {
  it("removes a configured target", async () => {
    const { sourceId, targetId } = await seedTwoStages();
    const teamId = await seedTeam();
    const added = await handleAddStageReturnTarget(env.DB, sourceId, { targetStageId: targetId, teamId });
    const id = (added.body as { id: string }).id;

    const removed = await handleRemoveStageReturnTarget(env.DB, id);
    expect(removed.status).toBe(200);

    const row = await env.DB.prepare("SELECT 1 FROM stage_return_targets WHERE id = ?").bind(id).first();
    expect(row).toBeNull();
  });

  it("404s an id that does not exist", async () => {
    const result = await handleRemoveStageReturnTarget(env.DB, "no-such-row");
    expect(result.status).toBe(404);
  });
});
