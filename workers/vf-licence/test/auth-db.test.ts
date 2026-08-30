import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleRotateKey } from "../src/rotate-key-route.js";
import { isValidCustomerKey } from "../src/auth.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("isValidCustomerKey", () => {
  it("accepts the key issued at customer creation", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
    });
    const { apiKey } = result.body as { apiKey: string };

    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", apiKey)).toBe(true);
  });

  it("rejects a wrong key for a real customer", async () => {
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", "totally-wrong-key")).toBe(false);
  });

  it("rejects when no key is provided", async () => {
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", null)).toBe(false);
  });

  it("rejects for a customer that doesn't exist at all", async () => {
    expect(await isValidCustomerKey(env.CONTROL_DB, "does-not-exist", "any-key")).toBe(false);
  });

  it("rejects for a customer created before this migration — api_key_hash is NULL, not open access", async () => {
    // Simulates Acme's real pre-migration state directly, bypassing
    // handleCreateCustomer (which always sets a key for new rows) —
    // this is specifically the backfill scenario.
    await env.CONTROL_DB.prepare(
      "INSERT INTO customers (id, name, region, instance_url) VALUES (?, ?, ?, ?)"
    )
      .bind("legacy-customer", "Legacy Co", "eu", "https://x")
      .run();
    expect(await isValidCustomerKey(env.CONTROL_DB, "legacy-customer", "any-key-at-all")).toBe(false);
  });

  it("the critical property: customer A's key must never authenticate as customer B", async () => {
    const resultA = await handleCreateCustomer(env.CONTROL_DB, {
      id: "customer-a",
      name: "Customer A",
      region: "eu",
      instanceUrl: "https://a.example.com",
    });
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "customer-b",
      name: "Customer B",
      region: "eu",
      instanceUrl: "https://b.example.com",
    });
    const { apiKey: keyA } = resultA.body as { apiKey: string };

    // A's key correctly authenticates as A...
    expect(await isValidCustomerKey(env.CONTROL_DB, "customer-a", keyA)).toBe(true);
    // ...but must NOT authenticate as B, even though it's a completely
    // valid, real key — just for the wrong customer.
    expect(await isValidCustomerKey(env.CONTROL_DB, "customer-b", keyA)).toBe(false);
  });

  it("a rotated key replaces the old one — the old key stops working", async () => {
    const created = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    const { apiKey: oldKey } = created.body as { apiKey: string };
    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", oldKey)).toBe(true);

    const rotated = await handleRotateKey(env.CONTROL_DB, "acme");
    const { apiKey: newKey } = rotated.body as { apiKey: string };

    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", newKey)).toBe(true);
    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", oldKey)).toBe(false);
  });
});
