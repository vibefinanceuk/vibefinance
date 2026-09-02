import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleUpsertLicence } from "../src/licences-route.js";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme Corp" });
  await handleCreateEnvironment(env.CONTROL_DB, {
    customerId: "acme",
    kind: "production",
    region: "eu",
    instanceUrl: "https://vf-app.acme.workers.dev",
  });
});

describe("handleUpsertLicence — re-keyed to environmentId (decision 0036)", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, { environmentId: "acme-production" });
    expect(result.status).toBe(400);
  });

  it("404s when the environment does not exist", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "does-not-exist",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
    });
    expect(result.status).toBe(404);
  });

  it("creates a licence with sensible defaults for optional fields", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
    });
    expect(result.status).toBe(200);

    const row = await env.CONTROL_DB.prepare(
      "SELECT plan, features_json, status, valid_to FROM licences WHERE environment_id = ?"
    )
      .bind("acme-production")
      .first();
    expect(row).toEqual({
      plan: "standard",
      features_json: "[]",
      status: "active",
      valid_to: null,
    });
  });

  it("upserts — a second call for the same environment replaces the licence rather than duplicating it", async () => {
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "premium",
      volumeEntitlement: 5000,
      validFrom: "2026-02-01",
      features: ["rules_ai_compiler"],
    });

    const count = await env.CONTROL_DB.prepare(
      "SELECT count(*) AS n FROM licences WHERE environment_id = ?"
    )
      .bind("acme-production")
      .first();
    expect(count).toEqual({ n: 1 });

    const row = await env.CONTROL_DB.prepare(
      "SELECT plan, volume_entitlement, features_json FROM licences WHERE environment_id = ?"
    )
      .bind("acme-production")
      .first();
    expect(row).toEqual({
      plan: "premium",
      volume_entitlement: 5000,
      features_json: '["rules_ai_compiler"]',
    });
  });

  it("rejects an invalid status value rather than storing it, falling back to 'active'", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
      status: "super_active",
    });
    expect(result.status).toBe(200);
    const row = await env.CONTROL_DB.prepare("SELECT status FROM licences WHERE environment_id = ?")
      .bind("acme-production")
      .first();
    expect(row).toEqual({ status: "active" });
  });

  it("a customer's sandbox and production environments can each have their own, genuinely separate licence", async () => {
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://sandbox.acme.workers.dev",
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-production",
      plan: "premium",
      volumeEntitlement: 10000,
      validFrom: "2026-01-01",
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: "acme-sandbox",
      plan: "trial",
      volumeEntitlement: 100,
      validFrom: "2026-01-01",
      validTo: "2026-01-31",
    });

    const prodRow = await env.CONTROL_DB.prepare("SELECT plan, volume_entitlement FROM licences WHERE environment_id = ?")
      .bind("acme-production")
      .first();
    expect(prodRow).toEqual({ plan: "premium", volume_entitlement: 10000 });

    const sandboxRow = await env.CONTROL_DB.prepare("SELECT plan, volume_entitlement, valid_to FROM licences WHERE environment_id = ?")
      .bind("acme-sandbox")
      .first();
    expect(sandboxRow).toEqual({ plan: "trial", volume_entitlement: 100, valid_to: "2026-01-31" });
  });
});
