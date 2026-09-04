import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { authenticateSession } from "../src/user-auth.js";
import { signSessionToken, SESSION_TTL_SECONDS, type SessionClaims } from "@vibefinance/shared";

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

const THIS_ENVIRONMENT = "Acme-production-eu";
const NOW = new Date("2026-09-04T12:00:00.000Z");

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    email: "dan@acme.com",
    name: "Dan Y.",
    environmentId: THIS_ENVIRONMENT,
    issuedAt: NOW.toISOString(),
    expiresAt: new Date(NOW.getTime() + SESSION_TTL_SECONDS * 1000).toISOString(),
    ...overrides,
  };
}

async function request(token: string): Promise<Request> {
  return new Request("https://x/anything", { headers: { Authorization: `Bearer ${token}` } });
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan Y.')").run();
});

describe("authenticating by session token", () => {
  it("accepts a valid token for a set-up person", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.user.id).toBe("u-dan");
  });

  it("returns the instance's own record, not the token's claims", async () => {
    // The token says who authenticated; this database says who they are
    // here -- including a name an administrator may have corrected
    // after the identity provider supplied it.
    const token = await signSessionToken(claims({ name: "D. Young (from IdP)" }), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);
    if (result.ok) expect(result.user.name).toBe("Dan Y.");
  });
});

describe("a person with no org_users row is refused", () => {
  it("refuses them, rather than creating a row", async () => {
    // No roles, no unit, no authority limit, nothing known about them.
    // A row created here would have the shape of an account without any
    // of the decisions that make one meaningful.
    const token = await signSessionToken(claims({ email: "stranger@acme.com" }), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unknown_user");
  });

  it("creates nothing", async () => {
    const token = await signSessionToken(claims({ email: "stranger@acme.com" }), privateKey);
    await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);

    const count = await env.DB.prepare("SELECT count(*) AS n FROM org_users").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("says the person is unknown, not that the token was bad", async () => {
    // Different problems. Telling them sign-in failed sends them to
    // reset a password that was never wrong, when what they need is an
    // administrator.
    const token = await signSessionToken(claims({ email: "stranger@acme.com" }), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);
    if (!result.ok && result.reason === "unknown_user") {
      expect(result.email).toBe("stranger@acme.com");
    } else {
      throw new Error("expected unknown_user");
    }
  });

  it("refuses a person whose row is not active", async () => {
    // A leaver whose row was deactivated must not sign in, even with a
    // perfectly good token from an identity provider that has not yet
    // caught up.
    await env.DB.prepare("UPDATE org_users SET status = 'disabled' WHERE id = 'u-dan'").run();
    const token = await signSessionToken(claims(), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);
    expect(result.ok).toBe(false);
  });
});

describe("the token must be for this instance", () => {
  it("refuses a token minted for another environment", async () => {
    // One signing key serves the whole fleet, so this is the only thing
    // stopping a session for one customer opening another's data.
    const token = await signSessionToken(claims({ environmentId: "Northwind-production-eu" }), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid_token") {
      expect(result.detail).toContain("Northwind-production-eu");
    }
  });

  it("refuses a token for the same customer's other region", async () => {
    const token = await signSessionToken(claims({ environmentId: "Acme-production-us" }), privateKey);
    expect((await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW)).ok).toBe(false);
  });

  it("refuses a sandbox token at production", async () => {
    // What stops the development login stub reaching real data
    // (decision 0087), asserted from the consuming side.
    const token = await signSessionToken(claims({ environmentId: "Acme-sandbox-eu" }), privateKey);
    expect((await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, NOW)).ok).toBe(false);
  });
});

describe("refusals that are not about the person", () => {
  it("reports no token when the header is absent", async () => {
    const bare = new Request("https://x/anything");
    const result = await authenticateSession(env.DB, bare, publicKey, THIS_ENVIRONMENT, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_token");
  });

  it("refuses rather than degrades when the environment is not configured", async () => {
    // Verifying without knowing which environment this is would accept
    // a token minted for any other.
    const token = await signSessionToken(claims(), privateKey);
    const result = await authenticateSession(env.DB, await request(token), publicKey, undefined, NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_configured");
  });

  it("refuses an expired token", async () => {
    const token = await signSessionToken(claims(), privateKey);
    const later = new Date(NOW.getTime() + (SESSION_TTL_SECONDS + 1) * 1000);
    const result = await authenticateSession(env.DB, await request(token), publicKey, THIS_ENVIRONMENT, later);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "invalid_token") expect(result.detail).toContain("expired");
  });
});
