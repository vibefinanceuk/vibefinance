import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { handleCreateEnvironment } from "../src/environment-route.js";
import { handleReportUsage } from "../src/usage-route.js";

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

describe("handleReportUsage — validation, re-keyed to environmentId (decision 0036)", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleReportUsage(env.CONTROL_DB, { environmentId: "acme-production" });
    expect(result.status).toBe(400);
  });

  it("400s on a negative count rather than storing it", async () => {
    const result = await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: -1,
      rulesEvaluated: 0,
    });
    expect(result.status).toBe(400);
    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM usage_periods").first();
    expect(count).toEqual({ n: 0 });
  });

  it("404s when the environment does not exist", async () => {
    const result = await handleReportUsage(env.CONTROL_DB, {
      environmentId: "does-not-exist",
      periodKey: "2026-08",
      invoicesProcessed: 5,
      rulesEvaluated: 12,
    });
    expect(result.status).toBe(404);
  });
});

describe("handleReportUsage — recording", () => {
  it("records a usage report", async () => {
    const result = await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 5,
      rulesEvaluated: 12,
      outcomeCounts: { matched: 4, no_match: 1 },
    });
    expect(result.status).toBe(200);

    const row = await env.CONTROL_DB.prepare(
      "SELECT invoices_processed, rules_evaluated, active_users, outcome_counts_json FROM usage_periods WHERE environment_id = ? AND period_key = ?"
    )
      .bind("acme-production", "2026-08")
      .first();
    expect(row).toEqual({
      invoices_processed: 5,
      rules_evaluated: 12,
      active_users: null,
      outcome_counts_json: '{"matched":4,"no_match":1}',
    });
  });

  it("is idempotent — a second push for the same period overwrites rather than duplicates", async () => {
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 5,
      rulesEvaluated: 12,
    });
    // A later push with fresher (higher) numbers for the SAME period —
    // simulating a more-frequent or on-demand push mid-month.
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 9,
      rulesEvaluated: 20,
    });

    const count = await env.CONTROL_DB.prepare(
      "SELECT count(*) AS n FROM usage_periods WHERE environment_id = ? AND period_key = ?"
    )
      .bind("acme-production", "2026-08")
      .first();
    expect(count).toEqual({ n: 1 });

    const row = await env.CONTROL_DB.prepare(
      "SELECT invoices_processed, rules_evaluated FROM usage_periods WHERE environment_id = ? AND period_key = ?"
    )
      .bind("acme-production", "2026-08")
      .first();
    expect(row).toEqual({ invoices_processed: 9, rules_evaluated: 20 });
  });

  it("keeps separate rows for different periods of the same environment", async () => {
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-07",
      invoicesProcessed: 3,
      rulesEvaluated: 6,
    });
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 5,
      rulesEvaluated: 12,
    });

    const count = await env.CONTROL_DB.prepare(
      "SELECT count(*) AS n FROM usage_periods WHERE environment_id = ?"
    )
      .bind("acme-production")
      .first();
    expect(count).toEqual({ n: 2 });
  });

  it("stores activeUsers as null when not provided, never fabricated", async () => {
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 5,
      rulesEvaluated: 12,
    });
    const row = await env.CONTROL_DB.prepare(
      "SELECT active_users FROM usage_periods WHERE environment_id = ? AND period_key = ?"
    )
      .bind("acme-production", "2026-08")
      .first();
    expect(row).toEqual({ active_users: null });
  });

  it("keeps a customer's sandbox and production usage in genuinely separate rows — the real reason this was re-keyed", async () => {
    await handleCreateEnvironment(env.CONTROL_DB, {
      customerId: "acme",
      kind: "sandbox",
      region: "eu",
      instanceUrl: "https://sandbox.acme.workers.dev",
    });
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-sandbox",
      periodKey: "2026-08",
      invoicesProcessed: 999, // heavy sandbox testing activity
      rulesEvaluated: 500,
    });
    await handleReportUsage(env.CONTROL_DB, {
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 5, // genuine production volume
      rulesEvaluated: 12,
    });

    const prodRow = await env.CONTROL_DB.prepare(
      "SELECT invoices_processed FROM usage_periods WHERE environment_id = ? AND period_key = ?"
    )
      .bind("acme-production", "2026-08")
      .first<{ invoices_processed: number }>();
    // The real property this decision exists to guarantee: sandbox
    // testing volume never inflates what a future consumption-based
    // bill would compute from production's own real usage.
    expect(prodRow?.invoices_processed).toBe(5);
  });
});
