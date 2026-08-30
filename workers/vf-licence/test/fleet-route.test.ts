import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleListCustomers, handleSetFleetMetadata } from "../src/fleet-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleListCustomers", () => {
  it("returns an empty list when there are no customers", async () => {
    const result = await handleListCustomers(env.CONTROL_DB);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ customers: [] });
  });

  it("lists a customer created without fleet metadata as nulls, not omitted", async () => {
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
    });
    const result = await handleListCustomers(env.CONTROL_DB);
    const body = result.body as { customers: Record<string, unknown>[] };
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0]).toMatchObject({
      id: "acme",
      workerName: null,
      d1DatabaseName: null,
      d1DatabaseId: null,
      locale: null,
    });
  });

  it("includes fleet metadata set at creation time", async () => {
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-acme",
      d1DatabaseId: "abc-123",
      locale: "en",
    });
    const result = await handleListCustomers(env.CONTROL_DB);
    const body = result.body as { customers: Record<string, unknown>[] };
    expect(body.customers[0]).toMatchObject({
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-acme",
      d1DatabaseId: "abc-123",
      locale: "en",
    });
  });

  it("never includes api_key_hash — a fleet manifest, not a customer-secrets endpoint", async () => {
    const result = await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme Corp",
      region: "eu",
      instanceUrl: "https://x",
    });
    const listResult = await handleListCustomers(env.CONTROL_DB);
    const body = listResult.body as { customers: Record<string, unknown>[] };
    expect(Object.keys(body.customers[0])).not.toContain("apiKeyHash");
    expect(Object.keys(body.customers[0])).not.toContain("api_key_hash");
    // Confirms this test itself isn't vacuous — a real key really was generated.
    expect((result.body as { apiKey: string }).apiKey).toBeTruthy();
  });

  it("lists every customer, in a stable order", async () => {
    await handleCreateCustomer(env.CONTROL_DB, { id: "zeta", name: "Z", region: "eu", instanceUrl: "https://z" });
    await handleCreateCustomer(env.CONTROL_DB, { id: "alpha", name: "A", region: "eu", instanceUrl: "https://a" });
    const result = await handleListCustomers(env.CONTROL_DB);
    const body = result.body as { customers: { id: string }[] };
    expect(body.customers.map((c) => c.id)).toEqual(["alpha", "zeta"]);
  });
});

describe("handleSetFleetMetadata", () => {
  it("404s for a customer that does not exist", async () => {
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "does-not-exist", { workerName: "x" });
    expect(result.status).toBe(404);
  });

  it("sets fleet metadata for a customer that had none — the Acme backfill scenario", async () => {
    await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme", region: "eu", instanceUrl: "https://x" });
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "acme", {
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-poc",
      d1DatabaseId: "7cac2188-4fce-46e1-a555-2b2ac852f494",
      locale: "en",
    });
    expect(result.status).toBe(200);
    const row = await env.CONTROL_DB.prepare(
      "SELECT worker_name, d1_database_name, d1_database_id, locale FROM customers WHERE id = ?"
    )
      .bind("acme")
      .first();
    expect(row).toEqual({
      worker_name: "vf-app-acme",
      d1_database_name: "vf-app-poc",
      d1_database_id: "7cac2188-4fce-46e1-a555-2b2ac852f494",
      locale: "en",
    });
  });

  it("a true partial update — only the fields provided change, everything else is preserved", async () => {
    await handleCreateCustomer(env.CONTROL_DB, {
      id: "acme",
      name: "Acme",
      region: "eu",
      instanceUrl: "https://x",
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-poc",
      d1DatabaseId: "old-id",
      locale: "en",
    });
    // Only updating d1DatabaseId, as if the database were recreated.
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "acme", { d1DatabaseId: "new-id" });
    expect(result.status).toBe(200);
    const row = await env.CONTROL_DB.prepare(
      "SELECT worker_name, d1_database_name, d1_database_id, locale FROM customers WHERE id = ?"
    )
      .bind("acme")
      .first();
    expect(row).toEqual({
      worker_name: "vf-app-acme", // unchanged
      d1_database_name: "vf-app-poc", // unchanged
      d1_database_id: "new-id", // changed
      locale: "en", // unchanged
    });
  });

  it("400s on an empty-string field rather than silently storing it", async () => {
    await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme", region: "eu", instanceUrl: "https://x" });
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "acme", { workerName: "" });
    expect(result.status).toBe(400);
  });
});
