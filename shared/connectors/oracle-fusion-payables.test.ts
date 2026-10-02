import { describe, expect, it } from "vitest";
import { applyOutboundMapping, builtParts, listsInOutbound, outboundSamples, validateOutboundMapping, type OutboundMapping, type VfInvoice } from "./outbound-mapping.js";
import { ORACLE_LISTS, oracleFusionPayablesMapping } from "./oracle-fusion-payables.js";
import { STANDARD_CONNECTORS, connectorById } from "./library.js";
import { renameLists, validatePartnerDefinition, PARTNER_CONNECTOR_SCHEMA } from "./partner-connector.js";

/**
 * **Oracle Fusion Payables, and fields built from parts — decision 0605.**
 */

const INVOICE: VfInvoice = {
  schema: "vibefinance.invoice.v1",
  id: "inv-1",
  invoiceNumber: "88240",
  issueDate: "2026-09-29",
  dueDate: "2026-10-29",
  currency: "GBP",
  company: "Acme UK",
  supplier: { erpId: "1013", site: "FRESNO", name: "Advanced Network Devices", vatId: "GB123456789" },
  purchaseOrder: null,
  totals: { net: 300, vat: 60, total: 360 },
  lines: [
    {
      lineNumber: 1,
      description: "Pallets",
      quantity: 10,
      unit: "EA",
      poLine: null,
      vatCategory: "S",
      vatRate: 20,
      netAmount: 200,
      distributions: [
        { splitRow: 1, netAmount: 120, costCentre: "100", project: null, commodityCode: null, glCode: "7110" },
        { splitRow: 2, netAmount: 80, costCentre: "200", project: null, commodityCode: null, glCode: "7110" },
      ],
    },
    {
      lineNumber: 2,
      description: "Delivery",
      quantity: 1,
      unit: null,
      poLine: null,
      vatCategory: "S",
      vatRate: 20,
      netAmount: 100,
      distributions: [{ splitRow: null, netAmount: 100, costCentre: "100", project: null, commodityCode: null, glCode: "7640" }],
    },
  ],
};

const lookups = {
  "Oracle business units": { name: "Oracle business units", entries: { "acme uk": "Vision Operations" } },
  "Oracle company segments": { name: "Oracle company segments", entries: { "acme uk": "01" } },
  "Oracle tax classifications": { name: "Oracle tax classifications", entries: { s: "VAT STD" } },
};

