import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUpsertInvoice } from "../src/invoice-facts-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleUpsertInvoice", () => {
  it("400s when id is missing", async () => {
    const result = await handleUpsertInvoice(env.DB, {});
    expect(result.status).toBe(400);
  });

  it("creates a header with no lines", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "inv-1",
      supplierVatId: "DE123456789",
      currency: "EUR",
      totalWithVat: 1200,
      facts: { "BT-112": 1200 },
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare(
      "SELECT supplier_vat_id, currency, total_with_vat, facts_json FROM invoice_headers WHERE id = ?"
    )
      .bind("inv-1")
      .first();
    expect(row).toEqual({
      supplier_vat_id: "DE123456789",
      currency: "EUR",
      total_with_vat: 1200,
      facts_json: JSON.stringify({ "BT-112": 1200 }),
    });
  });

  it("creates a header with real lines", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "inv-1",
      facts: {},
      lines: [
        { lineNumber: 1, description: "Widgets", amount: 500, costCentre: "CC-100" },
        { lineNumber: 2, description: "Gadgets", amount: 700, costCentre: "CC-200" },
      ],
    });
    expect(result.status).toBe(201);
    expect((result.body as { lineCount: number }).lineCount).toBe(2);
    const rows = await env.DB.prepare(
      "SELECT line_number, description, amount, cost_centre FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number"
    )
      .bind("inv-1")
      .all();
    expect(rows.results).toEqual([
      { line_number: 1, description: "Widgets", amount: 500, cost_centre: "CC-100" },
      { line_number: 2, description: "Gadgets", amount: 700, cost_centre: "CC-200" },
    ]);
  });

  it("422s duplicate line numbers within one invoice, storing nothing", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "inv-1",
      facts: {},
      lines: [
        { lineNumber: 1, amount: 100 },
        { lineNumber: 1, amount: 200 },
      ],
    });
    expect(result.status).toBe(422);
    const headerRow = await env.DB.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind("inv-1").first();
    expect(headerRow).toBeNull();
  });

  it("422s a line missing a numeric lineNumber", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "inv-1",
      facts: {},
      lines: [{ amount: 100 }],
    });
    expect(result.status).toBe(422);
  });

  it("calling again for the same id updates the header, returning 200 not 201", async () => {
    await handleUpsertInvoice(env.DB, { id: "inv-1", currency: "EUR", facts: {} });
    const result = await handleUpsertInvoice(env.DB, { id: "inv-1", currency: "USD", facts: {} });
    expect(result.status).toBe(200);
    const row = await env.DB.prepare("SELECT currency FROM invoice_headers WHERE id = ?").bind("inv-1").first();
    expect(row).toEqual({ currency: "USD" });
  });

  it("the critical property: calling again fully replaces the line set, never a partial merge", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "inv-1",
      facts: {},
      lines: [
        { lineNumber: 1, amount: 100 },
        { lineNumber: 2, amount: 200 },
      ],
    });
    // Second call has only ONE line — line 2 must be gone afterward,
    // not left behind from the first call.
    await handleUpsertInvoice(env.DB, {
      id: "inv-1",
      facts: {},
      lines: [{ lineNumber: 1, amount: 999 }],
    });
    const rows = await env.DB.prepare("SELECT line_number, amount FROM invoice_lines WHERE invoice_id = ?")
      .bind("inv-1")
      .all();
    expect(rows.results).toEqual([{ line_number: 1, amount: 999 }]);
  });

  it("updated_at changes on a real update, created_at does not", async () => {
    await handleUpsertInvoice(env.DB, { id: "inv-1", currency: "EUR", facts: {} });
    const first = await env.DB.prepare("SELECT created_at, updated_at FROM invoice_headers WHERE id = ?")
      .bind("inv-1")
      .first<{ created_at: string; updated_at: string }>();

    await new Promise((r) => setTimeout(r, 5));
    await handleUpsertInvoice(env.DB, { id: "inv-1", currency: "USD", facts: {} });
    const second = await env.DB.prepare("SELECT created_at, updated_at FROM invoice_headers WHERE id = ?")
      .bind("inv-1")
      .first<{ created_at: string; updated_at: string }>();

    expect(second.created_at).toBe(first?.created_at);
    expect(second.updated_at).not.toBe(first?.updated_at);
  });

  it("promotes mandateChannel to a real, queryable column — not buried in facts_json", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "inv-2",
      facts: { "BT-3": "380" },
      mandateChannel: "Email",
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT mandate_channel FROM invoice_headers WHERE id = ?").bind("inv-2").first();
    expect(row).toEqual({ mandate_channel: "Email" });
  });
});
