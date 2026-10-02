import { describe, expect, it } from "vitest";
import { applyOutboundMapping, listsInOutbound, validateOutboundMapping, type VfInvoice } from "./outbound-mapping.js";
import { SAP_LISTS, sapS4hanaCloudMapping } from "./sap-s4hana-cloud.js";
import { STANDARD_CONNECTORS, connectorById } from "./library.js";
import { applyChain } from "../ingestion/mapping-functions.js";

/** **SAP S/4HANA Cloud — decision 0606.** */

const INVOICE: VfInvoice = {
  schema: "vibefinance.invoice.v1",
  id: "inv-1",
  invoiceNumber: "RE-2026-0004417-B",
  issueDate: "2026-09-29",
  dueDate: null,
  currency: "EUR",
  company: "acme-de",
  supplier: { erpId: "17300032", site: null, name: "Lager Nord GmbH", vatId: "DE123456789" },
  purchaseOrder: null,
  totals: { net: 300, vat: 57, total: 357 },
  sentOn: "2026-10-02",
  lines: [
    {
      lineNumber: 1,
      description: "Palettenregale, verzinkt, inkl. Montage und Lieferung frei Haus",
      quantity: 10,
      unit: "EA",
      poLine: null,
      vatCategory: "S",
      vatRate: 19,
      netAmount: 200,
      distributions: [
        { splitRow: 1, netAmount: 120, costCentre: "10101101", project: null, commodityCode: null, glCode: "61000000" },
        { splitRow: 2, netAmount: 80, costCentre: "10101102", project: "P-1001.1", commodityCode: null, glCode: "61000000" },
      ],
    },
    {
      lineNumber: 2,
      description: "Fracht",
      quantity: 1,
      unit: null,
      poLine: null,
      vatCategory: "S",
      vatRate: 19,
      netAmount: 100,
      distributions: [{ splitRow: null, netAmount: 100, costCentre: "10101101", project: null, commodityCode: null, glCode: "61010000" }],
    },
  ],
};

const lookups = {
  [SAP_LISTS.companyCodes]: { name: SAP_LISTS.companyCodes, entries: { "acme-de": "1010" } },
  [SAP_LISTS.taxCodes]: { name: SAP_LISTS.taxCodes, entries: { s: "V1" } },
};

describe("the functions SAP's OData services need — decision 0606", () => {
  it("writes a date as /Date(ms)/, an amount as text with its decimals, and a number padded with zeros", () => {
    expect(applyChain([{ fn: "odata_date", args: {} }], "2026-09-29")).toEqual({ ok: true, value: "/Date(1790640000000)/" });
    expect(applyChain([{ fn: "odata_date", args: {} }], "29.09.2026")).toMatchObject({ ok: false });
    expect(applyChain([{ fn: "decimal_text", args: { places: 2 } }], 357)).toEqual({ ok: true, value: "357.00" });
    expect(applyChain([{ fn: "decimal_text", args: { places: 2 } }], "12.5")).toEqual({ ok: true, value: "12.50" });
    expect(applyChain([{ fn: "pad", args: { digits: 4 } }], 7)).toEqual({ ok: true, value: "0007" });
    expect(applyChain([{ fn: "pad", args: { digits: 4 } }], "x")).toMatchObject({ ok: false });
  });
});

describe("SAP S/4HANA Cloud — decision 0606", () => {
  it("is available as a first version, fetching a CSRF token first, keeping SAP's document number", () => {
    const c = connectorById(STANDARD_CONNECTORS, "sap-s4hana-cloud")!;
    expect(c).toMatchObject({
      status: "available",
      maturity: "first_version",
      routeId: "https-out",
      settings: { defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.d.SupplierInvoice", csrf: true }, fixed: ["method", "format"], authTypes: ["basic", "oauth2_client_credentials"] },
      lookupLists: Object.values(SAP_LISTS),
    });
    expect(validateOutboundMapping(c.outboundMapping)).toBeNull();
    expect(listsInOutbound(sapS4hanaCloudMapping()).sort()).toEqual(Object.values(SAP_LISTS).sort());
  });

  it("lays an invoice out as a supplier invoice with a G/L account item for each distribution, SAP calculating the tax", () => {
    const out = applyOutboundMapping(sapS4hanaCloudMapping(), INVOICE, { lookups });
    expect(out.problems).toEqual([]);
    expect(out.body).toEqual({
      CompanyCode: "1010",
      DocumentDate: "/Date(1790640000000)/",
      PostingDate: "/Date(1790899200000)/",
      InvoicingParty: "17300032",
      SupplierInvoiceIDByInvcgParty: "RE-2026-0004417-",
      DocumentCurrency: "EUR",
      InvoiceGrossAmount: "357.00",
      TaxIsCalculatedAutomatically: true,
      DueCalculationBaseDate: "/Date(1790640000000)/",
      DocumentHeaderText: "VibeFinance inv-1",
      to_SupplierInvoiceItemGLAcct: [
        { SupplierInvoiceItem: "0001", CompanyCode: "1010", GLAccount: "61000000", CostCenter: "10101101", DocumentCurrency: "EUR", SupplierInvoiceItemAmount: "120.00", TaxCode: "V1", DebitCreditCode: "S", SupplierInvoiceItemText: "Palettenregale, verzinkt, inkl. Montage und Liefer" },
        { SupplierInvoiceItem: "0002", CompanyCode: "1010", GLAccount: "61000000", CostCenter: "10101102", WBSElement: "P-1001.1", DocumentCurrency: "EUR", SupplierInvoiceItemAmount: "80.00", TaxCode: "V1", DebitCreditCode: "S", SupplierInvoiceItemText: "Palettenregale, verzinkt, inkl. Montage und Liefer" },
        { SupplierInvoiceItem: "0003", CompanyCode: "1010", GLAccount: "61010000", CostCenter: "10101101", DocumentCurrency: "EUR", SupplierInvoiceItemAmount: "100.00", TaxCode: "V1", DebitCreditCode: "S", SupplierInvoiceItemText: "Fracht" },
      ],
    });
  });

  it("says in words what stops an invoice: no SAP supplier number, a company code or tax code not in its list", () => {
    const out = applyOutboundMapping(sapS4hanaCloudMapping(), { ...INVOICE, supplier: { ...INVOICE.supplier, erpId: null }, lines: [INVOICE.lines[1]] }, { lookups: { ...lookups, [SAP_LISTS.taxCodes]: { name: SAP_LISTS.taxCodes, entries: {} } } });
    expect(out.problems.map((p) => [p.at, p.reason])).toEqual([
      ["InvoicingParty", "is required, and is empty"],
      ["to_SupplierInvoiceItemGLAcct[1].TaxCode", '"S" is not in the list SAP tax codes'],
    ]);
  });
});
