import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSubmitSignupRequest, handleApproveSignupRequest, handleRejectSignupRequest } from "../src/signup-route.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleUpsertLicence } from "../src/licences-route.js";
import {
  handleProvisionTrial,
  expireOverdueLicences,
  warnExpiringLicences,
  TRIAL_PLAN,
  TRIAL_DURATION_DAYS,
} from "../src/provision-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

const REQUEST = {
  companyName: "Northwind Trading",
  contactName: "Dana Reyes",
  contactEmail: "dana@northwind.example",
};

async function approvedRequest(): Promise<string> {
  const submitted = await handleSubmitSignupRequest(env.CONTROL_DB, REQUEST);
  const id = (submitted.body as { id: string }).id;
  await handleApproveSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
  return id;
}

describe("handleProvisionTrial — the control-plane half", () => {
  it("400s without a customerId", async () => {
    const id = await approvedRequest();
    const result = await handleProvisionTrial(env.CONTROL_DB, id, {});
    expect(result.status).toBe(400);
  });

  it("404s a request that doesn't exist", async () => {
    const result = await handleProvisionTrial(env.CONTROL_DB, "no-such-id", { customerId: "northwind" });
    expect(result.status).toBe(404);
  });

  it("409s a request that was never approved", async () => {
    const submitted = await handleSubmitSignupRequest(env.CONTROL_DB, REQUEST);
    const id = (submitted.body as { id: string }).id;
    const result = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    expect(result.status).toBe(409);
  });

  it("409s a rejected request", async () => {
    const submitted = await handleSubmitSignupRequest(env.CONTROL_DB, REQUEST);
    const id = (submitted.body as { id: string }).id;
    await handleRejectSignupRequest(env.CONTROL_DB, id, { decidedBy: "dan" });
    const result = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    expect(result.status).toBe(409);
  });

  it("creates the customer, a sandbox environment, and a trial licence — all three, in real D1", async () => {
    const id = await approvedRequest();
    const result = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    expect(result.status).toBe(201);

    const customer = await env.CONTROL_DB.prepare("SELECT id, name FROM customers WHERE id = ?")
      .bind("northwind")
      .first();
    // The customer's name comes from what the requester actually
    // typed, while the id is the operator's own choice.
    expect(customer).toEqual({ id: "northwind", name: "Northwind Trading" });

    const environment = await env.CONTROL_DB.prepare("SELECT id, customer_id, kind FROM environments WHERE id = ?")
      .bind("northwind-sandbox")
      .first();
    expect(environment).toEqual({ id: "northwind-sandbox", customer_id: "northwind", kind: "sandbox" });

    const licence = await env.CONTROL_DB.prepare("SELECT plan, status FROM licences WHERE environment_id = ?")
      .bind("northwind-sandbox")
      .first();
    expect(licence).toEqual({ plan: TRIAL_PLAN, status: "active" });
  });

  it("sets a real 30-day window, not an open-ended licence", async () => {
    const id = await approvedRequest();
    const now = new Date("2026-09-02T00:00:00.000Z");
    await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" }, now);

    const licence = await env.CONTROL_DB.prepare("SELECT valid_from, valid_to FROM licences WHERE environment_id = ?")
      .bind("northwind-sandbox")
      .first<{ valid_from: string; valid_to: string }>();
    expect(licence?.valid_from).toBe("2026-09-02T00:00:00.000Z");
    expect(licence?.valid_to).toBe("2026-10-02T00:00:00.000Z");

    const days = (new Date(licence!.valid_to).getTime() - new Date(licence!.valid_from).getTime()) / 86_400_000;
    expect(days).toBe(TRIAL_DURATION_DAYS);
  });

  it("returns a real, working API key for the new environment", async () => {
    const id = await approvedRequest();
    const result = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    const apiKey = (result.body as { apiKey: string }).apiKey;
    expect(apiKey).toBeTruthy();

    // Only the hash is stored — never the plaintext.
    const row = await env.CONTROL_DB.prepare("SELECT api_key_hash FROM environments WHERE id = ?")
      .bind("northwind-sandbox")
      .first<{ api_key_hash: string }>();
    expect(row?.api_key_hash).toBeTruthy();
    expect(row?.api_key_hash).not.toBe(apiKey);
  });

  it("links the request to what it produced, closing the loop", async () => {
    const id = await approvedRequest();
    await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });

    const row = await env.CONTROL_DB.prepare(
      "SELECT customer_id, environment_id FROM signup_requests WHERE id = ?"
    )
      .bind(id)
      .first();
    expect(row).toEqual({ customer_id: "northwind", environment_id: "northwind-sandbox" });
  });

  it("is honest that the real infrastructure does not exist yet", async () => {
    const id = await approvedRequest();
    const result = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    expect((result.body as { infrastructureProvisioned: boolean }).infrastructureProvisioned).toBe(false);

    // A fleet tool must read this environment as "not deployable yet"
    // (decision 0011) — which requires these to be genuinely NULL,
    // never guessed-at defaults.
    const row = await env.CONTROL_DB.prepare(
      "SELECT worker_name, d1_database_name, d1_database_id FROM environments WHERE id = ?"
    )
      .bind("northwind-sandbox")
      .first();
    expect(row).toEqual({ worker_name: null, d1_database_name: null, d1_database_id: null });
  });

  it("409s provisioning the same request twice rather than creating a second environment", async () => {
    const id = await approvedRequest();
    await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    const second = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind-again" });
    expect(second.status).toBe(409);

    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM environments").first<{ n: number }>();
    expect(count?.n).toBe(1);
  });

  it("409s a customerId that's already taken, surfacing the real error rather than a generic failure", async () => {
    await handleCreateCustomer(env.CONTROL_DB, { id: "northwind", name: "Someone Else" });
    const id = await approvedRequest();
    const result = await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" });
    expect(result.status).toBe(409);
    // And the request is untouched — still approved, still unprovisioned.
    const row = await env.CONTROL_DB.prepare("SELECT status, customer_id FROM signup_requests WHERE id = ?")
      .bind(id)
      .first();
    expect(row).toEqual({ status: "approved", customer_id: null });
  });
});

