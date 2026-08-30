import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { isValidCustomerKey } from "../src/auth.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateCustomer", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, { id: "acme" });
    expect(result.status).toBe(400);
  });

  it("creates a customer and persists it in real D1", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
    });
    expect(result.status).toBe(201);

    // Measure the rendered result, not the instruction issued (§7):
    // query D1 directly.
    const row = await env.CONTROL_DB.prepare(
      "SELECT id, name, region, instance_url FROM customers WHERE id = ?"
    )
      .bind("acme")
      .first();
    expect(row).toEqual({
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instance_url: "https://vf-app.acme.workers.dev",
    });
  });

  it("returns a real API key in the response, and stores only its hash — never the plaintext", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    const { apiKey } = result.body as { apiKey: string };
    expect(apiKey).toBeTruthy();
    expect(apiKey.length).toBeGreaterThan(0);

    const row = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM customers WHERE id = ?")
      .bind("acme")
      .first<{ api_key_hash: string }>();
    expect(row?.api_key_hash).toBeTruthy();
    // The whole point: the stored value must not be the plaintext key,
    // and must not even contain it as a substring.
    expect(row?.api_key_hash).not.toBe(apiKey);
    expect(row?.api_key_hash).not.toContain(apiKey);
  });

  it("the returned key actually authenticates this customer", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    const { apiKey } = result.body as { apiKey: string };
    expect(await isValidCustomerKey(env.CONTROL_DB, "acme", apiKey)).toBe(true);
  });

  it("409s on a duplicate id rather than silently overwriting", async () => {
    const body = { id: "acme", name: "Acme Corp", region: "eu", instanceUrl: "https://x" };
    const first = await handleCreateCustomer(env.CONTROL_DB, body);
    expect(first.status).toBe(201);

    const second = await handleCreateCustomer(env.CONTROL_DB, {
      ...body,
      name: "A Different Name",
    });
    expect(second.status).toBe(409);

    // Confirm the original row was not overwritten.
    const row = await env.CONTROL_DB.prepare("SELECT name FROM customers WHERE id = ?")
      .bind("acme")
      .first();
    expect(row).toEqual({ name: "Acme Corp" });
  });
});
