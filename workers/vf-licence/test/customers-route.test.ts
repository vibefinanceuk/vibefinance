import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateCustomer — identity only (decision 0036)", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, { id: "acme" });
    expect(result.status).toBe(400);
  });

  it("creates a customer and persists it in real D1", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme Corp" });
    expect(result.status).toBe(201);

    // Measure the rendered result, not the instruction issued (§7):
    // query D1 directly.
    const row = await env.CONTROL_DB.prepare("SELECT id, name FROM customers WHERE id = ?").bind("acme").first();
    expect(row).toEqual({ id: "acme", name: "Acme Corp" });
  });

  it("does not accept region/instanceUrl/apiKey any more — those now belong to handleCreateEnvironment", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
    } as Record<string, unknown>);
    expect(result.status).toBe(201);
    // The extra fields are silently ignored, not stored — a real,
    // deliberate property of the new, slimmed route, not an accident.
    const row = await env.CONTROL_DB.prepare("SELECT * FROM customers WHERE id = ?").bind("acme").first();
    expect(row).toEqual({ id: "acme", name: "Acme Corp", created_at: expect.any(String) });
  });

  it("409s on a duplicate id rather than silently overwriting", async () => {
    const first = await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme Corp" });
    expect(first.status).toBe(201);

    const second = await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "A Different Name" });
    expect(second.status).toBe(409);

    // Confirm the original row was not overwritten.
    const row = await env.CONTROL_DB.prepare("SELECT name FROM customers WHERE id = ?").bind("acme").first();
    expect(row).toEqual({ name: "Acme Corp" });
  });
});
