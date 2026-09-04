import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleDevLogin } from "../src/dev-login-route.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { verifySessionToken } from "@vibefinance/shared";

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

const ON = { allowDevLogin: true };
const OFF = { allowDevLogin: false };

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme" });
  await handleCreateEnvironment(env.CONTROL_DB, {
    customerId: "acme",
    kind: "sandbox",
    region: "eu",
    instanceUrl: "https://sandbox",
  });
  await handleCreateEnvironment(env.CONTROL_DB, {
    customerId: "acme",
    kind: "production",
    region: "eu",
    instanceUrl: "https://prod",
  });
});

describe("the development login stub", () => {
  it("issues a session token for a sandbox", async () => {
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", name: "Dan Y.", environmentId: "acme-sandbox-eu" },
      privateKey,
      ON
    );
    expect(result.status).toBe(200);

    const { token } = result.body as { token: string };
    const verified = await verifySessionToken(token, publicKey, "acme-sandbox-eu");
    expect(verified.ok).toBe(true);
    if (verified.ok) expect(verified.claims.email).toBe("dan@acme.com");
  });

  it("says in the payload that it is not single sign-on", async () => {
    // Anybody holding one of these should know what it is, without
    // reading the source that minted it.
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "acme-sandbox-eu" },
      privateKey,
      ON
    );
    expect(String((result.body as { warning: string }).warning)).toContain("not single sign-on");
  });

  it("falls back to the email when no name is given", async () => {
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "acme-sandbox-eu" },
      privateKey,
      ON
    );
    const { token } = result.body as { token: string };
    const verified = await verifySessionToken(token, publicKey, "acme-sandbox-eu");
    if (verified.ok) expect(verified.claims.name).toBe("dan@acme.com");
  });
});

describe("the two guards", () => {
  it("does not exist when dev login is off", async () => {
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "acme-sandbox-eu" },
      privateKey,
      OFF
    );
    expect(result.status).toBe(404);
  });

  it("returns 404 rather than 403 when off, admitting nothing", async () => {
    // A 403 tells somebody probing that there is something here to
    // enable. A deployment without dev login should not admit the route
    // could exist.
    const result = await handleDevLogin(env.CONTROL_DB, { email: "x@y.z", environmentId: "acme-sandbox-eu" }, privateKey, OFF);
    expect(String((result.body as { error: string }).error)).toBe("not found");
  });

  it("refuses a production environment even with dev login ON", async () => {
    // The guard that cannot be forgotten. A flag left on by accident,
    // or enabled for a debugging session and never turned off, still
    // cannot reach production.
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "acme-production-eu" },
      privateKey,
      ON
    );
    expect(result.status).toBe(403);
    expect(String((result.body as { error: string }).error)).toContain("production");
  });

  it("mints nothing when it refuses production", async () => {
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "acme-production-eu" },
      privateKey,
      ON
    );
    expect(result.body).not.toHaveProperty("token");
  });
});

describe("what it will not do", () => {
  it("refuses an environment that does not exist", async () => {
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "no-such-environment" },
      privateKey,
      ON
    );
    expect(result.status).toBe(404);
  });

  it("requires an email — an anonymous session is not a session", async () => {
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "   ", environmentId: "acme-sandbox-eu" },
      privateKey,
      ON
    );
    expect(result.status).toBe(400);
  });

  it("requires an environment, because the token must name one", async () => {
    const result = await handleDevLogin(env.CONTROL_DB, { email: "dan@acme.com" }, privateKey, ON);
    expect(result.status).toBe(400);
  });
});

describe("the token it issues is scoped", () => {
  it("is refused by another environment, sandbox or not", async () => {
    // The audience check (decision 0086), end to end from minting. One
    // signing key serves the fleet, so this is what stops a sandbox
    // token being presented to production.
    const result = await handleDevLogin(
      env.CONTROL_DB,
      { email: "dan@acme.com", environmentId: "acme-sandbox-eu" },
      privateKey,
      ON
    );
    const { token } = result.body as { token: string };

    const atProduction = await verifySessionToken(token, publicKey, "acme-production-eu");
    expect(atProduction.ok).toBe(false);
    if (!atProduction.ok) expect(atProduction.reason).toContain("acme-sandbox-eu");
  });
});
