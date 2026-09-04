import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleLogin, handleListMyEnvironments } from "../src/login-route.js";
import { setCredential, grantAccess } from "../src/credentials.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { verifySessionToken } from "@vibefinance/shared";

const PASSWORD = "a-long-enough-passphrase";
const EMAIL = "dan@acme.com";
const ENV_ID = "acme-production-eu";

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

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme" });
  await handleCreateCustomer(env.CONTROL_DB, { id: "nw", name: "Northwind" });
  for (const [customerId, region] of [["acme", "eu"], ["acme", "us"], ["nw", "eu"]]) {
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId,
      kind: "production",
      region,
      instanceUrl: `https://${customerId}-${region}`,
    });
  }
  await setCredential(env.CONTROL_DB, EMAIL, "acme", PASSWORD);
  await grantAccess(env.CONTROL_DB, EMAIL, ENV_ID);
});

function body(overrides: Record<string, unknown> = {}) {
  return { email: EMAIL, password: PASSWORD, environmentId: ENV_ID, ...overrides };
}

describe("signing in", () => {
  it("returns a token the named instance will accept", async () => {
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    expect(result.status).toBe(200);

    const { token } = result.body as { token: string };
    const verified = await verifySessionToken(token, publicKey, ENV_ID);
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.claims.email).toBe(EMAIL);
  });

  it("returns a token no OTHER instance will accept", async () => {
    // One signing key serves the whole fleet, so this is what stops a
    // session for one instance opening another's data.
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    const { token } = result.body as { token: string };
    expect((await verifySessionToken(token, publicKey, "acme-production-us")).ok).toBe(false);
  });

  it("tells the person where to go next", async () => {
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    expect((result.body as { instanceUrl: string }).instanceUrl).toBe("https://acme-eu");
  });
});

describe("what it refuses, and how", () => {
  it("refuses a wrong password", async () => {
    const result = await handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey);
    expect(result.status).toBe(401);
  });

  it("refuses somebody with no credential", async () => {
    const result = await handleLogin(env.CONTROL_DB, body({ email: "stranger@acme.com" }), privateKey);
    expect(result.status).toBe(401);
  });

  it("refuses an environment they hold no grant for", async () => {
    // The credential is per customer; the grant is per environment.
    // Holding one without the other must not get you in.
    const result = await handleLogin(env.CONTROL_DB, body({ environmentId: "acme-production-us" }), privateKey);
    expect(result.status).toBe(401);
  });

  it("refuses another customer's environment outright", async () => {
    const result = await handleLogin(env.CONTROL_DB, body({ environmentId: "nw-production-eu" }), privateKey);
    expect(result.status).toBe(401);
  });

  it("gives the SAME message for every one of them", async () => {
    // Distinguishing them would let anybody enumerate who has an
    // account and which environments exist.
    const refusals = await Promise.all([
      handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey),
      handleLogin(env.CONTROL_DB, body({ email: "stranger@acme.com" }), privateKey),
      handleLogin(env.CONTROL_DB, body({ environmentId: "acme-production-us" }), privateKey),
      handleLogin(env.CONTROL_DB, body({ environmentId: "no-such-environment" }), privateKey),
    ]);
    const messages = new Set(refusals.map((r) => (r.body as { error: string }).error));
    expect(messages.size).toBe(1);
  });

  it("mints no token when it refuses", async () => {
    const result = await handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey);
    expect(result.body).not.toHaveProperty("token");
  });

  it("records the attempt either way", async () => {
    await handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey);
    await handleLogin(env.CONTROL_DB, body(), privateKey);

    const rows = await env.CONTROL_DB.prepare(
      "SELECT succeeded FROM login_attempts ORDER BY attempted_at"
    ).all<{ succeeded: number }>();
    expect(rows.results).toHaveLength(2);
  });

  it("records an attempt against an environment that does not exist", async () => {
    // A probe, and exactly the attempt most worth seeing later.
    await handleLogin(env.CONTROL_DB, body({ environmentId: "no-such-environment" }), privateKey);
    const count = await env.CONTROL_DB.prepare(
      "SELECT count(*) AS n FROM login_attempts WHERE environment_id = 'no-such-environment'"
    ).first<{ n: number }>();
    expect(count?.n).toBe(1);
  });
});

describe("the delay applies before any work is done", () => {
  it("refuses with 429 once attempts have earned a wait", async () => {
    for (let i = 0; i < 5; i++) {
      await handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey);
    }
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    expect(result.status).toBe(429);
  });

  it("refuses even the RIGHT password while the wait stands", async () => {
    // An attacker who has earned a wait should not get a free
    // verification out of each attempt — that is the CPU cost Argon2id
    // exists to impose on them.
    for (let i = 0; i < 5; i++) {
      await handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey);
    }
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    expect(result.body).not.toHaveProperty("token");
  });

  it("says how long to wait, which is not a leak", async () => {
    // They already know the attempt failed.
    for (let i = 0; i < 5; i++) {
      await handleLogin(env.CONTROL_DB, body({ password: "wrong-but-long-enough" }), privateKey);
    }
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    expect((result.body as { retryAfterSeconds: number }).retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe("what a person is told after signing in (ISO 27001 A.8.5)", () => {
  it("reports no previous sign-in on the first one", async () => {
    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    expect((result.body as { lastSignedInAt: string | null }).lastSignedInAt).toBeNull();
  });

  it("reports the previous sign-in and the failures since", async () => {
    await handleLogin(env.CONTROL_DB, body(), privateKey);
    await env.CONTROL_DB.prepare(
      "INSERT INTO login_attempts (id, email, environment_id, succeeded, attempted_at) VALUES (?, ?, ?, 0, '2099-01-01 03:00:00')"
    )
      .bind(crypto.randomUUID(), EMAIL, ENV_ID)
      .run();

    const result = await handleLogin(env.CONTROL_DB, body(), privateKey);
    const reported = result.body as { lastSignedInAt: string | null; failedAttemptsSince: unknown[] };
    expect(reported.lastSignedInAt).not.toBeNull();
    expect(reported.failedAttemptsSince.length).toBeGreaterThan(0);
  });
});

describe("asking which instances you may reach", () => {
  it("lists them, given the right password", async () => {
    await grantAccess(env.CONTROL_DB, EMAIL, "acme-production-us");
    const result = await handleListMyEnvironments(env.CONTROL_DB, { email: EMAIL, password: PASSWORD });
    expect(result.status).toBe(200);
    expect((result.body as { environments: unknown[] }).environments).toHaveLength(2);
  });

  it("requires the password — an email alone must not map a customer's estate", async () => {
    const result = await handleListMyEnvironments(env.CONTROL_DB, { email: EMAIL, password: "wrong-but-long" });
    expect(result.status).toBe(401);
  });

  it("lists only what was granted, not everything the customer owns", async () => {
    // Decision 0083 section 5: an option that errors on click is worse
    // than an absent one.
    const result = await handleListMyEnvironments(env.CONTROL_DB, { email: EMAIL, password: PASSWORD });
    const listed = (result.body as { environments: { id: string }[] }).environments;
    expect(listed.map((e) => e.id)).toEqual([ENV_ID]);
  });
});
