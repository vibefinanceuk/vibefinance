import { describe, expect, it } from "vitest";
import { applyOutboundMapping, listsInOutbound, validateOutboundMapping, type OutboundMapping, type VfInvoice } from "./outbound-mapping.js";
import { BC_LISTS, BC_TOKEN_SCOPE, dynamics365BcMapping } from "./dynamics-365-bc.js";
import { STANDARD_CONNECTORS, connectorById } from "./library.js";
import { applyChain } from "../ingestion/mapping-functions.js";

/** **Microsoft Dynamics 365 Business Central — decision 0609.** */

const INVOICE: VfInvoice = {
  schema: "vibefinance.invoice.v1",
  id: "inv-1",
  invoiceNumber: "INV-2231",
  issueDate: "2026-09-29",
  dueDate: "2026-10-29",
  currency: "GBP",
  company: "acme-uk",
  supplier: { erpId: "20000", site: null, name: "First Up Consultants", vatId: null },
  purchaseOrder: null,
  totals: { net: 300, vat: 60, total: 360 },
  sentOn: "2026-10-02",
  lines: [
    {
      lineNumber: 1,
      description: "Consultancy, September",
      quantity: 10,
      unit: "HUR",
      poLine: null,
      vatCategory: "S",
      vatRate: 20,
      netAmount: 200,
      distributions: [
        { splitRow: 1, netAmount: 120, costCentre: "SALES", project: null, commodityCode: null, glCode: "8410" },
        { splitRow: 2, netAmount: 80, costCentre: null, project: "PRJ-9", commodityCode: null, glCode: "8410" },
      ],
    },
    { lineNumber: 2, description: "Travel", quantity: 1, unit: null, poLine: null, vatCategory: "Z", vatRate: 0, netAmount: 100, distributions: [{ splitRow: null, netAmount: 100, costCentre: null, project: null, commodityCode: null, glCode: "8420" }] },
  ],
};

describe("present_as, empty_if, and a place left empty — decision 0609", () => {
  it("gives a fixed text only where there is a value, empties a value that matches, and drops a place left empty", () => {
    expect(applyChain([{ fn: "present_as", args: { value: "DEPARTMENT" } }], "SALES")).toEqual({ ok: true, value: "DEPARTMENT" });
    expect(applyChain([{ fn: "present_as", args: { value: "DEPARTMENT" } }], " ")).toEqual({ ok: true, value: null });
    expect(applyChain([{ fn: "empty_if", args: { value: "GBP" } }], "gbp")).toEqual({ ok: true, value: null });
    expect(applyChain([{ fn: "empty_if", args: { value: "GBP" } }], "EUR")).toEqual({ ok: true, value: "EUR" });
    const m: OutboundMapping = {
      format: "json",
      invoice: [
        { target: "d.0.code", source: "purchaseOrder", fx: [{ fn: "present_as", args: { value: "PO" } }] },
        { target: "d.1.code", source: "currency", fx: [] },
        { target: "e.0.code", source: "purchaseOrder", fx: [] },
      ],
      lines: { name: null, fields: [] },
      distributions: { name: null, place: "line", fields: [] },
      empty: "omit",
    };
    expect(applyOutboundMapping(m, INVOICE).body).toEqual({ d: [{ code: "GBP" }] });
  });
});

describe("Microsoft Dynamics 365 Business Central — decision 0609", () => {
  it("is available as a first version, signing in through Entra ID with Business Central's scope, keeping the invoice's number", () => {
    const c = connectorById(STANDARD_CONNECTORS, "dynamics-365-bc")!;
    expect(c).toMatchObject({
      status: "available",
      maturity: "first_version",
      settings: { defaults: { method: "POST", format: "mapped", auth: { type: "oauth2_client_credentials", scope: BC_TOKEN_SCOPE }, referencePath: "$.number" }, authTypes: ["oauth2_client_credentials"] },
      lookupLists: Object.values(BC_LISTS),
    });
    expect(validateOutboundMapping(c.outboundMapping)).toBeNull();
    expect(listsInOutbound(dynamics365BcMapping())).toEqual(Object.values(BC_LISTS));
  });

  it("lays an invoice out as a draft purchase invoice: an Account line per distribution with its dimensions, the company's own currency left blank", () => {
    const out = applyOutboundMapping(dynamics365BcMapping(), INVOICE, { lookups: { [BC_LISTS.taxCodes]: { name: "t", entries: { s: "VAT20", z: "ZERO" } } } });
    expect(out.problems).toEqual([]);
    expect(out.body).toEqual({
      vendorNumber: "20000",
      vendorInvoiceNumber: "INV-2231",
      invoiceDate: "2026-09-29",
      postingDate: "2026-10-02",
      dueDate: "2026-10-29",
      pricesIncludeTax: false,
      totalAmountIncludingTax: 360,
      purchaseInvoiceLines: [
        { lineType: "Account", lineObjectNumber: "8410", description: "Consultancy, September", quantity: 1, unitCost: 120, taxCode: "VAT20", dimensionSetLines: [{ code: "DEPARTMENT", valueCode: "SALES" }] },
        { lineType: "Account", lineObjectNumber: "8410", description: "Consultancy, September", quantity: 1, unitCost: 80, taxCode: "VAT20", dimensionSetLines: [{ code: "PROJECT", valueCode: "PRJ-9" }] },
        { lineType: "Account", lineObjectNumber: "8420", description: "Travel", quantity: 1, unitCost: 100, taxCode: "ZERO" },
      ],
    });
    const eur = applyOutboundMapping(dynamics365BcMapping(), { ...INVOICE, currency: "EUR" }, { lookups: { [BC_LISTS.taxCodes]: { name: "t", entries: {} } } });
    expect(eur.body.currencyCode).toBe("EUR");
    // The tax codes list left empty: Business Central uses each G/L account's own.
    expect((eur.body.purchaseInvoiceLines as Array<Record<string, unknown>>)[2]).toEqual({ lineType: "Account", lineObjectNumber: "8420", description: "Travel", quantity: 1, unitCost: 100 });
  });

  it("says what stops an invoice: no vendor number, a distribution with no G/L account", () => {
    const out = applyOutboundMapping(dynamics365BcMapping(), { ...INVOICE, supplier: { ...INVOICE.supplier, erpId: null }, lines: [{ ...INVOICE.lines[1], distributions: [{ ...INVOICE.lines[1].distributions[0], glCode: null }] }] }, { lookups: { [BC_LISTS.taxCodes]: { name: "t", entries: {} } } });
    expect(out.problems.map((p) => [p.at, p.reason])).toEqual([
      ["vendorNumber", "is required, and is empty"],
      ["purchaseInvoiceLines[1].lineObjectNumber", "is required, and is empty"],
    ]);
  });
});
