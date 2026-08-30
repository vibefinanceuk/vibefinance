import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleAssignRole,
  handleCreateRole,
  handleCreateUnit,
  handleCreateUser,
  handleSetAuthorityLimit,
  handleSetProfile,
} from "../src/org-route.js";
import { authenticateUser } from "../src/user-auth.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateUnit", () => {
  it("400s when id or name is missing", async () => {
    const result = await handleCreateUnit(env.DB, { id: "u1" });
    expect(result.status).toBe(400);
  });

  it("creates a top-level unit", async () => {
    const result = await handleCreateUnit(env.DB, { id: "u1", name: "Finance" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT id, name, parent_unit_id FROM org_units WHERE id = ?")
      .bind("u1")
      .first();
    expect(row).toEqual({ id: "u1", name: "Finance", parent_unit_id: null });
  });

  it("creates a child unit under a real parent", async () => {
    await handleCreateUnit(env.DB, { id: "u1", name: "EU Division" });
    const result = await handleCreateUnit(env.DB, { id: "u2", name: "Germany", parentUnitId: "u1" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT parent_unit_id FROM org_units WHERE id = ?").bind("u2").first();
    expect(row).toEqual({ parent_unit_id: "u1" });
  });

  it("404s when parentUnitId does not exist", async () => {
    const result = await handleCreateUnit(env.DB, { id: "u1", name: "X", parentUnitId: "does-not-exist" });
    expect(result.status).toBe(404);
  });

  it("409s on a duplicate id rather than silently overwriting", async () => {
    await handleCreateUnit(env.DB, { id: "u1", name: "Finance" });
    const result = await handleCreateUnit(env.DB, { id: "u1", name: "A different name" });
    expect(result.status).toBe(409);
    const row = await env.DB.prepare("SELECT name FROM org_units WHERE id = ?").bind("u1").first();
    expect(row).toEqual({ name: "Finance" });
  });
});

describe("handleCreateUser", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com" });
    expect(result.status).toBe(400);
  });

  it("creates a user with no unit", async () => {
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT unit_id, status FROM org_users WHERE id = ?").bind("usr1").first();
    expect(row).toEqual({ unit_id: null, status: "active" });
  });

  it("404s when unitId does not exist", async () => {
    const result = await handleCreateUser(env.DB, {
      id: "usr1",
      email: "a@b.com",
      name: "Alice",
      unitId: "does-not-exist",
    });
    expect(result.status).toBe(404);
  });

  it("409s on a duplicate id", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "different@b.com", name: "Someone else" });
    expect(result.status).toBe(409);
  });

  it("409s on a duplicate email even with a different id", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleCreateUser(env.DB, { id: "usr2", email: "a@b.com", name: "Someone else" });
    expect(result.status).toBe(409);
  });

  it("stores a provided locale, ready for a future per-session use", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice", locale: "de" });
    const row = await env.DB.prepare("SELECT locale FROM org_users WHERE id = ?").bind("usr1").first();
    expect(row).toEqual({ locale: "de" });
  });

  it("returns a real API key in the response, and stores only its hash — never the plaintext", async () => {
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const { apiKey } = result.body as { apiKey: string };
    expect(apiKey).toBeTruthy();

    const row = await env.DB.prepare("SELECT api_key_hash FROM org_users WHERE id = ?")
      .bind("usr1")
      .first<{ api_key_hash: string }>();
    expect(row?.api_key_hash).toBeTruthy();
    expect(row?.api_key_hash).not.toBe(apiKey);
    expect(row?.api_key_hash).not.toContain(apiKey);
  });

  it("the returned key actually authenticates this user", async () => {
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const { apiKey } = result.body as { apiKey: string };
    const request = new Request("https://x", { headers: { Authorization: `Bearer ${apiKey}` } });
    const authenticated = await authenticateUser(env.DB, request);
    expect(authenticated?.id).toBe("usr1");
  });
});

