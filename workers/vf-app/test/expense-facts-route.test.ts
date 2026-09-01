import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUpsertExpenseReport } from "../src/expense-facts-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleUpsertExpenseReport", () => {
  it("400s when id is missing", async () => {
    const result = await handleUpsertExpenseReport(env.DB, {});
    expect(result.status).toBe(400);
  });

  it("400s when receiptAttached is provided but not a boolean", async () => {
    const result = await handleUpsertExpenseReport(env.DB, { id: "exp-1", receiptAttached: "yes" });
    expect(result.status).toBe(400);
  });

  it("creates a real expense report with every structured field, including intakeChannel", async () => {
    const result = await handleUpsertExpenseReport(env.DB, {
      id: "exp-1",
      employeeId: "dana",
      category: "Travel",
      amount: 850,
      currency: "USD",
      submittedDate: "2026-08-15",
      costCentre: "CC-200",
      receiptAttached: false,
      tripEndDate: "2026-08-14",
      intakeChannel: "iPhone App",
      facts: { description: "Flight to conference" },
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare(
      `SELECT employee_id, category, amount, currency, submitted_date, cost_centre,
              receipt_attached, trip_end_date, intake_channel, facts_json
       FROM expense_reports WHERE id = ?`
    )
      .bind("exp-1")
      .first();
    expect(row).toEqual({
      employee_id: "dana",
      category: "Travel",
      amount: 850,
      currency: "USD",
      submitted_date: "2026-08-15",
      cost_centre: "CC-200",
      receipt_attached: 0,
      trip_end_date: "2026-08-14",
      intake_channel: "iPhone App",
      facts_json: JSON.stringify({ description: "Flight to conference" }),
    });
  });

  it("receiptAttached: true is stored as 1, matching stage_visit_steps.matched's own boolean convention", async () => {
    await handleUpsertExpenseReport(env.DB, { id: "exp-2", receiptAttached: true });
    const row = await env.DB.prepare("SELECT receipt_attached FROM expense_reports WHERE id = ?").bind("exp-2").first();
    expect(row).toEqual({ receipt_attached: 1 });
  });

  it("calling again for the same id updates the report, returning 200 not 201", async () => {
    await handleUpsertExpenseReport(env.DB, { id: "exp-3", amount: 100 });
    const result = await handleUpsertExpenseReport(env.DB, { id: "exp-3", amount: 200 });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT amount FROM expense_reports WHERE id = ?").bind("exp-3").first();
    expect(row).toEqual({ amount: 200 });
  });

  it("updated_at changes on a real update, created_at does not", async () => {
    await handleUpsertExpenseReport(env.DB, { id: "exp-4", amount: 100 });
    const first = await env.DB.prepare("SELECT created_at, updated_at FROM expense_reports WHERE id = ?")
      .bind("exp-4")
      .first<{ created_at: string; updated_at: string }>();

    await new Promise((r) => setTimeout(r, 5));
    await handleUpsertExpenseReport(env.DB, { id: "exp-4", amount: 200 });
    const second = await env.DB.prepare("SELECT created_at, updated_at FROM expense_reports WHERE id = ?")
      .bind("exp-4")
      .first<{ created_at: string; updated_at: string }>();

    expect(second.created_at).toBe(first?.created_at);
    expect(second.updated_at).not.toBe(first?.updated_at);
  });
});
