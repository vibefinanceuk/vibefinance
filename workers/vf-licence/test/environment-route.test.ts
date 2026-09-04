import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment, handleDeleteEnvironment } from "../src/environment-route.js";
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

describe("deleting an environment created in error (decision 0085)", () => {
  async function seed(customerId = "acme", kind = "production", region = "eu") {
    await handleCreateCustomer(env.CONTROL_DB, { id: customerId, name: `${customerId} Corp` });
    return handleCreateEnvironment(env.CONTROL_DB, {
      customerId,
      kind,
      region,
      instanceUrl: "https://x",
    });
  }

  it("removes one that nothing references", async () => {
    await seed();
    const result = await handleDeleteEnvironment(env.CONTROL_DB, "acme-production-eu");
    expect(result.status).toBe(200);

    const row = await env.CONTROL_DB.prepare("SELECT id FROM environments WHERE id = 'acme-production-eu'").first();
    expect(row).toBeNull();
  });

  it("404s one that never existed", async () => {
    expect((await handleDeleteEnvironment(env.CONTROL_DB, "no-such-environment")).status).toBe(404);
  });

  it("refuses one with a licence, naming what blocked it", async () => {
    // History is not tidied away. And the message says WHICH reference
    // blocked it, which a raw foreign key error would not.
    await seed();
    await env.CONTROL_DB.prepare(
      "INSERT INTO licences (environment_id, plan, status, volume_entitlement, valid_from) VALUES ('acme-production-eu','trial','active',1000,'2026-01-01')"
    ).run();

    const result = await handleDeleteEnvironment(env.CONTROL_DB, "acme-production-eu");
    expect(result.status).toBe(409);
    expect(String((result.body as { error: string }).error)).toContain("1 licence(s)");
  });

  it("refuses one with usage periods — billing evidence", async () => {
    await seed();
    await env.CONTROL_DB.prepare(
      "INSERT INTO usage_periods (environment_id, period_key) VALUES ('acme-production-eu','2026-09')"
    ).run();

    const result = await handleDeleteEnvironment(env.CONTROL_DB, "acme-production-eu");
    expect(result.status).toBe(409);
    expect(String((result.body as { error: string }).error)).toContain("usage period(s)");
  });

  it("names every blocking reference, not just the first", async () => {
    // An operator deciding whether a deletion is safe needs the whole
    // picture, not one reason at a time.
    await seed();
    await env.CONTROL_DB.prepare(
      "INSERT INTO licences (environment_id, plan, status, volume_entitlement, valid_from) VALUES ('acme-production-eu','trial','active',1000,'2026-01-01')"
    ).run();
    await env.CONTROL_DB.prepare(
      "INSERT INTO usage_periods (environment_id, period_key) VALUES ('acme-production-eu','2026-09')"
    ).run();

    const body = (await handleDeleteEnvironment(env.CONTROL_DB, "acme-production-eu")).body as { error: string };
    expect(body.error).toContain("licence(s)");
    expect(body.error).toContain("usage period(s)");
  });

  it("leaves the customer alone", async () => {
    // Deleting an environment is not deleting a customer.
    await seed();
    await handleDeleteEnvironment(env.CONTROL_DB, "acme-production-eu");
    const customer = await env.CONTROL_DB.prepare("SELECT id FROM customers WHERE id = 'acme'").first();
    expect(customer).not.toBeNull();
  });

  it("frees the region so it can be created again", async () => {
    // The point of removing a mistake: the slot must become available.
    await seed();
    await handleDeleteEnvironment(env.CONTROL_DB, "acme-production-eu");
    const again = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://y",
    });
    expect(again.status).toBe(201);
  });
});
