import { describe, expect, it } from "vitest";
import {
  applyOutboundMapping,
  listsInOutbound,
  outboundSamples,
  standardOutboundMapping,
  validateOutboundMapping,
  type OutboundMapping,
  type VfInvoice,
} from "./outbound-mapping.js";

const INVOICE: VfInvoice = {
  schema: "vibefinance.invoice.v1",
  id: "inv-1",
  invoiceNumber: "88240",
  issueDate: "2026-09-29",
  dueDate: "2026-10-29",
  currency: "EUR",
  company: "DE01",
  supplier: { erpId: "S-100", site: "HAMBURG", name: "Lager Nord GmbH", vatId: "DE123456789" },
  purchaseOrder: null,
  totals: { net: 300, vat: 57, total: 357 },
  lines: [
    {
      lineNumber: 1,
      description: "Pallets",
      quantity: 10,
      unit: "EA",
      poLine: null,
      vatCategory: "S",
      vatRate: 19,
      netAmount: 200,
      distributions: [
        { splitRow: 1, netAmount: 120, costCentre: "CC10", project: null, commodityCode: null, glCode: "6000" },
        { splitRow: 2, netAmount: 80, costCentre: "CC20", project: null, commodityCode: null, glCode: "6000" },
      ],
    },
    {
      lineNumber: 2,
      description: "Freight",
      quantity: 1,
      unit: null,
      poLine: null,
      vatCategory: "S",
      vatRate: 19,
      netAmount: 100,
      distributions: [{ splitRow: null, netAmount: 100, costCentre: "CC10", project: "P7", commodityCode: null, glCode: "6100" }],
    },
  ],
};

/** An Oracle-shaped layout: header, invoiceLines, and each line's invoiceDistributions. */
const ORACLE: OutboundMapping = {
  format: "json",
  invoice: [
    { target: "InvoiceNumber", source: "invoiceNumber", fx: [], required: true },
    { target: "InvoiceCurrency", source: "currency", fx: [] },
    { target: "InvoiceAmount", source: "totals.total", fx: [] },
    { target: "InvoiceDate", source: "issueDate", fx: [{ fn: "write_date", args: { pattern: "dd/MM/yyyy" } }] },
    { target: "BusinessUnit", source: "company", fx: [{ fn: "look_up", args: { list: "bu", otherwise: "refuse" } }] },
    { target: "Supplier", source: "supplier.name", fx: [{ fn: "upper", args: {} }] },
    { target: "InvoiceSource", source: null, fixed: "VIBEFINANCE", fx: [] },
    { target: "PurchaseOrder", source: "purchaseOrder", fx: [] },
  ],
  lines: {
    name: "invoiceLines",
    fields: [
      { target: "LineNumber", source: "line.lineNumber", fx: [] },
      { target: "LineAmount", source: "line.netAmount", fx: [] },
      { target: "Currency", source: "currency", fx: [] },
    ],
  },
  distributions: {
    name: "invoiceDistributions",
    place: "line",
    fields: [
      { target: "DistributionLineNumber", source: "distribution.sequence", fx: [] },
      { target: "DistributionAmount", source: "distribution.netAmount", fx: [] },
      { target: "DistributionCombination", source: "distribution.glCode", fx: [] },
    ],
  },
  empty: "omit",
};
const CTX = { lookups: { bu: { name: "Business units", entries: { de01: "Vision Germany BU" } } } };

