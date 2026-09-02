import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleListEnvironments, handleSetFleetMetadata } from "../src/fleet-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedCustomer(id = "acme", name = "Acme Corp") {
  await handleCreateCustomer(env.CONTROL_DB, { id, name });
}

describe("handleListEnvironments — re-keyed from customers (decision 0036)", () => {
  it("returns an empty list when there are no environments", async () => {
    const result = await handleListEnvironments(env.CONTROL_DB);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ environments: [] });
  });

  it("lists an environment created without fleet metadata as nulls, not omitted", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
    });
    const result = await handleListEnvironments(env.CONTROL_DB);
    const body = result.body as { environments: Record<string, unknown>[] };
    expect(body.environments).toHaveLength(1);
    expect(body.environments[0]).toMatchObject({
      id: "acme-production",
      customerId: "acme",
      kind: "production",
      workerName: null,
      d1DatabaseName: null,
      d1DatabaseId: null,
      locale: null,
    });
  });

  it("includes fleet metadata set at creation time", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://vf-app.acme.workers.dev",
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-acme",
      d1DatabaseId: "abc-123",
      locale: "en",
    });
    const result = await handleListEnvironments(env.CONTROL_DB);
    const body = result.body as { environments: Record<string, unknown>[] };
    expect(body.environments[0]).toMatchObject({
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-acme",
      d1DatabaseId: "abc-123",
      locale: "en",
    });
  });

  it("never includes api_key_hash — a fleet manifest, not an environment-secrets endpoint", async () => {
    await seedCustomer();
    const result = await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://x",
    });
    const listResult = await handleListEnvironments(env.CONTROL_DB);
    const body = listResult.body as { environments: Record<string, unknown>[] };
    expect(Object.keys(body.environments[0])).not.toContain("apiKeyHash");
    expect(Object.keys(body.environments[0])).not.toContain("api_key_hash");
    // Confirms this test itself isn't vacuous — a real key really was generated.
    expect((result.body as { apiKey: string }).apiKey).toBeTruthy();
  });

  it("lists every environment, in a stable order", async () => {
    await seedCustomer("zeta", "Z");
    await seedCustomer("alpha", "A");
    await handleCreateEnvironment(env.CONTROL_DB, { customerId: "zeta", kind: "production", region: "eu", instanceUrl: "https://z" });
    await handleCreateEnvironment(env.CONTROL_DB, { customerId: "alpha", kind: "production", region: "eu", instanceUrl: "https://a" });
    const result = await handleListEnvironments(env.CONTROL_DB);
    const body = result.body as { environments: { id: string }[] };
    expect(body.environments.map((e) => e.id)).toEqual(["alpha-production", "zeta-production"]);
  });

  it("a customer's sandbox and production environments both appear as separate, real rows", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, { customerId: "acme", kind: "sandbox", region: "eu", instanceUrl: "https://sandbox.acme.workers.dev" });
    await handleCreateEnvironment(env.CONTROL_DB, { customerId: "acme", kind: "production", region: "eu", instanceUrl: "https://prod.acme.workers.dev" });
    const result = await handleListEnvironments(env.CONTROL_DB);
    const body = result.body as { environments: { id: string; customerId: string; kind: string }[] };
    expect(body.environments).toHaveLength(2);
    expect(body.environments.every((e) => e.customerId === "acme")).toBe(true);
    expect(body.environments.map((e) => e.kind).sort()).toEqual(["production", "sandbox"]);
  });
});

describe("handleSetFleetMetadata — re-keyed to environmentId", () => {
  it("404s for an environment that does not exist", async () => {
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "does-not-exist", { workerName: "x" });
    expect(result.status).toBe(404);
  });

  it("sets fleet metadata for an environment that had none — the Acme backfill scenario", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, { customerId: "acme", kind: "production", region: "eu", instanceUrl: "https://x" });
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "acme-production", {
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-poc",
      d1DatabaseId: "7cac2188-4fce-46e1-a555-2b2ac852f494",
      locale: "en",
    });
    expect(result.status).toBe(200);
    const row = await env.CONTROL_DB.prepare(
      "SELECT worker_name, d1_database_name, d1_database_id, locale FROM environments WHERE id = ?"
    )
      .bind("acme-production")
      .first();
    expect(row).toEqual({
      worker_name: "vf-app-acme",
      d1_database_name: "vf-app-poc",
      d1_database_id: "7cac2188-4fce-46e1-a555-2b2ac852f494",
      locale: "en",
    });
  });

  it("a true partial update — only the fields provided change, everything else is preserved", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "production",
      region: "eu",
      instanceUrl: "https://x",
      workerName: "vf-app-acme",
      d1DatabaseName: "vf-app-poc",
      d1DatabaseId: "old-id",
      locale: "en",
    });
    // Only updating d1DatabaseId, as if the database were recreated.
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "acme-production", { d1DatabaseId: "new-id" });
    expect(result.status).toBe(200);
    const row = await env.CONTROL_DB.prepare(
      "SELECT worker_name, d1_database_name, d1_database_id, locale FROM environments WHERE id = ?"
    )
      .bind("acme-production")
      .first();
    expect(row).toEqual({
      worker_name: "vf-app-acme", // unchanged
      d1_database_name: "vf-app-poc", // unchanged
      d1_database_id: "new-id", // changed
      locale: "en", // unchanged
    });
  });

  it("400s on an empty-string field rather than silently storing it", async () => {
    await seedCustomer();
    await handleCreateEnvironment(env.CONTROL_DB, { customerId: "acme", kind: "production", region: "eu", instanceUrl: "https://x" });
    const result = await handleSetFleetMetadata(env.CONTROL_DB, "acme-production", { workerName: "" });
    expect(result.status).toBe(400);
  });
});