describe("fields built from parts — decision 0605", () => {
  it("reads each part, looks a part up where a list is named, and is empty where any part is", () => {
    expect(builtParts("{company|Segments}-{distribution.glCode}-000")).toEqual([
      { source: "company", list: "Segments" },
      { source: "distribution.glCode", list: null },
    ]);
    const m: OutboundMapping = {
      format: "json",
      invoice: [{ target: "Ref", source: null, built: "VF-{invoiceNumber}/{purchaseOrder}", fx: [] }],
      lines: { name: "lines", fields: [] },
      distributions: {
        name: "d",
        place: "line",
        fields: [
          { target: "Account", source: null, built: "{company|seg}.{distribution.costCentre}.{distribution.glCode}", fx: [{ fn: "upper", args: {} }] },
          { target: "N", source: "distribution.numberInLine", fx: [] },
        ],
      },
      empty: "omit",
    };
    expect(validateOutboundMapping(m)).toBeNull();
    expect(listsInOutbound(m)).toEqual(["seg"]);
    const out = applyOutboundMapping(m, INVOICE, { lookups: { seg: { name: "Segments", entries: { "acme uk": "01a" } } } });
    expect(out.problems).toEqual([]);
    // The purchase order is empty, so the reference is too, and left out.
    expect(out.body.Ref).toBeUndefined();
    expect((out.body.lines as Array<{ d: unknown[] }>).map((l) => l.d)).toEqual([
      [{ Account: "01A.100.7110", N: 1 }, { Account: "01A.200.7110", N: 2 }],
      [{ Account: "01A.100.7640", N: 1 }],
    ]);
    expect(outboundSamples(INVOICE, "distribution.numberInLine")).toEqual(["1", "2"]);
    const missing = applyOutboundMapping(m, INVOICE, { lookups: { seg: { name: "Segments", entries: {} } } });
    expect(missing.problems[0]).toMatchObject({ at: "lines[1].d[1].Account", reason: '"Acme UK" is not in the list Segments' });
  });

  it("refuses a pattern that reads what is not there, below its level, names no part, or leaves a brace open", () => {
    const one = (built: string, level: "invoice" | "line" | "distribution" = "invoice"): OutboundMapping => ({
      format: "json",
      invoice: level === "invoice" ? [{ target: "X", source: null, built, fx: [] }] : [],
      lines: { name: "lines", fields: level === "line" ? [{ target: "X", source: null, built, fx: [] }] : [] },
      distributions: { name: "d", place: "line", fields: [] },
      empty: "omit",
    });
    expect(validateOutboundMapping(one("{nothing}"))).toBe('X: "nothing" is not part of the VibeFinance invoice');
    expect(validateOutboundMapping(one("{line.description}"))).toBe("X is once per invoice, and cannot read line.description, which is once per line");
    expect(validateOutboundMapping(one("plain text"))).toBe("X: the pattern names no part, such as {distribution.glCode}");
    expect(validateOutboundMapping(one("{company}-{"))).toBe("X: a brace that opens no part");
    expect(validateOutboundMapping({ ...one("{company}"), invoice: [{ target: "X", source: "company", built: "{company}", fx: [] }] })).toBe("X is built from parts, so it has no single source");
    expect(validateOutboundMapping(one("{company} {line.description}", "line"))).toBeNull();
  });

  it("carries its lists by name in a connector's definition, and by id in a customer's mapping", () => {
    const named = oracleFusionPayablesMapping();
    const ids = renameLists(named, (name) => `id-of-${name}`);
    expect(ids.distributions.fields.find((f) => f.target === "DistributionCombination")!.built).toBe("{company|id-of-Oracle company segments}-{distribution.costCentre}-{distribution.glCode}-0000-000");
    expect(listsInOutbound(named).sort()).toEqual(Object.values(ORACLE_LISTS).sort());
    // A partner may submit one built from parts, its lists named.
    expect(
      validatePartnerDefinition({
        schema: PARTNER_CONNECTOR_SCHEMA,
        direction: "destination",
        routeId: "https-out",
        transport: "https",
        settings: { defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" }, fixed: ["format"], authTypes: ["basic"] },
        outboundMapping: named,
        lookupLists: Object.values(ORACLE_LISTS),
        vendorDocs: null,
      })
    ).toBeNull();
  });
});

describe("Oracle Fusion Payables — decision 0605", () => {
  it("is available as a first version, sending its own layout by POST, signing in by password or OAuth, keeping Oracle's InvoiceId", () => {
    const c = connectorById(STANDARD_CONNECTORS, "oracle-fusion-payables")!;
    expect(c).toMatchObject({
      status: "available",
      maturity: "first_version",
      routeId: "https-out",
      settings: { defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" }, fixed: ["method", "format"], authTypes: ["basic", "oauth2_client_credentials"] },
      lookupLists: Object.values(ORACLE_LISTS),
    });
    expect(validateOutboundMapping(c.outboundMapping)).toBeNull();
  });

  it("lays an invoice out as Oracle's own examples do: net lines with a tax classification, the gross total checked against the VAT, each distribution's account built", () => {
    const out = applyOutboundMapping(oracleFusionPayablesMapping(), INVOICE, { lookups });
    expect(out.problems).toEqual([]);
    expect(out.body).toEqual({
      InvoiceNumber: "88240",
      InvoiceCurrency: "GBP",
      InvoiceAmount: 360,
      InvoiceDate: "2026-09-29",
      BusinessUnit: "Vision Operations",
      Supplier: "Advanced Network Devices",
      SupplierSite: "FRESNO",
      Description: "VibeFinance inv-1",
      ControlAmount: 60,
      invoiceLines: [
        {
          LineNumber: 1,
          LineType: "Item",
          LineAmount: 200,
          Description: "Pallets",
          Quantity: 10,
          TaxClassification: "VAT STD",
          invoiceDistributions: [
            { DistributionLineNumber: 1, DistributionLineType: "Item", DistributionAmount: 120, DistributionCombination: "01-100-7110-0000-000" },
            { DistributionLineNumber: 2, DistributionLineType: "Item", DistributionAmount: 80, DistributionCombination: "01-200-7110-0000-000" },
          ],
        },
        {
          LineNumber: 2,
          LineType: "Item",
          LineAmount: 100,
          Description: "Delivery",
          Quantity: 1,
          TaxClassification: "VAT STD",
          invoiceDistributions: [{ DistributionLineNumber: 1, DistributionLineType: "Item", DistributionAmount: 100, DistributionCombination: "01-100-7640-0000-000" }],
        },
      ],
    });
  });

  it("says in words what stops an invoice: a business unit not in the list, no supplier site, a distribution with no cost centre", () => {
    const bare = { ...INVOICE, supplier: { ...INVOICE.supplier, site: null }, lines: [{ ...INVOICE.lines[1], distributions: [{ ...INVOICE.lines[1].distributions[0], costCentre: null }] }] };
    const out = applyOutboundMapping(oracleFusionPayablesMapping(), bare, { lookups: { ...lookups, "Oracle business units": { name: "Oracle business units", entries: {} } } });
    expect(out.problems.map((p) => [p.at, p.reason])).toEqual([
      ["BusinessUnit", '"Acme UK" is not in the list Oracle business units'],
      ["SupplierSite", "is required, and is empty"],
      ["invoiceLines[1].invoiceDistributions[1].DistributionCombination", "is required, and is empty"],
    ]);
  });
});
