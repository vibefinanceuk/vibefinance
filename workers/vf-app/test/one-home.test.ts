import { env } from "cloudflare:test";
import { beforeEach, describe, it, expect } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUpsertInvoice } from "../src/invoice-facts-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

/**
 * **One home per value — decision 0681.** The Peppol BIS 3.0 Business
 * Terms in facts_json are where a value lives; the header and line
 * columns of the same values are generated from them (migration 0148).
 */
describe("one home per value (decision 0681)", () => {
  it("fills the header columns from the facts alone, as an embedded-XML capture sends them", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "inv-fx",
      facts: { "BT-1": " FX-1 ", "BT-2": "2026-10-01", "BT-5": "EUR", "BT-31": "DE123", "BT-112": "1190.00" },
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT invoice_number, issue_date, currency, supplier_vat_id, total_with_vat FROM invoice_headers WHERE id = 'inv-fx'").first();
    expect(row).toEqual({ invoice_number: "FX-1", issue_date: "2026-10-01", currency: "EUR", supplier_vat_id: "DE123", total_with_vat: 1190 });
  });

  it("changes a column when its Business Term changes, and nothing else can", async () => {
    await handleUpsertInvoice(env.DB, { id: "inv-ch", facts: { "BT-5": "GBP", "BT-112": 10 } });
    await env.DB.prepare("UPDATE invoice_headers SET facts_json = json_set(facts_json, '$.BT-5', 'EUR') WHERE id = 'inv-ch'").run();
    expect((await env.DB.prepare("SELECT currency FROM invoice_headers WHERE id = 'inv-ch'").first<{ currency: string }>())?.currency).toBe("EUR");
    await expect(env.DB.prepare("UPDATE invoice_headers SET currency = 'USD' WHERE id = 'inv-ch'").run()).rejects.toThrow();
  });

  it("takes the line columns from BT-153 (else BT-154), BT-131 and BT-133", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "inv-ln",
      facts: {},
      lines: [
        { lineNumber: 1, facts: { "BT-153": "Courier", "BT-154": "Same-day", "BT-131": 75, "BT-133": "CC1" } },
        { lineNumber: 2, facts: { "BT-154": "Only a description", "BT-131": "12.50" } },
        { lineNumber: 3, facts: { "BT-131": "not a number" } },
      ],
    });
    const rows = await env.DB.prepare("SELECT line_number, description, amount, cost_centre FROM invoice_lines WHERE invoice_id = 'inv-ln' ORDER BY line_number").all();
    expect(rows.results).toEqual([
      { line_number: 1, description: "Courier", amount: 75, cost_centre: "CC1" },
      { line_number: 2, description: "Only a description", amount: 12.5, cost_centre: null },
      { line_number: 3, description: null, amount: null, cost_centre: null },
    ]);
  });

  it("still accepts the old top-level fields, writing them into the Business Terms", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "inv-old",
      invoiceNumber: "A-1",
      totalWithVat: 50,
      facts: { "BT-5": "GBP" },
      lines: [{ lineNumber: 1, description: "Widgets", amount: 50, costCentre: "CC9" }],
    });
    const header = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-old'").first<{ facts_json: string }>();
    expect(JSON.parse(header!.facts_json)).toEqual({ "BT-5": "GBP", "BT-1": "A-1", "BT-112": 50 });
    const line = await env.DB.prepare("SELECT facts_json FROM invoice_lines WHERE invoice_id = 'inv-old'").first<{ facts_json: string }>();
    expect(JSON.parse(line!.facts_json)).toEqual({ "BT-153": "Widgets", "BT-131": 50, "BT-133": "CC9" });
  });

  it("refuses a write to a generated column", async () => {
    await expect(
      env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, currency) VALUES ('inv-x', '{}', 'GBP')").run()
    ).rejects.toThrow();
  });
});
