import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUpsertInvoice } from "../src/invoice-facts-route.js";
import { findSimilarInvoices, getSupplierHistory, getMonthlyTotals } from "../src/invoice-history.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("findSimilarInvoices", () => {
  it("finds every other invoice from the same supplier, excluding the given id", async () => {
    await handleUpsertInvoice(env.DB, { id: "h-1", supplierVatId: "DE-hist", invoiceNumber: "A", facts: {} });
    await handleUpsertInvoice(env.DB, { id: "h-2", supplierVatId: "DE-hist", invoiceNumber: "B", facts: {} });
    await handleUpsertInvoice(env.DB, { id: "h-3", supplierVatId: "DE-other", invoiceNumber: "C", facts: {} });

    const results = await findSimilarInvoices(env.DB, { excludeId: "h-1", supplierVatId: "DE-hist" });
    expect(results.map((r) => r.id)).toEqual(["h-2"]); // h-3 excluded (different supplier), h-1 excluded (the given id itself)
  });

  it("returns an empty array when there are no other invoices from this supplier", async () => {
    await handleUpsertInvoice(env.DB, { id: "h-4", supplierVatId: "DE-alone", invoiceNumber: "X", facts: {} });
    const results = await findSimilarInvoices(env.DB, { excludeId: "h-4", supplierVatId: "DE-alone" });
    expect(results).toEqual([]);
  });
});

describe("getSupplierHistory", () => {
  it("returns this supplier's own invoices, most recent first, and nothing from other suppliers", async () => {
    await handleUpsertInvoice(env.DB, { id: "sh-1", supplierVatId: "DE-sh", invoiceNumber: "S1", totalWithVat: 100, facts: {} });
    await new Promise((r) => setTimeout(r, 5));
    await handleUpsertInvoice(env.DB, { id: "sh-2", supplierVatId: "DE-sh", invoiceNumber: "S2", totalWithVat: 200, facts: {} });
    await handleUpsertInvoice(env.DB, { id: "sh-3", supplierVatId: "DE-different", invoiceNumber: "S3", facts: {} });

    const history = await getSupplierHistory(env.DB, "DE-sh");
    expect(history.map((h) => h.id)).toEqual(["sh-2", "sh-1"]); // most recently created first
  });

  it("respects the limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await handleUpsertInvoice(env.DB, { id: `lim-${i}`, supplierVatId: "DE-limit", invoiceNumber: `N${i}`, facts: {} });
    }
    const history = await getSupplierHistory(env.DB, "DE-limit", 3);
    expect(history).toHaveLength(3);
  });

  it("includes mandateChannel and duplicateConfidence — real fields an operator reviewing history would want", async () => {
    await handleUpsertInvoice(env.DB, {
      id: "sh-4",
      supplierVatId: "DE-fields",
      invoiceNumber: "F1",
      mandateChannel: "Email",
      facts: {},
    });
    const history = await getSupplierHistory(env.DB, "DE-fields");
    expect(history[0].mandateChannel).toBe("Email");
    expect(history[0].duplicateConfidence).toBe(0);
  });
});

describe("getMonthlyTotals", () => {
  it("aggregates totals and counts correctly by month, across suppliers when unfiltered", async () => {
    await handleUpsertInvoice(env.DB, { id: "mt-1", supplierVatId: "DE-a", totalWithVat: 100, issueDate: "2026-01-15", facts: {} });
    await handleUpsertInvoice(env.DB, { id: "mt-2", supplierVatId: "DE-b", totalWithVat: 200, issueDate: "2026-01-20", facts: {} });
    await handleUpsertInvoice(env.DB, { id: "mt-3", supplierVatId: "DE-a", totalWithVat: 300, issueDate: "2026-02-01", facts: {} });

    const totals = await getMonthlyTotals(env.DB);
    expect(totals).toEqual([
      { month: "2026-01", totalAmount: 300, invoiceCount: 2 },
      { month: "2026-02", totalAmount: 300, invoiceCount: 1 },
    ]);
  });

  it("filters correctly to a single supplier when supplierVatId is given", async () => {
    await handleUpsertInvoice(env.DB, { id: "mt-4", supplierVatId: "DE-filter", totalWithVat: 500, issueDate: "2026-03-01", facts: {} });
    await handleUpsertInvoice(env.DB, { id: "mt-5", supplierVatId: "DE-other-2", totalWithVat: 999, issueDate: "2026-03-01", facts: {} });

    const totals = await getMonthlyTotals(env.DB, { supplierVatId: "DE-filter" });
    expect(totals).toEqual([{ month: "2026-03", totalAmount: 500, invoiceCount: 1 }]);
  });

  it("excludes invoices with no issue_date at all — a real, honest limitation, not a silent one", async () => {
    await handleUpsertInvoice(env.DB, { id: "mt-6", supplierVatId: "DE-nodate", totalWithVat: 1000, facts: {} }); // no issueDate
    const totals = await getMonthlyTotals(env.DB);
    expect(totals).toEqual([]);
  });

  it("returns an empty array, not an error, when there is genuinely no data at all", async () => {
    const totals = await getMonthlyTotals(env.DB);
    expect(totals).toEqual([]);
  });
});

describe("getMonthlyTotals — a real NULL-total edge case", () => {
  it("an invoice with a real issue_date but no total_with_vat still contributes a real 0, not NULL, to that month's total", async () => {
    const { handleUpsertInvoice } = await import("../src/invoice-facts-route.js");
    await handleUpsertInvoice(env.DB, { id: "mt-null", supplierVatId: "DE-null-total", issueDate: "2026-04-01", facts: {} }); // no totalWithVat at all
    const totals = await getMonthlyTotals(env.DB);
    expect(totals).toEqual([{ month: "2026-04", totalAmount: 0, invoiceCount: 1 }]);
  });
});
