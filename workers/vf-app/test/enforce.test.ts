import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { hashApiKey } from "../src/user-auth.js";
import { hasPermission, requirePermission, requireAnyPermission, isWithinScope } from "../src/enforce.js";

async function seedUser(id: string, apiKey: string): Promise<void> {
  const hash = await hashApiKey(apiKey);
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, id, hash)
    .run();
}

async function seedRole(id: string, permissions: string[]): Promise<void> {
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(id, id, JSON.stringify(permissions))
    .run();
}

async function assignRole(userId: string, roleId: string): Promise<void> {
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, roleId).run();
}

function requestWithBearer(token: string): Request {
  return new Request("https://x", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("hasPermission", () => {
  it("returns true when the user's role grants the permission", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["AP.Approve"]);
    await assignRole("usr1", "r1");
    expect(await hasPermission(env.DB, "usr1", "AP.Approve")).toBe(true);
  });

  it("returns false when the user has no roles at all", async () => {
    await seedUser("usr1", "key1");
    expect(await hasPermission(env.DB, "usr1", "AP.Approve")).toBe(false);
  });

  it("returns false when the user's role doesn't grant this specific permission", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["Admin.RuleManagement"]);
    await assignRole("usr1", "r1");
    expect(await hasPermission(env.DB, "usr1", "AP.Approve")).toBe(false);
  });

  it("returns true if ANY of the user's several roles grants it", async () => {
    await seedUser("usr1", "key1");
    await seedRole("viewer", ["AP.Review"]);
    await seedRole("activator", ["AP.Approve"]);
    await assignRole("usr1", "viewer");
    await assignRole("usr1", "activator");
    expect(await hasPermission(env.DB, "usr1", "AP.Approve")).toBe(true);
  });
});

describe("requirePermission — the combined check", () => {
  it("401s when there is no valid key at all", async () => {
    const result = await requirePermission(env.DB, requestWithBearer("not-a-real-key"), "AP.Approve");
    expect(result).toEqual({ authorized: false, status: 401 });
  });

  it("403s a real, authenticated user who lacks the permission — distinguished from 401", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["Admin.RuleManagement"]);
    await assignRole("usr1", "r1");
    const result = await requirePermission(env.DB, requestWithBearer("key1"), "AP.Approve");
    expect(result).toEqual({ authorized: false, status: 403 });
  });

  it("authorizes a real user with the right permission, returning their identity", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["AP.Approve"]);
    await assignRole("usr1", "r1");
    const result = await requirePermission(env.DB, requestWithBearer("key1"), "AP.Approve");
    expect(result).toEqual({
      authorized: true,
      user: { id: "usr1", email: "usr1@example.com", name: "usr1" },
    });
  });

  it("the critical property: one user's permission grant must never authorize a different user's request", async () => {
    await seedUser("usr-a", "key-a");
    await seedUser("usr-b", "key-b");
    await seedRole("activator", ["AP.Approve"]);
    await assignRole("usr-a", "activator"); // only A has the permission

    const resultA = await requirePermission(env.DB, requestWithBearer("key-a"), "AP.Approve");
    expect(resultA.authorized).toBe(true);

    const resultB = await requirePermission(env.DB, requestWithBearer("key-b"), "AP.Approve");
    expect(resultB).toEqual({ authorized: false, status: 403 });
  });
});

/**
 * **"Either of these" — decision 0453.** A second entry point beside
 * `requirePermission`, for the read routes the Account Coding tab and
 * the invoice-line Coding pop-out now both reach — `Admin.Configure`
 * for the tab, `AP.Validate` for the pop-out, either sufficient.
 */
describe("requireAnyPermission — decision 0453", () => {
  it("401s when there is no valid key at all", async () => {
    const result = await requireAnyPermission(env.DB, requestWithBearer("not-a-real-key"), ["Admin.Configure", "AP.Validate"]);
    expect(result).toEqual({ authorized: false, status: 401 });
  });

  it("403s a real, authenticated user who holds neither permission", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["Admin.RuleManagement"]);
    await assignRole("usr1", "r1");
    const result = await requireAnyPermission(env.DB, requestWithBearer("key1"), ["Admin.Configure", "AP.Validate"]);
    expect(result).toEqual({ authorized: false, status: 403 });
  });

  it("authorizes a user holding only the first permission listed", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["Admin.Configure"]);
    await assignRole("usr1", "r1");
    const result = await requireAnyPermission(env.DB, requestWithBearer("key1"), ["Admin.Configure", "AP.Validate"]);
    expect(result.authorized).toBe(true);
  });

  it("authorizes a user holding only the second permission listed — order does not decide it", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["AP.Validate"]);
    await assignRole("usr1", "r1");
    const result = await requireAnyPermission(env.DB, requestWithBearer("key1"), ["Admin.Configure", "AP.Validate"]);
    expect(result.authorized).toBe(true);
  });

  it("authorizes a user holding both", async () => {
    await seedUser("usr1", "key1");
    await seedRole("r1", ["Admin.Configure", "AP.Validate"]);
    await assignRole("usr1", "r1");
    const result = await requireAnyPermission(env.DB, requestWithBearer("key1"), ["Admin.Configure", "AP.Validate"]);
    expect(result.authorized).toBe(true);
  });
});

describe("isWithinScope — the same unitClause visibility rule, for a single already-fetched value — decision 0375", () => {
  it("everything is within scope when unrestricted", () => {
    expect(isWithinScope({ units: null }, "acme-uk")).toBe(true);
    expect(isWithinScope({ units: null }, null)).toBe(true);
  });

  it("an unassigned value is always within scope, even for a real, narrow restriction", () => {
    expect(isWithinScope({ units: ["acme-uk"] }, null)).toBe(true);
  });

  it("a value inside the permitted set is within scope", () => {
    expect(isWithinScope({ units: ["acme-uk", "acme-fr"] }, "acme-uk")).toBe(true);
  });

  it("a value outside the permitted set is not within scope", () => {
    expect(isWithinScope({ units: ["acme-uk"] }, "acme-fr")).toBe(false);
  });

  it("nothing but an unassigned value is within scope when the permitted set is empty", () => {
    expect(isWithinScope({ units: [] }, "acme-uk")).toBe(false);
    expect(isWithinScope({ units: [] }, null)).toBe(true);
  });
});
