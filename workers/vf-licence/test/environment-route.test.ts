import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { isValidEnvironmentKey } from "../src/auth.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedCustomer(id = "acme") {
  await handleCreateCustomer(env.CONTROL_DB, { id, name: "Acme Corp" });
}

describe("handleCreateEnvironment (decision 0036)", () => {
  it("400s when a required field is missing", async () => {
    await seedCustomer();
    const result = await handleCreateEnvironment(env.CONTROL_DB, { customerId: "acme", kind: "production" });
    expect(result.status).toBe(400);
  });

  it("400s an invalid kind", async () => {
    await seedCustomer();
    const result = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "staging",
      region: "eu",
      instanceUrl: "https://x",
    });
    expect(result.status).toBe(400);
  });

  it("404s a customer that doesn't exist", async () => {
    const result = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "no-such-customer",
      kind: "production",
      region: "eu",
      instanceUrl: "https://x",
    });
    expect(result.status).toBe(404);
  });

  it("creates a real environment with a deterministic, human-readable id", async () => {
    await seedCustomer();
    const result = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
    });
    expect(result.status).toBe(201);
    expect(result.body.id).toBe("acme-production-eu");

    // Measure the rendered result, not the instruction issued (§7):
    // query D1 directly.
    const row = await env.CONTROL_DB.prepare("SELECT id, customer_id, kind, region, instance_url FROM environments WHERE id = ?")
      .bind("acme-production-eu")
      .first();
    expect(row).toEqual({
      id: "acme-production-eu",
      customer_id: "acme",
      kind: "production",
      region: "eu",
      instance_url: "https://vf-app.acme.workers.dev",
    });
  });

  it("returns a real API key in the response, and stores only its hash — never the plaintext", async () => {
    await seedCustomer();
    const result = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://x",
    });
    const { apiKey } = result.body as { apiKey: string };
    expect(apiKey).toBeTruthy();

    const row = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM environments WHERE id = ?")
      .bind("acme-production-eu")
      .first<{ api_key_hash: string }>();
    expect(row?.api_key_hash).toBeTruthy();
    expect(row?.api_key_hash).not.toBe(apiKey);
    expect(row?.api_key_hash).not.toContain(apiKey);
  });

  it("the returned key actually authenticates this environment", async () => {
    await seedCustomer();
    const result = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://x",
    });
    const { apiKey } = result.body as { apiKey: string };
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", apiKey)).toBe(true);
  });

  it("a customer can have both a sandbox and a production environment", async () => {
    await seedCustomer();
    const sandbox = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://sandbox.acme.workers.dev",
    });
    expect(sandbox.status).toBe(201);
    const production = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://prod.acme.workers.dev",
    });
    expect(production.status).toBe(201);

    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM environments WHERE customer_id = ?")
      .bind("acme")
      .first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("409s a second environment of the same kind for the same customer — the real UNIQUE constraint, not silently overwritten", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://x",
    });
    const second = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://y",
    });
    expect(second.status).toBe(409);
  });

  it("a sandbox environment's key must never authenticate as that same customer's production environment", async () => {
    await seedCustomer();
    const sandbox = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://sandbox.acme.workers.dev",
    });
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://prod.acme.workers.dev",
    });
    const { apiKey: sandboxKey } = sandbox.body as { apiKey: string };

    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-sandbox-eu", sandboxKey)).toBe(true);
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", sandboxKey)).toBe(false);
  });
});
