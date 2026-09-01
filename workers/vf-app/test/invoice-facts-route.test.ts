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

describe("handleUpsertInvoice — duplicate confidence scoring (decision 0028)", () => {
  it("a genuinely brand-new invoice, no candidates on file at all: confidence is 0", async () => {
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-1",
      supplierVatId: "DE111",
      invoiceNumber: "INV-1",
      totalWithVat: 500,
      issueDate: "2026-01-01",
      facts: {},
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBe(0);
  });

  it("no supplier at all: confidence is 0 regardless of how well other fields match — the supplier gate", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-2",
      supplierVatId: "DE222",
      invoiceNumber: "INV-2",
      totalWithVat: 500,
      issueDate: "2026-01-01",
      facts: {},
    });
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-3",
      // no supplierVatId at all
      invoiceNumber: "INV-2",
      totalWithVat: 500,
      issueDate: "2026-01-01",
      facts: {},
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBe(0);
  });

  it("the critical negative case: a different supplier with an identical invoice number, amount, AND date still scores 0 — coincidence across suppliers is not evidence of duplication", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-4",
      supplierVatId: "DE333",
      invoiceNumber: "INV-SAME",
      totalWithVat: 1000,
      issueDate: "2026-02-01",
      facts: {},
    });
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-5",
      supplierVatId: "DE444", // a DIFFERENT supplier
      invoiceNumber: "INV-SAME",
      totalWithVat: 1000,
      issueDate: "2026-02-01",
      facts: {},
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBe(0);
  });

  it("same supplier, exact match on invoice number + amount + date: confidence is 1.0", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-6",
      supplierVatId: "DE555",
      invoiceNumber: "INV-6",
      totalWithVat: 750,
      issueDate: "2026-03-01",
      facts: {},
    });
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-7",
      supplierVatId: "DE555",
      invoiceNumber: "INV-6",
      totalWithVat: 750,
      issueDate: "2026-03-01",
      facts: {},
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBe(1);
  });

  it("same supplier, matching invoice number and amount but a DIFFERENT date: confidence is 0.85 (0.6 + 0.25)", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-8",
      supplierVatId: "DE666",
      invoiceNumber: "INV-8",
      totalWithVat: 200,
      issueDate: "2026-04-01",
      facts: {},
    });
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-9",
      supplierVatId: "DE666",
      invoiceNumber: "INV-8",
      totalWithVat: 200,
      issueDate: "2026-04-15", // different date
      facts: {},
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBeCloseTo(0.85);
  });

  it("same supplier, matching amount and date but a DIFFERENT invoice number: confidence is 0.4 (0.25 + 0.15)", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-10",
      supplierVatId: "DE777",
      invoiceNumber: "INV-10-A",
      totalWithVat: 300,
      issueDate: "2026-05-01",
      facts: {},
    });
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-11",
      supplierVatId: "DE777",
      invoiceNumber: "INV-10-B", // different number
      totalWithVat: 300,
      issueDate: "2026-05-01",
      facts: {},
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBeCloseTo(0.4);
  });

  it("an earlier invoice's own score is never retroactively changed once a later duplicate arrives", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-12",
      supplierVatId: "DE888",
      invoiceNumber: "INV-12",
      totalWithVat: 900,
      issueDate: "2026-06-01",
      facts: {},
    });
    const first = await env.DB.prepare("SELECT duplicate_confidence FROM invoice_headers WHERE id = ?").bind("dup-12").first();
    expect(first).toEqual({ duplicate_confidence: 0 });

    // A near-identical later submission arrives.
    await handleUpsertInvoice(env.DB, {
      id: "dup-13",
      supplierVatId: "DE888",
      invoiceNumber: "INV-12",
      totalWithVat: 900,
      issueDate: "2026-06-01",
      facts: {},
    });

    // dup-12's own stored score must still read 0 — it was submitted
    // first and was never a duplicate of anything at the time.
    const stillFirst = await env.DB.prepare("SELECT duplicate_confidence FROM invoice_headers WHERE id = ?").bind("dup-12").first();
    expect(stillFirst).toEqual({ duplicate_confidence: 0 });
  });

  it("re-upserting the SAME invoice never scores itself as its own duplicate", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-14",
      supplierVatId: "DE999",
      invoiceNumber: "INV-14",
      totalWithVat: 400,
      issueDate: "2026-07-01",
      facts: {},
    });
    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-14", // the SAME id again — a correction, not a new invoice
      supplierVatId: "DE999",
      invoiceNumber: "INV-14",
      totalWithVat: 400,
      issueDate: "2026-07-01",
      facts: { corrected: true },
    });
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBe(0);
  });

  it("takes the MAXIMUM score against any single candidate, not a sum across multiple weak matches", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "dup-15",
      supplierVatId: "DE-max",
      invoiceNumber: "A",
      totalWithVat: 100,
      issueDate: "2026-01-01",
      facts: {},
    }); // matches only on invoice number = 0.6 if compared to dup-17
    await handleUpsertInvoice(env.DB, {
      id: "dup-16",
      supplierVatId: "DE-max",
      invoiceNumber: "B",
      totalWithVat: 200,
      issueDate: "2026-01-02",
      facts: {},
    }); // shares nothing at all with dup-17 below — must contribute 0, not drag the max down or up

    const result = await handleUpsertInvoice(env.DB, {
      id: "dup-17",
      supplierVatId: "DE-max",
      invoiceNumber: "A", // matches dup-15's number only -> 0.6
      totalWithVat: 999,
      issueDate: "2099-01-01",
      facts: {},
    });
    // Best single-candidate match is dup-15 on invoice number alone (0.6) —
    // must not be inflated by also comparing against dup-16.
    expect((result.body as { duplicateConfidence: number }).duplicateConfidence).toBeCloseTo(0.6);
  });
});
