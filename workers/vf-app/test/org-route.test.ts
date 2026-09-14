import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleAssignRole,
  handleCreateRole,
  handleUpdateRole,
  handleRevokeRole,
  handleCreateUnit,
  handleCreateUser,
  handleGetOrgOverview,
  handleSetAuthorityLimit,
  handleSetProfile,
} from "../src/org-route.js";
import { authenticateUser, generateApiKey, hashApiKey } from "../src/user-auth.js";
import { PERMISSIONS, PERMISSION_DESCRIPTIONS } from "../src/permissions.js";

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

  it("creates an operating unit under a legal entity", async () => {
    // **Narrowed by decision 0111.** This test previously nested two
    // units of no particular kind. An operating unit now sits under a
    // legal entity: a legal entity is a tax and reporting boundary, an
    // operating unit is where payables happen, and a hierarchy that
    // nests arbitrarily is one nobody can reason about.
    await handleCreateUnit(env.DB, { id: "u1", name: "EU Division", kind: "legal_entity" });
    const result = await handleCreateUnit(env.DB, { id: "u2", name: "Germany", parentUnitId: "u1" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT parent_unit_id FROM org_units WHERE id = ?").bind("u2").first();
    expect(row).toEqual({ parent_unit_id: "u1" });
  });

  it("refuses an operating unit under another operating unit", async () => {
    await handleCreateUnit(env.DB, { id: "ou1", name: "Acme UK" });
    const result = await handleCreateUnit(env.DB, { id: "ou2", name: "Acme UK South", parentUnitId: "ou1" });
    expect(result.status).toBe(422);
    // The message a customer reads, not the enum spelling: "a
    // operating_unit" was a real response.
    expect(String((result.body as { error: string }).error)).toContain("is an operating unit");
  });

  it("records what a unit is, defaulting to an operating unit", async () => {
    // What every unit created before decision 0111 was implicitly
    // being used as.
    await handleCreateUnit(env.DB, { id: "ou3", name: "Acme FR" });
    const row = await env.DB.prepare("SELECT kind FROM org_units WHERE id = 'ou3'").first<{ kind: string }>();
    expect(row?.kind).toBe("operating_unit");
  });

  it("refuses a kind that is neither", async () => {
    const result = await handleCreateUnit(env.DB, { id: "ou4", name: "X", kind: "division" });
    expect(result.status).toBe(422);
  });

  it("stores what an arriving invoice can be matched against", async () => {
    // BT-49 is what Peppol itself routes on (decision 0112).
    await handleCreateUnit(env.DB, {
      id: "ou5",
      name: "Acme FR",
      buyerEndpoint: "111222333",
      vatId: "FR12345678901",
    });
    const row = await env.DB.prepare(
      "SELECT buyer_endpoint, vat_id FROM org_units WHERE id = 'ou5'"
    ).first<{ buyer_endpoint: string; vat_id: string }>();
    expect(row?.buyer_endpoint).toBe("111222333");
    expect(row?.vat_id).toBe("FR12345678901");
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

  /**
   * **The same boundary decision 0201 already gives granting a
   * role — decision 0328.** A person created with no org allocation,
   * or one outside what the granter administers, would not be
   * visible to that same administrator again afterward (decision
   * 0321's own scoping).
   */
  it("refuses a delegated administrator creating a person with no org at all", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-fr', 'Acme France')").run();
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" }, ["acme-fr"]);
    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("cannot_create_without_org");
    const row = await env.DB.prepare("SELECT 1 FROM org_users WHERE id = 'usr1'").first();
    expect(row).toBeNull();
  });

  it("refuses a delegated administrator creating a person outside what they administer", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-fr', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-de', 'Acme Deutschland')").run();
    const result = await handleCreateUser(
      env.DB,
      { id: "usr1", email: "a@b.com", name: "Alice", unitId: "acme-de" },
      ["acme-fr"]
    );
    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("outside_administered_units");
  });

  it("lets a delegated administrator create a person within what they administer", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-fr', 'Acme France')").run();
    const result = await handleCreateUser(
      env.DB,
      { id: "usr1", email: "a@b.com", name: "Alice", unitId: "acme-fr" },
      ["acme-fr"]
    );
    expect(result.status).toBe(201);
  });

  it("lets an unrestricted administrator create a person with no org at all", async () => {
    // granterUnits null means unscoped -- the same signal
    // handleAssignRole and handleRevokeRole already use.
    const result = await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" }, null);
    expect(result.status).toBe(201);
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

describe("handleUpdateRole — decision 0326", () => {
  /**
   * **The write side this session's own raw SQL stood in for**, every
   * time a role's own permissions changed this whole conversation.
   * "Replace, not merge" — the same reasoning decision 0208 already
   * gives a supplier load — so this always sets the full permission
   * list, never patches one entry into whatever was already there.
   */
  it("replaces an existing role's own name and permissions", async () => {
    await handleCreateRole(env.DB, { id: "r1", name: "Old Name", permissions: ["AP.Validate"] });
    const result = await handleUpdateRole(env.DB, "r1", { name: "New Name", permissions: ["AP.Approve", "AP.Review"] });
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT name, permissions_json FROM org_roles WHERE id = ?")
      .bind("r1")
      .first();
    expect(row).toEqual({ name: "New Name", permissions_json: '["AP.Approve","AP.Review"]' });
  });

  it("404s a role that does not exist", async () => {
    const result = await handleUpdateRole(env.DB, "does-not-exist", { name: "New Name", permissions: [] });
    expect(result.status).toBe(404);
  });

  it("400s with no name given at all", async () => {
    await handleCreateRole(env.DB, { id: "r1", name: "Old Name" });
    const result = await handleUpdateRole(env.DB, "r1", { permissions: ["AP.Approve"] });
    expect(result.status).toBe(400);
  });

  it("422s when a permission is not in the closed vocabulary — refused, not silently stored", async () => {
    await handleCreateRole(env.DB, { id: "r1", name: "Old Name", permissions: ["AP.Validate"] });
    const result = await handleUpdateRole(env.DB, "r1", { name: "New Name", permissions: ["not_a_real_permission"] });
    expect(result.status).toBe(422);

    // The original, unchanged — a rejected write must not leave a
    // half-applied result behind.
    const row = await env.DB.prepare("SELECT name, permissions_json FROM org_roles WHERE id = ?")
      .bind("r1")
      .first();
    expect(row).toEqual({ name: "Old Name", permissions_json: '["AP.Validate"]' });
  });

  it("replaces with an empty permission list — a legitimate way to strip a role bare", async () => {
    await handleCreateRole(env.DB, { id: "r1", name: "Old Name", permissions: ["AP.Validate", "AP.Approve"] });
    const result = await handleUpdateRole(env.DB, "r1", { name: "Old Name", permissions: [] });
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT permissions_json FROM org_roles WHERE id = ?").bind("r1").first();
    expect(row).toEqual({ permissions_json: "[]" });
  });
});

describe("handleAssignRole", () => {
  it("assigns a role to a real user", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    const result = await handleAssignRole(env.DB, "usr1", "r1");
    expect(result.status).toBe(201);
    // **Where it is held, not just that it is** — decision 0199. Null
    // means everywhere, which is what an unscoped assignment is and
    // what every assignment predating that record became.
    const row = await env.DB.prepare(
      "SELECT user_id, role_id, unit_id FROM org_user_roles WHERE user_id = ? AND role_id = ?"
    )
      .bind("usr1", "r1")
      .first();
    expect(row).toEqual({ user_id: "usr1", role_id: "r1", unit_id: null });
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

describe("handleRevokeRole — decision 0327", () => {
  it("removes a real assignment", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "Admin" });
    await handleAssignRole(env.DB, "usr1", "r1");

    const result = await handleRevokeRole(env.DB, "usr1", "r1");
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT 1 FROM org_user_roles WHERE user_id = ? AND role_id = ?")
      .bind("usr1", "r1")
      .first();
    expect(row).toBeNull();
  });

  it("404s an assignment that never existed, rather than a silent no-op", async () => {
    const result = await handleRevokeRole(env.DB, "usr1", "r1");
    expect(result.status).toBe(404);
  });

  it("targets one specific unit, leaving the same role held at a different one untouched", async () => {
    // **Alice's own real shape**: AP Manager at both Acme Group and
    // Finance — a revoke must remove one without touching the other.
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "AP Manager" });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-group', 'Acme Group')").run();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('finance', 'Finance')").run();
    await handleAssignRole(env.DB, "usr1", "r1", "acme-group");
    await handleAssignRole(env.DB, "usr1", "r1", "finance");

    const result = await handleRevokeRole(env.DB, "usr1", "r1", "acme-group");
    expect(result.status).toBe(200);

    const remaining = await env.DB
      .prepare("SELECT unit_id FROM org_user_roles WHERE user_id = ? AND role_id = ?")
      .bind("usr1", "r1")
      .all<{ unit_id: string }>();
    expect(remaining.results.map((r: { unit_id: string }) => r.unit_id)).toEqual(["finance"]);
  });

  it("does not confuse a scoped assignment for the everywhere one it is not", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "AP Manager" });
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-group', 'Acme Group')").run();
    await handleAssignRole(env.DB, "usr1", "r1", "acme-group");

    // Revoking the everywhere assignment (unitId null) must not touch
    // the scoped one that actually exists.
    const result = await handleRevokeRole(env.DB, "usr1", "r1", null);
    expect(result.status).toBe(404);
    const row = await env.DB
      .prepare("SELECT 1 FROM org_user_roles WHERE user_id = ? AND role_id = ? AND unit_id = 'acme-group'")
      .bind("usr1", "r1")
      .first();
    expect(row).not.toBeNull();
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

describe("handleGetOrgOverview (decision 0319)", () => {
  /**
   * **The first, read-only half** of a role-management screen,
   * reported live: "consider a UI for Role Management... Role
   * permissions (including approval limits) fall into this category
   * as a sub task." Built on the same create functions above, so this
   * exercises the real shape those writes already produce.
   */
  it("returns an empty picture for a customer with nothing configured yet", async () => {
    const result = await handleGetOrgOverview(env.DB);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      units: [],
      users: [],
      roles: [],
      assignments: [],
      authorityLimits: [],
      knownPermissions: PERMISSIONS.map((name) => ({ name, description: PERMISSION_DESCRIPTIONS[name] })),
    });
  });

  it("returns the real, closed permission vocabulary, each with its own real description — decision 0331", async () => {
    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as { knownPermissions: { name: string; description: string }[] };
    expect(body.knownPermissions.map((p) => p.name)).toEqual([...PERMISSIONS]);
    expect(body.knownPermissions).toEqual(
      PERMISSIONS.map((name) => ({ name, description: PERMISSION_DESCRIPTIONS[name] }))
    );
    const roleManagement = body.knownPermissions.find((p) => p.name === "Admin.RoleManagement");
    expect(roleManagement?.description).toBe("Create and edit what a role itself grants");
    expect(body.knownPermissions.some((p) => p.name === "rules.activate")).toBe(false);
    // Every description is a real sentence, never blank or a repeat
    // of the name itself — the whole point of this field.
    for (const p of body.knownPermissions) {
      expect(p.description.length).toBeGreaterThan(0);
      expect(p.description).not.toBe(p.name);
    }
  });

  it("returns every unit, user, and role", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUser(env.DB, { id: "usr1", email: "alice@acme.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "AP Manager", permissions: ["AP.Approve"] });

    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as {
      units: { id: string; name: string }[];
      users: { id: string; email: string; name: string }[];
      roles: { id: string; name: string; permissions: string[] }[];
    };

    expect(body.units).toEqual([{ id: "fr", name: "Acme France", kind: "operating_unit", parentUnitId: null }]);
    expect(body.users[0]).toMatchObject({ id: "usr1", email: "alice@acme.com", name: "Alice" });
    expect(body.roles[0]).toEqual({ id: "r1", name: "AP Manager", permissions: ["AP.Approve"] });
  });

  it("joins an assignment to real names, not just ids", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "AP Manager" });
    await handleAssignRole(env.DB, "usr1", "r1", "fr");

    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as {
      assignments: { userName: string; roleName: string; unitName: string | null }[];
    };
    expect(body.assignments).toEqual([
      expect.objectContaining({ userName: "Alice", roleName: "AP Manager", unitName: "Acme France" }),
    ]);
  });

  it("shows an unscoped assignment's own unit as null, not omitted", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "AP Manager" });
    await handleAssignRole(env.DB, "usr1", "r1");

    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as { assignments: { unitId: string | null; unitName: string | null }[] };
    expect(body.assignments[0]).toMatchObject({ unitId: null, unitName: null });
  });

  it("survives a role with unparseable permissions, the same fallback permissionsFor already uses", async () => {
    await env.DB.prepare(
      "INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Broken', 'not json')"
    ).run();

    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as { roles: { id: string; permissions: string[] }[] };
    expect(body.roles[0]).toEqual({ id: "r1", name: "Broken", permissions: [] });
  });

  it("returns every authority limit, joined to the person's own name", async () => {
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: 5000 });

    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as { authorityLimits: { userName: string; currency: string; maxAmount: number }[] };
    expect(body.authorityLimits).toEqual([{ userName: "Alice", currency: "EUR", maxAmount: 5000, userId: "usr1" }]);
  });
});

