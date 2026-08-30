import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleRotateKey } from "../src/rotate-key-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleRotateKey", () => {
  it("404s when the customer does not exist", async () => {
    const result = await handleRotateKey(env.CONTROL_DB, "does-not-exist");
    expect(result.status).toBe(404);
  });

  it("issues a new key for a customer that already has one", async () => {
    const created = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    const { apiKey: firstKey } = created.body as { apiKey: string };

    const result = await handleRotateKey(env.CONTROL_DB, "acme");
    expect(result.status).toBe(200);
    const { apiKey: secondKey } = result.body as { apiKey: string };
    expect(secondKey).not.toBe(firstKey);
  });

  it("backfills a key for a customer that never had one — the Acme scenario", async () => {
    // Simulates a customer created before this whole authentication
    // mechanism existed: no api_key_hash at all, not even a call
    // through handleCreateCustomer's newer code path.
    await env.CONTROL_DB.prepare(
      "INSERT INTO customers (id, name, region, instance_url) VALUES (?, ?, ?, ?)"
    )
      .bind("legacy", "Legacy Co", "eu", "https://x")
      .run();

    const before = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM customers WHERE id = ?")
      .bind("legacy")
      .first();
    expect(before).toEqual({ api_key_hash: null });

    const result = await handleRotateKey(env.CONTROL_DB, "legacy");
    expect(result.status).toBe(200);

    const after = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM customers WHERE id = ?")
      .bind("legacy")
      .first<{ api_key_hash: string }>();
    expect(after?.api_key_hash).toBeTruthy();
  });

  it("never returns the same key twice across repeated rotations", async () => {
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    const first = await handleRotateKey(env.CONTROL_DB, "acme");
    const second = await handleRotateKey(env.CONTROL_DB, "acme");
    const keyA = (first.body as { apiKey: string }).apiKey;
    const keyB = (second.body as { apiKey: string }).apiKey;
    expect(keyA).not.toBe(keyB);
  });
});
