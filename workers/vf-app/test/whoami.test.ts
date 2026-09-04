import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { authenticateUserOrSession } from "../src/user-auth.js";
import { permissionsFor } from "../src/enforce.js";
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
