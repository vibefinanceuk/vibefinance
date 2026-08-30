import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { hashApiKey } from "../src/user-auth.js";
import { hasPermission, requirePermission } from "../src/enforce.js";

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
