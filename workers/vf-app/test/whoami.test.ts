import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { authenticateUserOrSession } from "../src/user-auth.js";
import { permissionsFor, unitsFor } from "../src/enforce.js";
import { signSessionToken, SESSION_TTL_SECONDS, type SessionClaims } from "@vibefinance/shared";

const THIS_ENVIRONMENT = "Acme-production";
let privateKey: JsonWebKey;
let publicKey: JsonWebKey;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  privateKey = await crypto.subtle.exportKey("jwk", pair.privateKey);
  publicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
});

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  const now = new Date();
  return {
    email: "alice@acme.com",
    name: "Alice",
    environmentId: THIS_ENVIRONMENT,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ...overrides,
  };
}

function withBearer(token: string): Request {
  return new Request("https://x/whoami", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('alice', 'alice@acme.com', 'Alice')").run();
  await env.DB.prepare(
    "INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-ap', 'AP', '[\"AP.Validate\",\"AP.Approve\"]')"
  ).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('alice', 'r-ap')").run();
});

describe("a session token gets you in", () => {
  it("resolves to the instance's own user record", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const result = await authenticateUserOrSession(env.DB, withBearer(token), publicKey, THIS_ENVIRONMENT);
    expect(result.user?.id).toBe("alice");
  });

  it("says which credential got them in", async () => {
    // Useful when a session works and a key does not, or the reverse.
    const token = await signSessionToken(claims(), privateKey);
    const result = await authenticateUserOrSession(env.DB, withBearer(token), publicKey, THIS_ENVIRONMENT);
    if (result.user) expect(result.via).toBe("session");
  });

  it("refuses a token minted for another environment", async () => {
    const token = await signSessionToken(claims({ environmentId: "Northwind-production" }), privateKey);
    const result = await authenticateUserOrSession(env.DB, withBearer(token), publicKey, THIS_ENVIRONMENT);
    expect(result.user).toBeNull();
  });

  it("says the person is not set up here, rather than that the token was bad", async () => {
    // Different problems needing different answers from whoever is
    // helping them (decision 0088).
    const token = await signSessionToken(claims({ email: "stranger@acme.com" }), privateKey);
    const result = await authenticateUserOrSession(env.DB, withBearer(token), publicKey, THIS_ENVIRONMENT);
    expect(result.user).toBeNull();
    if (!result.user) expect(result.reason).toContain("stranger@acme.com");
  });
});

describe("API keys keep working alongside sessions", () => {
  it("authenticates by key when no session is presented", async () => {
    // Every live test in this project uses an API key. Replacing keys
    // with sessions would break automation to solve a problem
    // automation does not have.
    const { generateApiKey, hashApiKey } = await import("../src/user-auth.js");
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'alice'")
      .bind(await hashApiKey(key))
      .run();

    const result = await authenticateUserOrSession(env.DB, withBearer(key), publicKey, THIS_ENVIRONMENT);
    expect(result.user?.id).toBe("alice");
    if (result.user) expect(result.via).toBe("api_key");
  });

  it("still works when the instance has no signing key configured", async () => {
    const { generateApiKey, hashApiKey } = await import("../src/user-auth.js");
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'alice'")
      .bind(await hashApiKey(key))
      .run();

    const result = await authenticateUserOrSession(env.DB, withBearer(key), undefined, undefined);
    expect(result.user?.id).toBe("alice");
  });

  it("refuses a credential that is neither", async () => {
    const result = await authenticateUserOrSession(env.DB, withBearer("not-a-real-credential"), publicKey, THIS_ENVIRONMENT);
    expect(result.user).toBeNull();
  });
});

describe("the permissions a screen needs", () => {
  it("returns every permission at once", async () => {
    // A screen needs the whole set to know which buttons to render,
    // rather than discovering by being refused.
    expect(await permissionsFor(env.DB, "alice")).toEqual(["AP.Approve", "AP.Validate"]);
  });

  it("merges permissions across several roles without duplicating", async () => {
    await env.DB.prepare(
      "INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-admin', 'Admin', '[\"AP.Approve\",\"Admin.Configure\"]')"
    ).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('alice', 'r-admin')").run();

    expect(await permissionsFor(env.DB, "alice")).toEqual(["AP.Approve", "AP.Validate", "Admin.Configure"]);
  });

  it("returns nothing for somebody with no roles", async () => {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('bob', 'bob@acme.com', 'Bob')").run();
    expect(await permissionsFor(env.DB, "bob")).toEqual([]);
  });

  it("survives a role with unparseable permissions", async () => {
    // One bad row must not lock somebody out of every screen.
    await env.DB.prepare(
      "INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-bad', 'Broken', 'not json')"
    ).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('alice', 'r-bad')").run();

    expect(await permissionsFor(env.DB, "alice")).toEqual(["AP.Approve", "AP.Validate"]);
  });
});

describe("which orgs a person can focus on (decision 0313)", () => {
  /**
   * **The first piece of the operator's own request**: "expose which
   * orgs a user belongs to... build the org switcher + current-org
   * plumbing." This tests `unitsFor()` directly, the same way
   * `permissionsFor()` is tested above it.
   */
  beforeEach(async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('fr', 'Acme France')").run();
    await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('de', 'Acme Germany')").run();
  });

  it("returns nothing for somebody with no roles at all", async () => {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('bob', 'bob@acme.com', 'Bob')").run();
    expect(await unitsFor(env.DB, "bob")).toEqual({ units: [], holdsEverywhere: false });
  });

  it("returns only the units directly assigned, when nothing is held everywhere", async () => {
    // Alice's own role from the outer beforeEach is unscoped — remove
    // it so this test is genuinely about the directly-assigned case,
    // not the everywhere one.
    await env.DB.prepare("DELETE FROM org_user_roles WHERE user_id = 'alice'").run();
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'r-ap', 'fr')"
    ).run();

    expect(await unitsFor(env.DB, "alice")).toEqual({
      units: [{ id: "fr", name: "Acme France" }],
      holdsEverywhere: false,
    });
  });

  it("offers every real unit once at least one role is held everywhere", async () => {
    // The outer beforeEach's own role is already unscoped.
    expect(await unitsFor(env.DB, "alice")).toEqual({
      units: [
        { id: "fr", name: "Acme France" },
        { id: "de", name: "Acme Germany" },
      ],
      holdsEverywhere: true,
    });
  });

  it("puts directly-assigned units first, ahead of the rest of the catalogue", async () => {
    // Held everywhere (outer beforeEach) AND directly at France —
    // France should lead, not fall wherever alphabetical order puts
    // it among the rest.
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'r-ap', 'fr')"
    ).run();

    const result = await unitsFor(env.DB, "alice");
    expect(result.units.map((u) => u.id)).toEqual(["fr", "de"]);
  });

  it("does not list a unit twice when held both directly and via an everywhere role", async () => {
    await env.DB.prepare(
      "INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'r-ap', 'fr')"
    ).run();

    const result = await unitsFor(env.DB, "alice");
    expect(result.units.filter((u) => u.id === "fr")).toHaveLength(1);
  });
});