describe("handleGetOrgOverview, scoped for a delegated administrator (decision 0321)", () => {
  /**
   * **The exact gap decision 0201 itself named**: "'AP Manager
   * (France)' is a pairing nobody can see listed." Mirrors
   * `handleAssignRole`'s own delegation logic exactly, rather than
   * inventing a second rule for the same boundary: a scoped
   * assignment is visible only where `unitId` is one of the units
   * passed in, and an unscoped ("everywhere") assignment is never
   * included — the same shape as that route's own
   * `cannot_grant_everywhere` refusal.
   */
  it("shows only units within the delegated scope", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUnit(env.DB, { id: "de", name: "Acme Germany" });

    const result = await handleGetOrgOverview(env.DB, ["fr"]);
    const body = result.body as { units: { id: string }[] };
    expect(body.units.map((u) => u.id)).toEqual(["fr"]);
  });

  it("shows an assignment at a scoped unit, and never an unscoped one", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob" });
    await handleCreateRole(env.DB, { id: "r1", name: "AP Manager" });
    await handleAssignRole(env.DB, "usr1", "r1", "fr");
    await handleAssignRole(env.DB, "usr2", "r1");

    const result = await handleGetOrgOverview(env.DB, ["fr"]);
    const body = result.body as { assignments: { userName: string; unitId: string | null }[] };
    expect(body.assignments).toEqual([expect.objectContaining({ userName: "Alice", unitId: "fr" })]);
  });

  it("shows a person whose own home unit is in scope, even with no assignment yet", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice", unitId: "fr" });

    const result = await handleGetOrgOverview(env.DB, ["fr"]);
    const body = result.body as { users: { name: string }[] };
    expect(body.users.map((u) => u.name)).toEqual(["Alice"]);
  });

  it("does not show a person entirely outside the scope", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUnit(env.DB, { id: "de", name: "Acme Germany" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice", unitId: "de" });

    const result = await handleGetOrgOverview(env.DB, ["fr"]);
    const body = result.body as { users: { name: string }[] };
    expect(body.users).toEqual([]);
  });

  it("never scopes role definitions, since they name no person or org", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUnit(env.DB, { id: "de", name: "Acme Germany" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice" });
    await handleCreateRole(env.DB, { id: "r1", name: "Germany Only", permissions: ["AP.Validate"] });
    await handleAssignRole(env.DB, "usr1", "r1", "de");

    const result = await handleGetOrgOverview(env.DB, ["fr"]);
    const body = result.body as { roles: { name: string }[] };
    expect(body.roles.map((r) => r.name)).toEqual(["Germany Only"]);
  });

  it("does not leak an out-of-scope person's own approval limit", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUnit(env.DB, { id: "de", name: "Acme Germany" });
    await handleCreateUser(env.DB, { id: "usr1", email: "a@b.com", name: "Alice", unitId: "fr" });
    await handleCreateUser(env.DB, { id: "usr2", email: "b@b.com", name: "Bob", unitId: "de" });
    await handleSetAuthorityLimit(env.DB, "usr1", { currency: "EUR", maxAmount: 5000 });
    await handleSetAuthorityLimit(env.DB, "usr2", { currency: "EUR", maxAmount: 9000 });

    const result = await handleGetOrgOverview(env.DB, ["fr"]);
    const body = result.body as { authorityLimits: { userName: string }[] };
    expect(body.authorityLimits.map((l) => l.userName)).toEqual(["Alice"]);
  });

  it("shows everything, unscoped, when nothing is passed — the instance administrator's own view", async () => {
    await handleCreateUnit(env.DB, { id: "fr", name: "Acme France" });
    await handleCreateUnit(env.DB, { id: "de", name: "Acme Germany" });

    const result = await handleGetOrgOverview(env.DB);
    const body = result.body as { units: { id: string }[] };
    expect(body.units.map((u) => u.id).sort()).toEqual(["de", "fr"]);
  });
});

