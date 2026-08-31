import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleClaimTask, handleCompleteTask, handleCreateTask } from "../src/task-route.js";
import { handleCreateUser } from "../src/org-route.js";
import { handleAddTeamMember, handleCreateTeam } from "../src/team-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";

async function seedStage(): Promise<string> {
  await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
  await handleCreateStage(env.DB, "p1", { id: "s1", name: "Approval", sequence: 1 });
  return "s1";
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateTask", () => {
  it("400s when neither teamId nor userId is provided", async () => {
    const stageId = await seedStage();
    const result = await handleCreateTask(env.DB, { id: "t1", stageId, requiredPermission: "AP.Approve" });
    expect(result.status).toBe(400);
  });

  it("400s when BOTH teamId and userId are provided", async () => {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleCreateTask(env.DB, {
      id: "t1",
      stageId,
      teamId: "team1",
      userId: "usr1",
      requiredPermission: "AP.Approve",
    });
    expect(result.status).toBe(400);
  });

  it("422s an unknown permission — not in the closed vocabulary", async () => {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    const result = await handleCreateTask(env.DB, {
      id: "t1",
      stageId,
      teamId: "team1",
      requiredPermission: "Not.A.Real.Permission",
    });
    expect(result.status).toBe(422);
  });

  it("404s when the stage does not exist", async () => {
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    const result = await handleCreateTask(env.DB, {
      id: "t1",
      stageId: "does-not-exist",
      teamId: "team1",
      requiredPermission: "AP.Approve",
    });
    expect(result.status).toBe(404);
  });

  it("creates a team-owned task", async () => {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    const result = await handleCreateTask(env.DB, {
      id: "t1",
      stageId,
      teamId: "team1",
      requiredPermission: "AP.Approve",
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT owner_team_id, owner_user_id, required_permission FROM tasks WHERE id = ?")
      .bind("t1")
      .first();
    expect(row).toEqual({ owner_team_id: "team1", owner_user_id: null, required_permission: "AP.Approve" });
  });

  it("creates a named-user-owned task", async () => {
    const stageId = await seedStage();
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleCreateTask(env.DB, {
      id: "t1",
      stageId,
      userId: "usr1",
      requiredPermission: "AP.Approve",
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT owner_team_id, owner_user_id FROM tasks WHERE id = ?").bind("t1").first();
    expect(row).toEqual({ owner_team_id: null, owner_user_id: "usr1" });
  });
});

describe("handleClaimTask", () => {
  async function seedTeamTask(): Promise<{ stageId: string; taskId: string }> {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await handleCreateTask(env.DB, { id: "t1", stageId, teamId: "team1", requiredPermission: "AP.Approve" });
    return { stageId, taskId: "t1" };
  }

  it("404s when the task does not exist", async () => {
    const result = await handleClaimTask(env.DB, "does-not-exist", "usr1");
    expect(result.status).toBe(404);
  });

  it("400s claiming a named-user task — nothing to claim", async () => {
    const stageId = await seedStage();
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateTask(env.DB, { id: "t1", stageId, userId: "usr1", requiredPermission: "AP.Approve" });
    const result = await handleClaimTask(env.DB, "t1", "usr1");
    expect(result.status).toBe(400);
  });

  it("403s when the claiming user is not a member of the owning team", async () => {
    const { taskId } = await seedTeamTask();
    await handleCreateUser(env.DB, { id: "outsider", email: "o@b.com", name: "Outsider" });
    const result = await handleClaimTask(env.DB, taskId, "outsider");
    expect(result.status).toBe(403);
  });

  it("a team member successfully claims the task, recording the real identity", async () => {
    const { taskId } = await seedTeamTask();
    const result = await handleClaimTask(env.DB, taskId, "usr1");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT claimed_by FROM tasks WHERE id = ?").bind(taskId).first();
    expect(row).toEqual({ claimed_by: "usr1" });
  });

  it("the critical property: a second claim attempt is refused, even by another eligible team member", async () => {
    const { taskId } = await seedTeamTask();
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob" });
    await handleAddTeamMember(env.DB, "team1", "usr2");

    const first = await handleClaimTask(env.DB, taskId, "usr1");
    expect(first.status).toBe(200);
    const second = await handleClaimTask(env.DB, taskId, "usr2");
    expect(second.status).toBe(409);

    // Confirms usr1, the actual winner, is still the one recorded —
    // the second (refused) attempt must never have overwritten it.
    const row = await env.DB.prepare("SELECT claimed_by FROM tasks WHERE id = ?").bind(taskId).first();
    expect(row).toEqual({ claimed_by: "usr1" });
  });

  it("409s claiming an already-completed task", async () => {
    const { taskId } = await seedTeamTask();
    await handleClaimTask(env.DB, taskId, "usr1");
    await handleCompleteTask(env.DB, taskId, "usr1");
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob" });
    await handleAddTeamMember(env.DB, "team1", "usr2");
    const result = await handleClaimTask(env.DB, taskId, "usr2");
    expect(result.status).toBe(409);
  });
});

describe("handleCompleteTask", () => {
  it("404s when the task does not exist", async () => {
    const result = await handleCompleteTask(env.DB, "does-not-exist", "usr1");
    expect(result.status).toBe(404);
  });

  it("a named-user task: the assigned user can complete it directly, with no claim step", async () => {
    const stageId = await seedStage();
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateTask(env.DB, { id: "t1", stageId, userId: "usr1", requiredPermission: "AP.Approve" });
    const result = await handleCompleteTask(env.DB, "t1", "usr1");
    expect(result.status).toBe(200);
  });

  it("403s a named-user task completed by someone other than the assigned user", async () => {
    const stageId = await seedStage();
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob" });
    await handleCreateTask(env.DB, { id: "t1", stageId, userId: "usr1", requiredPermission: "AP.Approve" });
    const result = await handleCompleteTask(env.DB, "t1", "usr2");
    expect(result.status).toBe(403);
  });

  it("409s completing a team task that was never claimed", async () => {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await handleCreateTask(env.DB, { id: "t1", stageId, teamId: "team1", requiredPermission: "AP.Approve" });
    const result = await handleCompleteTask(env.DB, "t1", "usr1");
    expect(result.status).toBe(409);
  });

  it("403s a team task completed by someone other than the actual claimer", async () => {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await handleAddTeamMember(env.DB, "team1", "usr2");
    await handleCreateTask(env.DB, { id: "t1", stageId, teamId: "team1", requiredPermission: "AP.Approve" });
    await handleClaimTask(env.DB, "t1", "usr1");
    const result = await handleCompleteTask(env.DB, "t1", "usr2");
    expect(result.status).toBe(403);
  });

  it("the actual claimer completes a team task successfully", async () => {
    const stageId = await seedStage();
    await handleCreateTeam(env.DB, { id: "team1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "team1", "usr1");
    await handleCreateTask(env.DB, { id: "t1", stageId, teamId: "team1", requiredPermission: "AP.Approve" });
    await handleClaimTask(env.DB, "t1", "usr1");
    const result = await handleCompleteTask(env.DB, "t1", "usr1");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT completed_by FROM tasks WHERE id = ?").bind("t1").first();
    expect(row).toEqual({ completed_by: "usr1" });
  });

  it("409s a second completion attempt", async () => {
    const stageId = await seedStage();
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateTask(env.DB, { id: "t1", stageId, userId: "usr1", requiredPermission: "AP.Approve" });
    await handleCompleteTask(env.DB, "t1", "usr1");
    const result = await handleCompleteTask(env.DB, "t1", "usr1");
    expect(result.status).toBe(409);
  });
});
