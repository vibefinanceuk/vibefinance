import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleAddTeamMember, handleCreateTeam } from "../src/team-route.js";
import { handleCreateUser } from "../src/org-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateTeam", () => {
  it("400s when id or name is missing", async () => {
    const result = await handleCreateTeam(env.DB, { id: "t1" });
    expect(result.status).toBe(400);
  });

  it("creates a team", async () => {
    const result = await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT id, name FROM org_teams WHERE id = ?").bind("t1").first();
    expect(row).toEqual({ id: "t1", name: "AP Team" });
  });

  it("409s on a duplicate id rather than silently overwriting", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    const result = await handleCreateTeam(env.DB, { id: "t1", name: "A different name" });
    expect(result.status).toBe(409);
    const row = await env.DB.prepare("SELECT name FROM org_teams WHERE id = ?").bind("t1").first();
    expect(row).toEqual({ name: "AP Team" });
  });
});

describe("handleAddTeamMember", () => {
  it("400s when userId is missing", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    const result = await handleAddTeamMember(env.DB, "t1", undefined);
    expect(result.status).toBe(400);
  });

  it("404s when the team does not exist", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleAddTeamMember(env.DB, "does-not-exist", "usr1");
    expect(result.status).toBe(404);
  });

  it("404s when the user does not exist", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    const result = await handleAddTeamMember(env.DB, "t1", "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("adds a real member", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleAddTeamMember(env.DB, "t1", "usr1");
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT * FROM org_team_members WHERE team_id = ? AND user_id = ?")
      .bind("t1", "usr1")
      .first();
    expect(row).toEqual({ team_id: "t1", user_id: "usr1" });
  });

  it("409s when the user is already a member, without duplicating the row", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "t1", "usr1");
    const result = await handleAddTeamMember(env.DB, "t1", "usr1");
    expect(result.status).toBe(409);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_team_members").first();
    expect(count).toEqual({ n: 1 });
  });

  it("a user can belong to more than one team", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateTeam(env.DB, { id: "t2", name: "Expense Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "t1", "usr1");
    const result = await handleAddTeamMember(env.DB, "t2", "usr1");
    expect(result.status).toBe(201);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_team_members WHERE user_id = ?")
      .bind("usr1")
      .first();
    expect(count).toEqual({ n: 2 });
  });

  it("a team can hold more than one member", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob" });
    await handleAddTeamMember(env.DB, "t1", "usr1");
    const result = await handleAddTeamMember(env.DB, "t1", "usr2");
    expect(result.status).toBe(201);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_team_members WHERE team_id = ?")
      .bind("t1")
      .first();
    expect(count).toEqual({ n: 2 });
  });
});