describe("GET /org/overview, the real route — decision 0322", () => {
  /**
   * **Every earlier test called `handleGetOrgOverview` directly**,
   * never through the real HTTP route — so `authenticatePerson`,
   * `hasPermission`, and everything `index.ts` itself does around the
   * function were never exercised at all. Reported live: "the Roles
   * menu option does not launch anything" — a real 500 or 403 the
   * unit tests above could not have caught, because none of them ever
   * went through the route that produces one.
   */
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

  it("succeeds for a real request from somebody holding Admin.Configure", async () => {
    const apiKey = await keyForPermission("Admin.Configure");

    const res = await SELF.fetch("https://example.com/org/overview", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { units: unknown[]; roles: unknown[] };
    expect(body.units).toEqual([]);
    expect(body.roles).toHaveLength(1);
  });

  it("succeeds for a real request from a delegated Admin.UserManagement holder", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");

    const res = await SELF.fetch("https://example.com/org/overview", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
  });

  it("401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/org/overview");
    expect(res.status).toBe(401);
  });

  it("403s somebody holding neither permission", async () => {
    const apiKey = await keyForPermission("AP.Validate");

    const res = await SELF.fetch("https://example.com/org/overview", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(403);
  });
});

describe("POST /org/roles and PUT /org/roles/:id, the real routes — decision 0326", () => {
  /**
   * **`Admin.RoleManagement`, global-only.** Unlike `/org/overview`
   * above, a delegated `Admin.UserManagement` holder must NOT succeed
   * here — assigning an existing role to a person stays delegable,
   * decision 0201, but editing what a role itself grants does not:
   * "AP Manager" means the same thing everywhere it is held.
   */
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

  it("POST creates a role for a real request holding Admin.RoleManagement", async () => {
    const apiKey = await keyForPermission("Admin.RoleManagement");

    const res = await SELF.fetch("https://example.com/org/roles", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "new-role", name: "New Role", permissions: ["AP.Validate"] }),
    });

    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT name FROM org_roles WHERE id = 'new-role'").first();
    expect(row).toEqual({ name: "New Role" });
  });

  it("POST 401s with no credential at all", async () => {
    const res = await SELF.fetch("https://example.com/org/roles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "new-role", name: "New Role" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST 403s a delegated Admin.UserManagement holder — deliberately not enough here", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");

    const res = await SELF.fetch("https://example.com/org/roles", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "new-role", name: "New Role" }),
    });

    expect(res.status).toBe(403);
    const row = await env.DB.prepare("SELECT id FROM org_roles WHERE id = 'new-role'").first();
    expect(row).toBeNull();
  });

  it("PUT replaces an existing role's own permissions for a real request holding Admin.RoleManagement", async () => {
    const apiKey = await keyForPermission("Admin.RoleManagement");
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Old Name', '[]')").run();

    const res = await SELF.fetch("https://example.com/org/roles/r1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name", permissions: ["AP.Review"] }),
    });

    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT name, permissions_json FROM org_roles WHERE id = 'r1'").first();
    expect(row).toEqual({ name: "New Name", permissions_json: '["AP.Review"]' });
  });

  it("PUT 401s with no credential at all", async () => {
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Old Name', '[]')").run();
    const res = await SELF.fetch("https://example.com/org/roles/r1", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });
    expect(res.status).toBe(401);
  });

  it("PUT 403s a delegated Admin.UserManagement holder — deliberately not enough here", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Old Name', '[]')").run();

    const res = await SELF.fetch("https://example.com/org/roles/r1", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });

    expect(res.status).toBe(403);
    const row = await env.DB.prepare("SELECT name FROM org_roles WHERE id = 'r1'").first();
    expect(row).toEqual({ name: "Old Name" });
  });

  it("PUT 404s a role that does not exist, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.RoleManagement");

    const res = await SELF.fetch("https://example.com/org/roles/does-not-exist", {
      method: "PUT",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name" }),
    });

    expect(res.status).toBe(404);
  });
});

