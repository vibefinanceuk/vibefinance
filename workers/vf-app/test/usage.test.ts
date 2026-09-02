import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { computeCurrentPeriodUsage, pushUsage } from "../src/usage.js";

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
    .bind("rs1", "test set", "first_match", "active")
    .run();
});

async function seedInvoiceRun(id: string, outcome: string, createdAt: string, stepCount: number) {
  await env.DB.prepare(
    "INSERT INTO invoice_runs (id, invoice_id, rule_set_id, outcome, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, `inv-${id}`, "rs1", outcome, createdAt)
    .run();
  for (let i = 0; i < stepCount; i++) {
    await env.DB.prepare(
      "INSERT INTO invoice_run_steps (invoice_run_id, seq, rule_id, rule_version, matched) VALUES (?, ?, ?, ?, ?)"
    )
      .bind(id, i, `rule-${i}`, 1, 1)
      .run();
  }
}

describe("computeCurrentPeriodUsage", () => {
  it("counts zero for a period with no invoice runs", async () => {
    const usage = await computeCurrentPeriodUsage(env.DB, new Date("2026-08-15T00:00:00Z"), "acme-production");
    expect(usage).toEqual({
      environmentId: "acme-production",
      periodKey: "2026-08",
      invoicesProcessed: 0,
      rulesEvaluated: 0,
      activeUsers: null,
      outcomeCounts: {},
    });
  });

  it("counts invoices and rule evaluations within the current calendar month only", async () => {
    await seedInvoiceRun("r1", "matched", "2026-08-05T00:00:00Z", 3);
    await seedInvoiceRun("r2", "matched", "2026-08-20T00:00:00Z", 2);
    // Outside the period — must not be counted.
    await seedInvoiceRun("r3", "matched", "2026-07-31T23:59:59Z", 5);
    await seedInvoiceRun("r4", "matched", "2026-09-01T00:00:00Z", 5);

    const usage = await computeCurrentPeriodUsage(env.DB, new Date("2026-08-15T00:00:00Z"), "acme-production");
    expect(usage.invoicesProcessed).toBe(2);
    expect(usage.rulesEvaluated).toBe(5); // 3 + 2, not the excluded runs' 5 + 5
  });

  it("breaks outcomes down by their actual value, not a fixed enum", async () => {
    await seedInvoiceRun("r1", "matched", "2026-08-01T00:00:00Z", 0);
    await seedInvoiceRun("r2", "matched", "2026-08-02T00:00:00Z", 0);
    await seedInvoiceRun("r3", "no_match", "2026-08-03T00:00:00Z", 0);

    const usage = await computeCurrentPeriodUsage(env.DB, new Date("2026-08-15T00:00:00Z"), "acme-production");
    expect(usage.outcomeCounts).toEqual({ matched: 2, no_match: 1 });
  });

  it("always reports activeUsers as null — not yet computable, never fabricated", async () => {
    const usage = await computeCurrentPeriodUsage(env.DB, new Date(), "acme-production");
    expect(usage.activeUsers).toBeNull();
  });
});

describe("pushUsage", () => {
  it("computes the report and passes it to the pusher", async () => {
    await seedInvoiceRun("r1", "matched", "2026-08-05T00:00:00Z", 1);
    const pusher = vi.fn().mockResolvedValue(undefined);

    const report = await pushUsage(env.DB, new Date("2026-08-15T00:00:00Z"), "acme-production", pusher);

    expect(pusher).toHaveBeenCalledTimes(1);
    expect(pusher).toHaveBeenCalledWith(report);
    expect(report.invoicesProcessed).toBe(1);
  });

  it("does not swallow an error from the pusher", async () => {
    const pusher = vi.fn().mockRejectedValue(new Error("network error"));
    await expect(pushUsage(env.DB, new Date(), "acme-production", pusher)).rejects.toThrow("network error");
  });
});
