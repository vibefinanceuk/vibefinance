import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { verifyLicenceToken } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleUpsertLicence } from "../src/licences-route.js";
import { handleIssueToken } from "../src/token-route.js";

const KEY_ALGORITHM = { name: "ECDSA", namedCurve: "P-256" } as const;
let privateKeyJwk: JsonWebKey;
let publicKeyJwk: JsonWebKey;

beforeAll(async () => {
  const keyPair = await crypto.subtle.generateKey(KEY_ALGORITHM, true, ["sign", "verify"]);
  privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  publicKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
});

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme Corp" });
  await handleCreateEnvironment(env.CONTROL_DB, {
    customerId: "acme",
    kind: "production",
    region: "eu",
    instanceUrl: "https://vf-app.acme.workers.dev",
  });
});

describe("handleIssueToken — re-keyed to environmentId (decision 0036)", () => {
  it("404s when no licence exists for the environment", async () => {
    const result = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-production");
    expect(result.status).toBe(404);
  });

  it("issues a token that verifies with the matching public key", async () => {
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
      features: ["rules_ai_compiler"],
    });

    const result = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-production");
    expect(result.status).toBe(200);
    const { token } = result.body as { token: string };

    const verified = await verifyLicenceToken(token, publicKeyJwk);
    expect(verified.ok).toBe(true);
    // customerId is the token's own, unchanged claim name (a real,
    // external contract vf-app already consumes) — its value is now
    // genuinely an environment id, not a bare customer id. See
    // handleIssueToken's own comment on why this field wasn't renamed.
    expect(verified.claims).toMatchObject({
      customerId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      status: "active",
      features: ["rules_ai_compiler"],
    });
  });

  it("carries the licence's actual status through to the signed claims, including 'blocked'", async () => {
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
      status: "blocked",
      statusReason: "non-payment",
    });

    const result = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-production");
    const { token } = result.body as { token: string };
    const verified = await verifyLicenceToken(token, publicKeyJwk);

    expect(verified.ok).toBe(true);
    expect(verified.claims?.status).toBe("blocked");
    expect(verified.claims?.statusReason).toBe("non-payment");
  });

  it("caps the token's expiry at the licence's own valid_to, never beyond it", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const nearFutureValidTo = "2026-01-02T00:00:00Z"; // well inside the default 48h window

    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
      validTo: nearFutureValidTo,
    });

    const result = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-production", now);
    const { expiresAt } = result.body as { expiresAt: string };
    // Compare parsed timestamps, not exact strings — Date#toISOString()
    // always includes milliseconds ('.000Z'), which the plain input
    // string here doesn't have; the code is correct, the earlier
    // string-equality assertion was just too strict about formatting.
    expect(new Date(expiresAt).getTime()).toBe(new Date(nearFutureValidTo).getTime());
  });

  it("defaults to a 48h token lifetime when the licence's valid_to is further away or absent", async () => {
    const now = new Date("2026-01-01T00:00:00Z");
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
      // no validTo — a year-long licence with no expiry set here
    });

    const result = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-production", now);
    const { expiresAt } = result.body as { expiresAt: string };
    expect(new Date(expiresAt).getTime() - now.getTime()).toBe(48 * 60 * 60 * 1000);
  });

  it("a customer's sandbox and production environments each get their own, independently issued token", async () => {
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://sandbox.acme.workers.dev",
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "premium",
      volumeEntitlement: 10000,
      validFrom: "2026-01-01",
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-sandbox",
      plan: "trial",
      volumeEntitlement: 100,
      validFrom: "2026-01-01",
    });

    const prodResult = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-production");
    const sandboxResult = await handleIssueToken(env.CONTROL_DB, privateKeyJwk, "acme-sandbox");

    const prodVerified = await verifyLicenceToken((prodResult.body as { token: string }).token, publicKeyJwk);
    const sandboxVerified = await verifyLicenceToken((sandboxResult.body as { token: string }).token, publicKeyJwk);

    expect(prodVerified.claims?.plan).toBe("premium");
    expect(sandboxVerified.claims?.plan).toBe("trial");
  });
});
