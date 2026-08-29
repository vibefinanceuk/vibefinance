import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";

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
