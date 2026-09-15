import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleAddTeamMember, handleCreateTeam, handleListTeams, handleRemoveTeamMember, handleUpdateTeam } from "../src/team-route.js";
import { handleCreateUser } from "../src/org-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

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

describe("handleUpdateTeam — decision 0332", () => {
  it("400s with no name given at all", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    const result = await handleUpdateTeam(env.DB, "t1", {});
    expect(result.status).toBe(400);
  });

  it("404s a team that does not exist", async () => {
    const result = await handleUpdateTeam(env.DB, "does-not-exist", { name: "New Name" });
    expect(result.status).toBe(404);
  });

  it("renames a real team", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    const result = await handleUpdateTeam(env.DB, "t1", { name: "Accounts Payable Team" });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT name FROM org_teams WHERE id = ?").bind("t1").first();
    expect(row).toEqual({ name: "Accounts Payable Team" });
  });
});

describe("handleRemoveTeamMember — decision 0332", () => {
  it("removes a real membership", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "t1", "usr1");

    const result = await handleRemoveTeamMember(env.DB, "t1", "usr1");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT 1 FROM org_team_members WHERE team_id = ? AND user_id = ?")
      .bind("t1", "usr1")
      .first();
    expect(row).toBeNull();
  });

  it("404s a membership that never existed, rather than a silent no-op", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    const result = await handleRemoveTeamMember(env.DB, "t1", "usr1");
    expect(result.status).toBe(404);
  });

  it("leaves the other team's own membership of the same user untouched", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateTeam(env.DB, { id: "t2", name: "Expense Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "t1", "usr1");
    await handleAddTeamMember(env.DB, "t2", "usr1");

    const result = await handleRemoveTeamMember(env.DB, "t1", "usr1");
    expect(result.status).toBe(200);
    const remaining = await env.DB
      .prepare("SELECT team_id FROM org_team_members WHERE user_id = ?")
      .bind("usr1")
      .all<{ team_id: string }>();
    expect(remaining.results.map((r: { team_id: string }) => r.team_id)).toEqual(["t2"]);
  });
});

describe("handleListTeams — decision 0332", () => {
  it("returns an empty list for a customer with no teams yet", async () => {
    const result = await handleListTeams(env.DB);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ teams: [] });
  });

  it("returns every team with its own real members, and an empty one with none", async () => {
    await handleCreateTeam(env.DB, { id: "t1", name: "AP Team" });
    await handleCreateTeam(env.DB, { id: "t2", name: "Expense Team" });
    await handleCreateUser(env.DB, { id: "usr1", email: "alice@acme.com", name: "Alice" });
    await handleAddTeamMember(env.DB, "t1", "usr1");

    const result = await handleListTeams(env.DB);
    const body = result.body as { teams: { id: string; name: string; members: unknown[] }[] };
    const apTeam = body.teams.find((t) => t.id === "t1");
    const expenseTeam = body.teams.find((t) => t.id === "t2");

    expect(apTeam?.members).toEqual([{ userId: "usr1", userName: "Alice", userEmail: "alice@acme.com" }]);
    expect(expenseTeam?.members).toEqual([]);
  });
});

describe("team routes, gated for the first time — decision 0332", () => {
  async function keyForPermission(permission: string): Promise<string> {
    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
      .bind(id, `${id}@acme.com`, "Test", await hashApiKey(apiKey))
      .run();

    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(roleId, `Role granting ${permission}`, JSON.stringify([permission]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();

    return apiKey;
  }

  it("POST /org/teams succeeds for Admin.RoleManagement", async () => {
    const apiKey = await keyForPermission("Admin.RoleManagement");
    const res = await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "t1", name: "AP Team" }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /org/teams 403s a delegated Admin.UserManagement holder — deliberately not enough here", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    const res = await SELF.fetch("https://example.com/org/teams", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "t1", name: "AP Team" }),
    });
    expect(res.status).toBe(403);
  });

  it("PUT /org/teams/:id renames for Admin.RoleManagement, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.RoleManagement");
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('t1', 'AP Team')").run();

    const res = await SELF.fetch("https://example.com/org/teams/t1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Accounts Payable Team" }),
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT name FROM org_teams WHERE id = 't1'").first();
    expect(row).toEqual({ name: "Accounts Payable Team" });
  });

  it("PUT /org/teams/:id 403s Admin.UserManagement alone", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('t1', 'AP Team')").run();
    const res = await SELF.fetch("https://example.com/org/teams/t1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Renamed" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /org/teams/:id/members succeeds for Admin.UserManagement, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('t1', 'AP Team')").run();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();

    const res = await SELF.fetch("https://example.com/org/teams/t1/members", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "usr1" }),
    });
    expect(res.status).toBe(201);
  });

  it("POST /org/teams/:id/members 403s Admin.RoleManagement alone — deliberately not enough here", async () => {
    const apiKey = await keyForPermission("Admin.RoleManagement");
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('t1', 'AP Team')").run();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();

    const res = await SELF.fetch("https://example.com/org/teams/t1/members", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "usr1" }),
    });
    expect(res.status).toBe(403);
  });

  it("DELETE /org/teams/:id/members/:userId removes a real membership, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('t1', 'AP Team')").run();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();
    await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('t1', 'usr1')").run();

    const res = await SELF.fetch("https://example.com/org/teams/t1/members/usr1", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT 1 FROM org_team_members WHERE team_id = 't1' AND user_id = 'usr1'").first();
    expect(row).toBeNull();
  });

  it("DELETE /org/teams/:id/members/:userId 401s with no credential at all", async () => {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('someone-else', 'x@b.com', 'X')").run();
    const res = await SELF.fetch("https://example.com/org/teams/t1/members/usr1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("GET /org/teams succeeds holding either Admin.RoleManagement or Admin.UserManagement", async () => {
    const roleKey = await keyForPermission("Admin.RoleManagement");
    const userKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_teams (id, name) VALUES ('t1', 'AP Team')").run();

    const res1 = await SELF.fetch("https://example.com/org/teams", { headers: { Authorization: `Bearer ${roleKey}` } });
    expect(res1.status).toBe(200);
    const res2 = await SELF.fetch("https://example.com/org/teams", { headers: { Authorization: `Bearer ${userKey}` } });
    expect(res2.status).toBe(200);
    const body = (await res2.json()) as { teams: { id: string }[] };
    expect(body.teams.map((t) => t.id)).toContain("t1");
  });

  it("GET /org/teams 403s holding neither permission", async () => {
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/org/teams", { headers: { Authorization: `Bearer ${apiKey}` } });
    expect(res.status).toBe(403);
  });
});