describe("expireOverdueLicences — what actually ends a trial", () => {
  async function seedLicence(customerId: string, validTo: string | null, status = "active") {
    await handleCreateCustomer(env.CONTROL_DB, { id: customerId, name: customerId });
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId,
      kind: "sandbox",
      region: "eu",
      instanceUrl: `https://${customerId}.example`,
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: `${customerId}-sandbox`,
      plan: "trial",
      volumeEntitlement: 500,
      validFrom: "2026-09-01T00:00:00.000Z",
      validTo,
      status,
    });
    return `${customerId}-sandbox`;
  }

  it("does nothing when there's nothing overdue", async () => {
    await seedLicence("current", "2026-12-01T00:00:00.000Z");
    const result = await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-01T00:00:00.000Z"));
    expect(result).toEqual({ checked: 0, blocked: [] });
  });

  it("blocks a licence whose valid_to has passed", async () => {
    const envId = await seedLicence("expired", "2026-09-15T00:00:00.000Z");
    const result = await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-01T00:00:00.000Z"));
    expect(result.blocked).toEqual([envId]);

    const row = await env.CONTROL_DB.prepare(
      "SELECT status, status_reason FROM licences WHERE environment_id = ?"
    )
      .bind(envId)
      .first();
    expect(row).toEqual({ status: "blocked", status_reason: "expired" });
  });

  it("never touches a licence with no valid_to at all — an open-ended licence never expires", async () => {
    const envId = await seedLicence("perpetual", null);
    const result = await expireOverdueLicences(env.CONTROL_DB, new Date("2030-01-01T00:00:00.000Z"));
    expect(result.blocked).toEqual([]);

    const row = await env.CONTROL_DB.prepare("SELECT status FROM licences WHERE environment_id = ?")
      .bind(envId)
      .first();
    expect(row).toEqual({ status: "active" });

    // Honest note, found by deliberately removing the `valid_to IS
    // NOT NULL` clause and watching this test still pass: SQL's own
    // three-valued logic already excludes these rows, because
    // `NULL <= '2030-01-01'` is NULL, not true. The explicit clause
    // is defensive, not load-bearing, and this test verifies the
    // *behaviour* (open-ended licences survive) rather than claiming
    // to verify that one clause. Kept because the behaviour genuinely
    // matters — a perpetual licence must never be swept — not because
    // it pins the implementation.
  });

  it("is idempotent — a second sweep finds nothing left to do", async () => {
    await seedLicence("expired", "2026-09-15T00:00:00.000Z");
    const now = new Date("2026-10-01T00:00:00.000Z");
    const first = await expireOverdueLicences(env.CONTROL_DB, now);
    expect(first.checked).toBe(1);
    const second = await expireOverdueLicences(env.CONTROL_DB, now);
    expect(second).toEqual({ checked: 0, blocked: [] });
  });

  it("blocks only what's overdue, leaving current licences alone", async () => {
    const expiredId = await seedLicence("expired", "2026-09-15T00:00:00.000Z");
    await seedLicence("current", "2026-12-01T00:00:00.000Z");
    const result = await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-01T00:00:00.000Z"));
    expect(result.blocked).toEqual([expiredId]);

    const current = await env.CONTROL_DB.prepare("SELECT status FROM licences WHERE environment_id = ?")
      .bind("current-sandbox")
      .first();
    expect(current).toEqual({ status: "active" });
  });

  it("expires a licence exactly at its valid_to, not a moment later", async () => {
    const envId = await seedLicence("boundary", "2026-10-01T00:00:00.000Z");
    const result = await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-01T00:00:00.000Z"));
    expect(result.blocked).toEqual([envId]);
  });

  it("the real end-to-end shape: a provisioned trial is active on day 1 and blocked on day 31", async () => {
    const id = await approvedRequest();
    const start = new Date("2026-09-02T00:00:00.000Z");
    await handleProvisionTrial(env.CONTROL_DB, id, { customerId: "northwind" }, start);

    // Day 1: nothing expires.
    const dayOne = await expireOverdueLicences(env.CONTROL_DB, new Date("2026-09-03T00:00:00.000Z"));
    expect(dayOne.blocked).toEqual([]);

    // Day 31: the trial is over.
    const dayThirtyOne = await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-03T00:00:00.000Z"));
    expect(dayThirtyOne.blocked).toEqual(["northwind-sandbox"]);

    // And the sandbox itself survives — blocking is read-only, not
    // lights-out (decision 0003). The environment and its config are
    // still there; only the licence status changed.
    const environment = await env.CONTROL_DB.prepare("SELECT id FROM environments WHERE id = ?")
      .bind("northwind-sandbox")
      .first();
    expect(environment).toEqual({ id: "northwind-sandbox" });
  });
});

