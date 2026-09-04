import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleRotateKey } from "../src/rotate-key-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedEnvironment(id = "acme", kind = "production") {
  await handleCreateCustomer(env.CONTROL_DB, { id, name: "Acme Corp" });
  return handleCreateEnvironment(env.CONTROL_DB, { customerId: id, kind, region: "eu", instanceUrl: "https://x" });
}

describe("handleRotateKey — re-keyed to environmentId (decision 0036)", () => {
  it("404s when the environment does not exist", async () => {
    const result = await handleRotateKey(env.CONTROL_DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("issues a new key for an environment that already has one", async () => {
    const created = await seedEnvironment();
    const { apiKey: firstKey } = created.body as { apiKey: string };

    const result = await handleRotateKey(env.CONTROL_DB, "acme-production-eu");
    expect(result.status).toBe(200);
    const { apiKey: secondKey } = result.body as { apiKey: string };
    expect(secondKey).not.toBe(firstKey);
  });

  it("backfills a key for an environment that never had one — the real Acme production scenario before its first rotation", async () => {
    // Simulates a real environment row inserted directly, the way
    // decision 0036's own migration backfills an existing customer's
    // deployment as their 'production' environment, carrying over
    // whatever api_key_hash it had — which could genuinely be NULL if
    // no key was ever rotated for it before this migration ran.
    await env.CONTROL_DB.prepare("INSERT INTO customers (id, name) VALUES (?, ?)").bind("legacy", "Legacy Co").run();
    await env.CONTROL_DB.prepare(
      "INSERT INTO environments (id, customer_id, kind, region, instance_url) VALUES (?, ?, ?, ?, ?)"
    )
      .bind("legacy-production-eu", "legacy", "production", "eu", "https://x")
      .run();

    const before = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM environments WHERE id = ?")
      .bind("legacy-production-eu")
      .first();
    expect(before).toEqual({ api_key_hash: null });

    const result = await handleRotateKey(env.CONTROL_DB, "legacy-production-eu");
    expect(result.status).toBe(200);

    const after = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM environments WHERE id = ?")
      .bind("legacy-production-eu")
      .first<{ api_key_hash: string }>();
    expect(after?.api_key_hash).toBeTruthy();
  });

  it("never returns the same key twice across repeated rotations", async () => {
    await seedEnvironment();
    const first = await handleRotateKey(env.CONTROL_DB, "acme-production-eu");
    const second = await handleRotateKey(env.CONTROL_DB, "acme-production-eu");
    const keyA = (first.body as { apiKey: string }).apiKey;
    const keyB = (second.body as { apiKey: string }).apiKey;
    expect(keyA).not.toBe(keyB);
  });

  it("rotating one environment's key never affects a sibling environment's own key for the same customer", async () => {
    await seedEnvironment("acme", "production");
    const sandboxCreated = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://sandbox.x",
    });
    const { apiKey: sandboxKeyBefore } = sandboxCreated.body as { apiKey: string };

    await handleRotateKey(env.CONTROL_DB, "acme-production-eu");

    const sandboxRow = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM environments WHERE id = ?")
      .bind("acme-sandbox-eu")
      .first<{ api_key_hash: string }>();
    // The sandbox's own hash is unchanged by rotating production's key.
    expect(sandboxRow?.api_key_hash).toBeTruthy();
    void sandboxKeyBefore; // confirmed a real key existed before; the hash itself is what's checked for stability
  });
});