describe("POST and DELETE /org/users/:id/roles, the real routes — decision 0327", () => {
  /**
   * **The existing "assigns a role... through the real router" test**
   * (further up this file) only ever exercised the 401 bootstrap-ends
   * case. Neither route had a real, authenticated success test
   * through the actual HTTP path until this — the same gap decision
   * 0323 found for `/org/overview`.
   */
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

  it("POST assigns a role for a real request holding Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Target', '[]')").run();

    const res = await SELF.fetch("https://example.com/org/users/usr1/roles", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: "r1" }),
    });

    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT 1 FROM org_user_roles WHERE user_id = 'usr1' AND role_id = 'r1'").first();
    expect(row).not.toBeNull();
  });

  it("POST 403s a real request lacking Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("AP.Dashboard");
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Target', '[]')").run();

    const res = await SELF.fetch("https://example.com/org/users/usr1/roles", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: "r1" }),
    });

    expect(res.status).toBe(403);
  });

  it("DELETE revokes a real assignment for a real request holding Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Target', '[]')").run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('usr1', 'r1')").run();

    const res = await SELF.fetch("https://example.com/org/users/usr1/roles/r1", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
    const row = await env.DB.prepare("SELECT 1 FROM org_user_roles WHERE user_id = 'usr1' AND role_id = 'r1'").first();
    expect(row).toBeNull();
  });

  it("DELETE with ?unitId targets the right one of two assignments of the same role", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-group', 'Acme Group')").run();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('finance', 'Finance')").run();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r1', 'Target', '[]')").run();
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('usr1', 'r1', 'acme-group')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('usr1', 'r1', 'finance')"
    ).run();

    const res = await SELF.fetch("https://example.com/org/users/usr1/roles/r1?unitId=acme-group", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    expect(res.status).toBe(200);
    const remaining = await env.DB
      .prepare("SELECT unit_id FROM org_user_roles WHERE user_id = 'usr1' AND role_id = 'r1'")
      .all<{ unit_id: string }>();
    expect(remaining.results.map((r: { unit_id: string }) => r.unit_id)).toEqual(["finance"]);
  });

  it("DELETE 401s with no credential at all", async () => {
    // A real user must exist first to end the bootstrap exception —
    // otherwise isUnclaimed() skips auth entirely and this would 404
    // rather than 401, testing the wrong thing.
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('someone-else', 'x@b.com', 'X')").run();
    const res = await SELF.fetch("https://example.com/org/users/usr1/roles/r1", { method: "DELETE" });
    expect(res.status).toBe(401);
  });

  it("DELETE 403s a real request lacking Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("AP.Dashboard");
    const res = await SELF.fetch("https://example.com/org/users/usr1/roles/r1", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(403);
  });

  it("DELETE 404s an assignment that does not exist, through the real router", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    const res = await SELF.fetch("https://example.com/org/users/usr1/roles/r1", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(404);
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

describe("handleSetProfile — r2Jurisdiction (decision 0033)", () => {
  it("sets a real, supported jurisdiction", async () => {
    const result = await handleSetProfile(env.DB, { id: "rj1", ciusProfile: "en16931_base", r2Jurisdiction: "eu" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT r2_jurisdiction FROM org_profiles WHERE id = ?").bind("rj1").first();
    expect(row).toEqual({ r2_jurisdiction: "eu" });
  });

  it("accepts every one of the three real, currently-supported jurisdictions", async () => {
    for (const jurisdiction of ["eu", "fedramp", "us"] as const) {
      const result = await handleSetProfile(env.DB, { id: `rj-${jurisdiction}`, ciusProfile: "en16931_base", r2Jurisdiction: jurisdiction });
      expect(result.status).toBe(201);
    }
  });

  it("omitting r2Jurisdiction entirely is fine — unspecified/automatic, not an error", async () => {
    const result = await handleSetProfile(env.DB, { id: "rj2", ciusProfile: "en16931_base" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT r2_jurisdiction FROM org_profiles WHERE id = ?").bind("rj2").first();
    expect(row).toEqual({ r2_jurisdiction: null });
  });

  it("422s a genuinely unsupported jurisdiction — the real Saudi Arabia gap, refused rather than silently stored", async () => {
    const result = await handleSetProfile(env.DB, { id: "rj3", ciusProfile: "en16931_base", r2Jurisdiction: "ksa" });
    expect(result.status).toBe(422);
    const row = await env.DB.prepare("SELECT id FROM org_profiles WHERE id = ?").bind("rj3").first();
    expect(row).toBeNull(); // refused outright, nothing partially stored
  });

  it("422s a plausible-sounding but genuinely unsupported jurisdiction the same way", async () => {
    const result = await handleSetProfile(env.DB, { id: "rj4", ciusProfile: "en16931_base", r2Jurisdiction: "uk" });
    expect(result.status).toBe(422);
  });
});

describe("POST /org/users and /org/users/:id/authority-limits, the real routes — decision 0328", () => {
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

  it("POST creates a user for a real request holding Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");

    const res = await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });

    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT 1 FROM org_users WHERE id = 'usr1'").first();
    expect(row).not.toBeNull();
  });

  it("POST 403s a real request lacking Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("AP.Dashboard");

    const res = await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });

    expect(res.status).toBe(403);
  });

  it("POST 403s a delegated administrator creating outside what they administer, through the real router", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-fr', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-de', 'Acme Deutschland')").run();

    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
      .bind(id, `${id}@acme.com`, "Test", await hashApiKey(apiKey))
      .run();
    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(roleId, "Delegated", '["Admin.UserManagement"]')
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, 'acme-fr')")
      .bind(id, roleId)
      .run();

    const res = await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice", unitId: "acme-de" }),
    });

    expect(res.status).toBe(403);
    const row = await env.DB.prepare("SELECT 1 FROM org_users WHERE id = 'usr1'").first();
    expect(row).toBeNull();
  });

  it("POST 401s with no credential at all", async () => {
    // A real user must exist first to end the bootstrap exception.
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('someone-else', 'x@b.com', 'X')").run();
    const res = await SELF.fetch("https://example.com/org/users", {
      method: "POST",
      body: JSON.stringify({ id: "usr1", email: "a@b.com", name: "Alice" }),
    });
    expect(res.status).toBe(401);
  });

  it("authority-limits POST succeeds for a real request holding Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("Admin.UserManagement");
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();

    const res = await SELF.fetch("https://example.com/org/users/usr1/authority-limits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ currency: "EUR", maxAmount: 5000 }),
    });

    expect(res.status).toBe(200);
    const row = await env.DB
      .prepare("SELECT max_amount FROM org_authority_limits WHERE user_id = 'usr1' AND currency = 'EUR'")
      .first();
    expect(row).toEqual({ max_amount: 5000 });
  });

  it("authority-limits POST 401s with no credential at all", async () => {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();
    const res = await SELF.fetch("https://example.com/org/users/usr1/authority-limits", {
      method: "POST",
      body: JSON.stringify({ currency: "EUR", maxAmount: 5000 }),
    });
    expect(res.status).toBe(401);
  });

  it("authority-limits POST 403s a real request lacking Admin.UserManagement", async () => {
    const apiKey = await keyForPermission("AP.Dashboard");
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('usr1', 'a@b.com', 'Alice')").run();

    const res = await SELF.fetch("https://example.com/org/users/usr1/authority-limits", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ currency: "EUR", maxAmount: 5000 }),
    });

    expect(res.status).toBe(403);
    const row = await env.DB
      .prepare("SELECT 1 FROM org_authority_limits WHERE user_id = 'usr1'")
      .first();
    expect(row).toBeNull();
  });
});