describe("outbound mapping — decision 0591", () => {
  it("the standard layout gives exactly the VibeFinance invoice JSON", () => {
    const def = standardOutboundMapping();
    expect(validateOutboundMapping(def)).toBeNull();
    const out = applyOutboundMapping(def, INVOICE);
    expect(out.problems).toEqual([]);
    expect(JSON.stringify(out.body)).toBe(JSON.stringify(INVOICE));
  });

  it("lays out a target's own shape: names, nesting, functions, look-ups, fixed values, empties left out", () => {
    expect(validateOutboundMapping(ORACLE)).toBeNull();
    const out = applyOutboundMapping(ORACLE, INVOICE, CTX);
    expect(out.problems).toEqual([]);
    expect(out.body).toEqual({
      InvoiceNumber: "88240",
      InvoiceCurrency: "EUR",
      InvoiceAmount: 357,
      InvoiceDate: "29/09/2026",
      BusinessUnit: "Vision Germany BU",
      Supplier: "LAGER NORD GMBH",
      InvoiceSource: "VIBEFINANCE",
      invoiceLines: [
        {
          LineNumber: 1,
          LineAmount: 200,
          Currency: "EUR",
          invoiceDistributions: [
            { DistributionLineNumber: 1, DistributionAmount: 120, DistributionCombination: "6000" },
            { DistributionLineNumber: 2, DistributionAmount: 80, DistributionCombination: "6000" },
          ],
        },
        {
          LineNumber: 2,
          LineAmount: 100,
          Currency: "EUR",
          invoiceDistributions: [{ DistributionLineNumber: 3, DistributionAmount: 100, DistributionCombination: "6100" }],
        },
      ],
    });
    expect(listsInOutbound(ORACLE)).toEqual(["bu"]);
  });

  it("places every distribution on the invoice, as SAP's G/L items, and nests a dotted array name", () => {
    const sap: OutboundMapping = {
      format: "json",
      invoice: [{ target: "SupplierInvoiceIDByInvcgParty", source: "invoiceNumber", fx: [] }],
      lines: { name: null, fields: [] },
      distributions: {
        name: "to_SupplierInvoiceItemGLAcct.results",
        place: "invoice",
        fields: [
          { target: "SupplierInvoiceItem", source: "distribution.sequence", fx: [] },
          { target: "GLAccount", source: "distribution.glCode", fx: [] },
          { target: "CostCenter", source: "distribution.costCentre", fx: [] },
          { target: "SupplierInvoiceItemText", source: "line.description", fx: [] },
        ],
      },
      empty: "omit",
    };
    expect(validateOutboundMapping(sap)).toBeNull();
    const out = applyOutboundMapping(sap, INVOICE);
    expect(out.body).toEqual({
      SupplierInvoiceIDByInvcgParty: "88240",
      to_SupplierInvoiceItemGLAcct: {
        results: [
          { SupplierInvoiceItem: 1, GLAccount: "6000", CostCenter: "CC10", SupplierInvoiceItemText: "Pallets" },
          { SupplierInvoiceItem: 2, GLAccount: "6000", CostCenter: "CC20", SupplierInvoiceItemText: "Pallets" },
          { SupplierInvoiceItem: 3, GLAccount: "6100", CostCenter: "CC10", SupplierInvoiceItemText: "Freight" },
        ],
      },
    });
  });

  it("says what it could not lay out: a required empty, a function that fails, a value not in the list", () => {
    const def: OutboundMapping = structuredClone(ORACLE);
    def.invoice.push({ target: "PO", source: "purchaseOrder", fx: [], required: true });
    def.lines.fields.push({ target: "Uom", source: "line.unit", fx: [{ fn: "number", args: {} }] });
    const out = applyOutboundMapping(def, INVOICE, { lookups: { bu: { name: "Business units", entries: {} } } });
    expect(out.problems.map((p) => [p.at, p.reason])).toEqual([
      ["BusinessUnit", '"DE01" is not in the list Business units'],
      ["PO", "is required, and is empty"],
      ["invoiceLines[1].Uom", expect.stringContaining("EA")],
    ]);
    // Empties written as null when asked.
    const nulls = applyOutboundMapping({ ...ORACLE, empty: "null" }, INVOICE, CTX);
    expect(nulls.body.PurchaseOrder).toBeNull();
  });

  it("refuses what it cannot store, in words", () => {
    const bad = (change: (d: OutboundMapping) => void) => {
      const d = structuredClone(ORACLE);
      change(d);
      return validateOutboundMapping(d);
    };
    expect(bad((d) => (d.invoice[0].target = "Invoice Number"))).toMatch(/not a name/);
    expect(bad((d) => (d.invoice[0].source = "nonsense"))).toMatch(/not part of the VibeFinance invoice/);
    expect(bad((d) => (d.invoice[0].source = "line.description"))).toMatch(/once per invoice, and cannot read line.description/);
    expect(bad((d) => (d.lines.fields[0].source = "distribution.glCode"))).toMatch(/once per line/);
    expect(bad((d) => d.invoice.push({ target: "InvoiceNumber", source: "id", fx: [] }))).toMatch(/named twice/);
    expect(bad((d) => d.invoice.push({ target: "InvoiceNumber.Part", source: "id", fx: [] }))).toMatch(/cannot hold a value and also/);
    expect(bad((d) => d.invoice.push({ target: "invoiceLines", source: "id", fx: [] }))).toMatch(/named twice/);
    expect(bad((d) => d.invoice.push({ target: "X", source: null, fx: [] }))).toMatch(/needs a source or a fixed value/);
    expect(bad((d) => (d.invoice[0].fx = [{ fn: "nope" as never }]))).toMatch(/not a function/);
    expect(bad((d) => (d.lines.name = null))).toMatch(/name the lines/);
    expect(bad((d) => (d.empty = "maybe" as never))).toMatch(/omit or null/);
  });

  it("gives every value a source holds, for worked examples", () => {
    expect(outboundSamples(INVOICE, "distribution.glCode")).toEqual(["6000", "6100"]);
    expect(outboundSamples(INVOICE, "line.description")).toEqual(["Pallets", "Freight"]);
    expect(outboundSamples(INVOICE, "company")).toEqual(["DE01"]);
  });
});
