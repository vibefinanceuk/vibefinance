import { describe, expect, it } from "vitest";
import { applyOutboundMapping, listsInOutbound, validTarget, validateOutboundMapping, type OutboundMapping, type VfInvoice } from "./outbound-mapping.js";
import { INTACCT_BILL_URL, INTACCT_LISTS, INTACCT_TOKEN_URL, sageIntacctMapping } from "./sage-intacct.js";
import { STANDARD_CONNECTORS, connectorById } from "./library.js";
import { applyChain, validateChain } from "../ingestion/mapping-functions.js";
import { PARTNER_CONNECTOR_SCHEMA, validatePartnerDefinition } from "./partner-connector.js";

/** **Sage Intacct — decision 0607.** */

const INVOICE: VfInvoice = {
  schema: "vibefinance.invoice.v1",
  id: "inv-1",
  invoiceNumber: "INV-2231",
  issueDate: "2026-09-29",
  dueDate: "2026-10-29",
  currency: "GBP",
  company: "acme-uk",
  supplier: { erpId: "V-1001", site: null, name: "Northern Freight Ltd", vatId: "GB123456789" },
  purchaseOrder: "PO-77",
  totals: { net: 300, vat: 60, total: 360 },
  sentOn: "2026-10-02",
  lines: [
    {
      lineNumber: 1,
      description: "Pallet racking",
      quantity: 10,
      unit: "EA",
      poLine: null,
      vatCategory: "S",
      vatRate: 20,
      netAmount: 200,
      distributions: [
        { splitRow: 1, netAmount: 120, costCentre: "OPS", project: null, commodityCode: null, glCode: "6000" },
        { splitRow: 2, netAmount: 80, costCentre: "FIN", project: "PRJ-9", commodityCode: null, glCode: "6000" },
      ],
    },
    { lineNumber: 2, description: "Delivery", quantity: 1, unit: null, poLine: null, vatCategory: "Z", vatRate: 0, netAmount: 100, distributions: [{ splitRow: null, netAmount: 100, costCentre: "OPS", project: null, commodityCode: null, glCode: "6100" }] },
  ],
};
const list = (name: string, entries: Record<string, string>) => ({ name, entries });

describe("places in a list, and lists a customer does not use — decision 0607", () => {
  it("lays out a target with a place in a list as a list of one, and refuses a place first or last", () => {
    expect(validTarget("taxEntries.0.purchasingTaxDetail.id")).toBe(true);
    expect(validTarget("0.id")).toBe(false);
    expect(validTarget("taxEntries.0")).toBe(false);
    expect(validTarget("ia::result")).toBe(true);
    const m: OutboundMapping = {
      format: "json",
      invoice: [
        { target: "a.0.b", source: "invoiceNumber", fx: [] },
        { target: "a.0.c", source: "currency", fx: [] },
        { target: "a.1.b", source: "company", fx: [] },
      ],
      lines: { name: null, fields: [] },
      distributions: { name: null, place: "line", fields: [] },
      empty: "omit",
    };
    expect(validateOutboundMapping(m)).toBeNull();
    expect(applyOutboundMapping(m, INVOICE).body).toEqual({ a: [{ b: "INV-2231", c: "GBP" }, { b: "acme-uk" }] });
  });

  it("looks up unless the list is empty: an empty list gives nothing, a list with entries refuses what it lacks", () => {
    const step = [{ fn: "look_up" as const, args: { list: "t", otherwise: "unless_empty" } }];
    expect(validateChain(step)).toBeNull();
    expect(applyChain(step, "S", { lookups: { t: list("Tax", {}) } })).toEqual({ ok: true, value: null });
    expect(applyChain(step, "S", { lookups: { t: list("Tax", { s: "UK Purchase Goods Standard Rate" }) } })).toEqual({ ok: true, value: "UK Purchase Goods Standard Rate" });
    expect(applyChain(step, "Z", { lookups: { t: list("Tax", { s: "x" }) } })).toMatchObject({ ok: false, reason: '"Z" is not in the list Tax' });
    expect(validateChain([{ fn: "look_up", args: { list: "t", otherwise: "maybe" } }])).toBe("look_up's otherwise is refuse, keep or unless_empty");
  });
});

