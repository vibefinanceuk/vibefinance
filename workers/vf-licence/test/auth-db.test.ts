import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleRotateKey } from "../src/rotate-key-route.js";
import { isValidEnvironmentKey } from "../src/auth.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedEnvironment(customerId: string, kind = "production") {
  await handleCreateCustomer(env.CONTROL_DB, { id: customerId, name: `${customerId} Corp` });
  return handleCreateEnvironment(env.CONTROL_DB, { customerId, kind, region: "eu", instanceUrl: "https://x" });
}

describe("isValidEnvironmentKey — re-keyed from isValidCustomerKey (decision 0036)", () => {
  it("accepts the key issued at environment creation", async () => {
    const result = await seedEnvironment("acme");
    const { apiKey } = result.body as { apiKey: string };

    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", apiKey)).toBe(true);
  });

  it("rejects a wrong key for a real environment", async () => {
    await seedEnvironment("acme");
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", "totally-wrong-key")).toBe(false);
  });

  it("rejects when no key is provided", async () => {
    await seedEnvironment("acme");
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", null)).toBe(false);
  });

  it("rejects for an environment that doesn't exist at all", async () => {
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "does-not-exist", "any-key")).toBe(false);
  });

  it("rejects for an environment created before this migration — api_key_hash is NULL, not open access", async () => {
    // Simulates the real backfill scenario directly, bypassing
    // handleCreateEnvironment (which always sets a key for new rows).
    await env.CONTROL_DB.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").bind("legacy", "Legacy Co").run();
    await env.CONTROL_DB.prepare(
      "INSERT INTO environments (id, customer_id, kind, region, instance_url) VALUES (?, ?, ?, ?, ?)"
    )
      .bind("legacy-production-eu", "legacy", "production", "eu", "https://x")
      .run();
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "legacy-production-eu", "any-key-at-all")).toBe(false);
  });

  it("the critical property: environment A's key must never authenticate as environment B", async () => {
    const resultA = await seedEnvironment("customer-a");
    await seedEnvironment("customer-b");
    const { apiKey: keyA } = resultA.body as { apiKey: string };

    // A's key correctly authenticates as A...
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "customer-a-production-eu", keyA)).toBe(true);
    // ...but must NOT authenticate as B, even though it's a completely
    // valid, real key — just for the wrong environment.
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "customer-b-production-eu", keyA)).toBe(false);
  });

  it("the same critical property within one customer: a sandbox's key must never authenticate as that same customer's production", async () => {
    const sandboxResult = await seedEnvironment("acme", "sandbox");
    await seedEnvironment("acme", "production");
    const { apiKey: sandboxKey } = sandboxResult.body as { apiKey: string };

    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-sandbox-eu", sandboxKey)).toBe(true);
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", sandboxKey)).toBe(false);
  });

  it("a rotated key replaces the old one — the old key stops working", async () => {
    const created = await seedEnvironment("acme");
    const { apiKey: oldKey } = created.body as { apiKey: string };
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", oldKey)).toBe(true);

    const rotated = await handleRotateKey(env.CONTROL_DB, "acme-production-eu");
    const { apiKey: newKey } = rotated.body as { apiKey: string };

    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", newKey)).toBe(true);
    expect(await isValidEnvironmentKey(env.CONTROL_DB, "acme-production-eu", oldKey)).toBe(false);
  });
});