describe("handleCreateRole — the closed permission vocabulary", () => {
  it("creates a role with valid permissions", async () => {
    const result = await handleCreateRole(env.DB, {
      id: "r1",
      name: "AP Manager",
      permissions: ["AP.Approve", "Admin.UserManagement"],
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT permissions_json FROM org_roles WHERE id = ?").bind("r1").first();
    expect(row).toEqual({ permissions_json: '["AP.Approve","Admin.UserManagement"]' });
  });

  it("creates a role with no permissions at all — a legitimate empty container", async () => {
    const result = await handleCreateRole(env.DB, { id: "r1", name: "Viewer" });
    expect(result.status).toBe(201);
  });

  it("422s when a permission is not in the closed vocabulary — refused, not silently stored", async () => {
    const result = await handleCreateRole(env.DB, {
      id: "r1",
      name: "Sketchy Role",
      permissions: ["AP.Approve", "delete_everything"],
    });
    expect(result.status).toBe(422);
    const row = await env.DB.prepare("SELECT id FROM org_roles WHERE id = ?").bind("r1").first();
    expect(row).toBeNull();
  });

  it("409s on a duplicate role id", async () => {
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    const result = await handleCreateRole(env.DB, { id: "r1", name: "Admin again" });
    expect(result.status).toBe(409);
  });
});

describe("handleAssignRole", () => {
  it("assigns a role to a real user", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    const result = await handleAssignRole(env.DB, "usr1", "r1");
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT * FROM org_user_roles WHERE user_id = ? AND role_id = ?")
      .bind("usr1", "r1")
      .first();
    expect(row).toEqual({ user_id: "usr1", role_id: "r1" });
  });

  it("404s when the user does not exist", async () => {
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    const result = await handleAssignRole(env.DB, "does-not-exist", "r1");
    expect(result.status).toBe(404);
  });

  it("404s when the role does not exist", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleAssignRole(env.DB, "usr1", "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("409s when the user already has that role, without duplicating the row", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    await handleAssignRole(env.DB, "usr1", "r1");
    const result = await handleAssignRole(env.DB, "usr1", "r1");
    expect(result.status).toBe(409);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_user_roles").first();
    expect(count).toEqual({ n: 1 });
  });

  it("a user can hold more than one role", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    await handleCreateRole(env.DB, { id: "r2", name: "Viewer" });
    await handleAssignRole(env.DB, "usr1", "r1");
    const result = await handleAssignRole(env.DB, "usr1", "r2");
    expect(result.status).toBe(201);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_user_roles WHERE user_id = ?")
      .bind("usr1")
      .first();
    expect(count).toEqual({ n: 2 });
  });
});

describe("handleSetAuthorityLimit", () => {
  it("400s when currency or maxAmount is missing", async () => {
    const result = await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR" });
    expect(result.status).toBe(400);
  });

  it("400s on a negative maxAmount", async () => {
    const result = await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: -100 });
    expect(result.status).toBe(400);
  });

  it("404s when the user does not exist", async () => {
    const result = await handleSetAuthorityLimit(env.DB, "does-not-exist", { currency: "EUR", maxAmount: 5000 });
    expect(result.status).toBe(404);
  });

  it("sets a real limit", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    const result = await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: 5000 });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT max_amount FROM org_authority_limits WHERE user_id = ? AND currency = ?")
      .bind("usr1", "EUR")
      .first();
    expect(row).toEqual({ max_amount: 5000 });
  });

  it("upserts — setting the same user/currency again replaces the value, not a duplicate row", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: 5000 });
    await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: 10000 });

    const count = await env.DB.prepare(
      "SELECT count(*) AS n FROM org_authority_limits WHERE user_id = ? AND currency = ?"
    )
      .bind("usr1", "EUR")
      .first();
    expect(count).toEqual({ n: 1 });
    const row = await env.DB.prepare("SELECT max_amount FROM org_authority_limits WHERE user_id = ? AND currency = ?")
      .bind("usr1", "EUR")
      .first();
    expect(row).toEqual({ max_amount: 10000 });
  });

  it("a user can hold different limits in different currencies", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: 5000 });
    await handleSetAuthorityLimit(env.DB, "usr1", { currency: "USD", maxAmount: 6000 });
    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_authority_limits WHERE user_id = ?")
      .bind("usr1")
      .first();
    expect(count).toEqual({ n: 2 });
  });
});

describe("handleSetProfile — the closed CIUS profile vocabulary", () => {
  it("sets a real, known profile", async () => {
    const result = await handleSetProfile(env.DB, { id: "p1", ciusProfile: "xrechnung" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT cius_profile FROM org_profiles WHERE id = ?").bind("p1").first();
    expect(row).toEqual({ cius_profile: "xrechnung" });
  });

  it("422s an unknown profile — refused, not silently stored", async () => {
    const result = await handleSetProfile(env.DB, { id: "p1", ciusProfile: "made_up_profile" });
    expect(result.status).toBe(422);
    const row = await env.DB.prepare("SELECT id FROM org_profiles WHERE id = ?").bind("p1").first();
    expect(row).toBeNull();
  });

  it("scopes a profile to a real unit", async () => {
    await handleCreateUnit(env.DB, { id: "u1", name: "Germany" });
    const result = await handleSetProfile(env.DB, { id: "p1", ciusProfile: "xrechnung", unitId: "u1" });
    expect(result.status).toBe(201);
  });

  it("404s when unitId does not exist", async () => {
    const result = await handleSetProfile(env.DB, { id: "p1", ciusProfile: "xrechnung", unitId: "does-not-exist" });
    expect(result.status).toBe(404);
  });

  it("409s on a duplicate profile id", async () => {
    await handleSetProfile(env.DB, { id: "p1", ciusProfile: "xrechnung" });
    const result = await handleSetProfile(env.DB, { id: "p1", ciusProfile: "factur_x" });
    expect(result.status).toBe(409);
  });
});