describe("warnExpiringLicences — the notice stages before restriction", () => {
  async function seedTrial(customerId: string, validTo: string | null) {
    await handleCreateCustomer(env.CONTROL_DB, { id: customerId, name: customerId });
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId,
      kind: "sandbox",
      region: "eu",
      instanceUrl: `https://${customerId}.example`,
    });
    await handleUpsertLicence(env.CONTROL_DB, {
      environmentId: `${customerId}-sandbox`,
      plan: "trial",
      volumeEntitlement: 500,
      validFrom: "2026-09-01T00:00:00.000Z",
      validTo,
    });
    return `${customerId}-sandbox`;
  }

  async function licenceRow(environmentId: string) {
    return env.CONTROL_DB.prepare(
      "SELECT status, status_reason, status_effective_at, warned_at_days FROM licences WHERE environment_id = ?"
    )
      .bind(environmentId)
      .first<{ status: string; status_reason: string | null; status_effective_at: string | null; warned_at_days: number | null }>();
  }

  it("does nothing to a licence still far from expiry", async () => {
    const id = await seedTrial("faraway", "2026-12-01T00:00:00.000Z");
    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-02T00:00:00.000Z"));
    expect(result.warned).toEqual([]);
    expect((await licenceRow(id))?.status).toBe("active");
  });

  it("warns at the 14-day threshold, recording a real, human-readable reason and the actual expiry date", async () => {
    const id = await seedTrial("northwind", "2026-10-01T00:00:00.000Z");
    // 13 days out — inside 14, outside 7.
    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-18T00:00:00.000Z"));
    expect(result.warned).toEqual([{ environmentId: id, thresholdDays: 14 }]);

    const row = await licenceRow(id);
    expect(row?.status).toBe("warned");
    expect(row?.status_reason).toBe("expires in 14 days");
    expect(row?.status_effective_at).toBe("2026-10-01T00:00:00.000Z");
    expect(row?.warned_at_days).toBe(14);
  });

  it("escalates through 14 -> 7 -> 1 as expiry approaches", async () => {
    const id = await seedTrial("northwind", "2026-10-01T00:00:00.000Z");

    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-18T00:00:00.000Z"));
    expect((await licenceRow(id))?.warned_at_days).toBe(14);

    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-26T00:00:00.000Z"));
    expect((await licenceRow(id))?.warned_at_days).toBe(7);

    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-30T12:00:00.000Z"));
    const final = await licenceRow(id);
    expect(final?.warned_at_days).toBe(1);
    expect(final?.status_reason).toBe("expires in 1 day"); // singular, not "1 days"
  });

  it("never fires the same threshold twice — the property a future email sender depends on", async () => {
    const id = await seedTrial("northwind", "2026-10-01T00:00:00.000Z");
    const now = new Date("2026-09-18T00:00:00.000Z");

    const first = await warnExpiringLicences(env.CONTROL_DB, now);
    expect(first.warned).toHaveLength(1);

    // The hourly sweep runs again, and again, and again.
    const second = await warnExpiringLicences(env.CONTROL_DB, now);
    const third = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-19T00:00:00.000Z"));
    expect(second.warned).toEqual([]);
    expect(third.warned).toEqual([]);
    expect((await licenceRow(id))?.warned_at_days).toBe(14);
  });

  it("never walks a warning backwards — a 1-day warning is not undone by a later 14-day check", async () => {
    const id = await seedTrial("northwind", "2026-10-01T00:00:00.000Z");
    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-30T12:00:00.000Z"));
    expect((await licenceRow(id))?.warned_at_days).toBe(1);

    // A sweep with a wider threshold set must not regress it.
    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-30T13:00:00.000Z"), [14, 7, 1]);
    expect((await licenceRow(id))?.warned_at_days).toBe(1);
  });

  it("jumps straight to the most urgent threshold when several are crossed at once — a missed sweep never softens the notice", async () => {
    const id = await seedTrial("northwind", "2026-10-01T00:00:00.000Z");
    // Nothing ran for weeks; now only hours remain.
    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-30T18:00:00.000Z"));
    expect(result.warned).toEqual([{ environmentId: id, thresholdDays: 1 }]);
    expect((await licenceRow(id))?.status_reason).toBe("expires in 1 day");
  });

  it("never warns an open-ended licence — there is nothing to warn about", async () => {
    const id = await seedTrial("perpetual", null);
    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2030-01-01T00:00:00.000Z"));
    expect(result.warned).toEqual([]);
    expect((await licenceRow(id))?.status).toBe("active");
  });

  it("never warns an already-blocked licence", async () => {
    const id = await seedTrial("blocked", "2026-10-01T00:00:00.000Z");
    await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-02T00:00:00.000Z"));
    expect((await licenceRow(id))?.status).toBe("blocked");

    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-10-02T00:00:00.000Z"));
    expect(result.warned).toEqual([]);
    expect((await licenceRow(id))?.status).toBe("blocked");
  });

  it("never warns about an expiry that has already passed", async () => {
    const id = await seedTrial("overdue", "2026-09-15T00:00:00.000Z");
    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-10-01T00:00:00.000Z"));
    expect(result.warned).toEqual([]);
    expect((await licenceRow(id))?.status).toBe("active"); // untouched; the expiry sweep's job, not this one's
  });

  it("respects a custom threshold set rather than hardcoding 14/7/1", async () => {
    const id = await seedTrial("custom", "2026-10-01T00:00:00.000Z");
    const result = await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-04T00:00:00.000Z"), [30]);
    expect(result.warned).toEqual([{ environmentId: id, thresholdDays: 30 }]);
  });

  it("the real sequence: warned before expiry, blocked at it — the Blueprint's own staging", async () => {
    const id = await seedTrial("northwind", "2026-10-01T00:00:00.000Z");

    // Notice.
    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-18T00:00:00.000Z"));
    expect((await licenceRow(id))?.status).toBe("warned");

    // Notice with a date, more urgently.
    await warnExpiringLicences(env.CONTROL_DB, new Date("2026-09-30T12:00:00.000Z"));
    const warned = await licenceRow(id);
    expect(warned?.status_reason).toBe("expires in 1 day");
    expect(warned?.status_effective_at).toBe("2026-10-01T00:00:00.000Z");

    // Restriction.
    await expireOverdueLicences(env.CONTROL_DB, new Date("2026-10-01T00:00:00.000Z"));
    const blocked = await licenceRow(id);
    expect(blocked?.status).toBe("blocked");
    expect(blocked?.status_reason).toBe("expired");
  });
});
