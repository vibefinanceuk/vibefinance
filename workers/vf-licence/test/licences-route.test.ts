import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleUpsertLicence } from "../src/licences-route.js";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, {
    id: "acme",
    name: "Acme Corp",
    region: "eu",
    instanceUrl: "https://vf-app.acme.workers.dev",
  });
});

describe("handleUpsertLicence", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, { customerId: "acme" });
    expect(result.status).toBe(400);
  });

  it("404s when the customer does not exist", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, {
      customerId: "does-not-exist",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
    });
    expect(result.status).toBe(404);
  });

  it("creates a licence with sensible defaults for optional fields", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, {
      customerId: "acme",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
    });
    expect(result.status).toBe(200);

    const row = await env.CONTROL_DB.prepare(
      "SELECT plan, features_json, status, valid_to FROM licences WHERE customer_id = ?"
    )
      .bind("acme")
      .first();
    expect(row).toEqual({
      plan: "standard",
      features_json: "[]",
      status: "active",
      valid_to: null,
    });
  });

  it("upserts — a second call for the same customer replaces the licence rather than duplicating it", async () => {
    await handleUpsertLicence(env.CONTROL_DB, {
      customerId: "acme",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      customerId: "acme",
      plan: "premium",
      volumeEntitlement: 5000,
      validFrom: "2026-02-01",
      features: ["rules_ai_compiler"],
    });

    const count = await env.CONTROL_DB.prepare(
      "SELECT count(*) AS n FROM licences WHERE customer_id = ?"
    )
      .bind("acme")
      .first();
    expect(count).toEqual({ n: 1 });

    const row = await env.CONTROL_DB.prepare(
      "SELECT plan, volume_entitlement, features_json FROM licences WHERE customer_id = ?"
    )
      .bind("acme")
      .first();
    expect(row).toEqual({
      plan: "premium",
      volume_entitlement: 5000,
      features_json: '["rules_ai_compiler"]',
    });
  });

  it("rejects an invalid status value rather than storing it, falling back to 'active'", async () => {
    const result = await handleUpsertLicence(env.CONTROL_DB, {
      customerId: "acme",
      plan: "standard",
      volumeEntitlement: 1000,
      validFrom: "2026-01-01",
      status: "super_active",
    });
    expect(result.status).toBe(200);
    const row = await env.CONTROL_DB.prepare("SELECT status FROM licences WHERE customer_id = ?")
      .bind("acme")
      .first();
    expect(row).toEqual({ status: "active" });
  });
});