describe("Sage Intacct — decision 0607", () => {
  it("is available as a first version, its address and token address filled in, signing in with OAuth, keeping the record's key", () => {
    const c = connectorById(STANDARD_CONNECTORS, "sage-intacct")!;
    expect(c).toMatchObject({
      status: "available",
      maturity: "first_version",
      settings: { defaults: { url: INTACCT_BILL_URL, method: "POST", format: "mapped", auth: { type: "oauth2_client_credentials", tokenUrl: INTACCT_TOKEN_URL }, referencePath: "$.ia::result.key" }, authTypes: ["oauth2_client_credentials"] },
      lookupLists: Object.values(INTACCT_LISTS),
    });
    expect(validateOutboundMapping(c.outboundMapping)).toBeNull();
    expect(listsInOutbound(sageIntacctMapping()).sort()).toEqual(Object.values(INTACCT_LISTS).sort());
  });

  it("lays an invoice out as a bill with a line per distribution, its dimensions, and the tax detail Intacct calculates from", () => {
    const out = applyOutboundMapping(sageIntacctMapping(), INVOICE, {
      lookups: { [INTACCT_LISTS.locations]: list("l", { "acme-uk": "UK" }), [INTACCT_LISTS.taxDetails]: list("t", { s: "UK Purchase Goods Standard Rate", z: "UK Purchase Goods Zero Rate" }) },
    });
    expect(out.problems).toEqual([]);
    expect(out.body).toEqual({
      billNumber: "INV-2231",
      vendor: { id: "V-1001" },
      createdDate: "2026-09-29",
      postingDate: "2026-10-02",
      dueDate: "2026-10-29",
      currency: { txnCurrency: "GBP" },
      referenceNumber: "PO-77",
      description: "VibeFinance inv-1",
      isTaxInclusive: false,
      lines: [
        { glAccount: { id: "6000" }, txnAmount: "120.00", memo: "Pallet racking", dimensions: { department: { id: "OPS" }, location: { id: "UK" } }, taxEntries: [{ purchasingTaxDetail: { id: "UK Purchase Goods Standard Rate" } }] },
        { glAccount: { id: "6000" }, txnAmount: "80.00", memo: "Pallet racking", dimensions: { department: { id: "FIN" }, project: { id: "PRJ-9" }, location: { id: "UK" } }, taxEntries: [{ purchasingTaxDetail: { id: "UK Purchase Goods Standard Rate" } }] },
        { glAccount: { id: "6100" }, txnAmount: "100.00", memo: "Delivery", dimensions: { department: { id: "OPS" }, location: { id: "UK" } }, taxEntries: [{ purchasingTaxDetail: { id: "UK Purchase Goods Zero Rate" } }] },
      ],
    });
  });

  it("sends untaxed lines with no location for a company that leaves both lists empty, and says what stops one", () => {
    const empty = { lookups: { [INTACCT_LISTS.locations]: list("l", {}), [INTACCT_LISTS.taxDetails]: list("t", {}) } };
    const us = applyOutboundMapping(sageIntacctMapping(), { ...INVOICE, currency: "USD" }, empty);
    expect(us.problems).toEqual([]);
    expect((us.body.lines as Array<Record<string, unknown>>)[0]).toEqual({ glAccount: { id: "6000" }, txnAmount: "120.00", memo: "Pallet racking", dimensions: { department: { id: "OPS" } } });
    const stopped = applyOutboundMapping(sageIntacctMapping(), { ...INVOICE, dueDate: null, supplier: { ...INVOICE.supplier, erpId: null } }, empty);
    expect(stopped.problems.map((p) => [p.at, p.reason])).toEqual([
      ["vendor.id", "is required, and is empty"],
      ["dueDate", "is required, and is empty"],
    ]);
  });

  it("never lets a partner's connector name an address", () => {
    const def = {
      schema: PARTNER_CONNECTOR_SCHEMA,
      direction: "destination",
      routeId: "https-out",
      transport: "https",
      settings: { defaults: { method: "POST", format: "vf_json", auth: { type: "none" }, referencePath: null, url: "https://evil.example" }, fixed: [], authTypes: ["none"] },
      outboundMapping: null,
      lookupLists: [],
      vendorDocs: null,
    };
    expect(validatePartnerDefinition(def)).toBe("a connector does not carry url");
  });
});
