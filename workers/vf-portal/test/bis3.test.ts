import { describe, expect, it } from "vitest";
// @ts-expect-error a browser module, plain JavaScript
import { endpointOf, lineNet, toXml, totals, validate } from "../public/bis3.js";

/** The Create form's Peppol BIS Billing 3.0 invoice — decision 0727. */

const MODEL = () => ({
  number: "LN-1",
  issueDate: "2026-10-11",
  dueDate: "2026-11-10",
  currency: "GBP",
  purchaseOrder: "690000321",
  buyerReference: "",
  paymentTerms: "",
  seller: { name: "Lager Nord GmbH", vatId: "DE123456789", country: "DE", city: "Hamburg" },
  buyer: { name: "Acme UK Ltd", vatId: "GB999888777", endpoint: "0088:5012345000004", country: "GB" },
  account: null as null | { means: string; identifier: string; name?: string },
  exemptionReason: "",
  lines: [
    { description: "Rolls", poLine: "10", quantity: 3, unitCode: "C62", unitPrice: 0.333, vatCategory: "S", vatRate: 20 },
    { description: "Lunch", quantity: 1, unitCode: "C62", unitPrice: 10, vatCategory: "S", vatRate: 20 },
    { description: "Books", quantity: 2, unitCode: "C62", unitPrice: 5, vatCategory: "Z", vatRate: 0 },
  ],
});

describe("totals", () => {
  it("rounds each line, and works VAT out on each category and rate's total (BR-S-08, BR-S-09)", () => {
    expect(lineNet({ quantity: 3, unitPrice: 0.333 })).toBe(1);
    const t = totals(MODEL());
    expect(t.lines).toEqual([1, 10, 10]);
    expect(t.breakdown).toEqual([
      { category: "S", rate: 20, taxable: 11, tax: 2.2 },
      { category: "Z", rate: 0, taxable: 10, tax: 0 },
    ]);
    expect([t.net, t.vat, t.total]).toEqual([21, 2.2, 23.2]);
  });
});

describe("the rules", () => {
  it("passes a complete invoice", () => {
    expect(validate(MODEL())).toEqual([]);
  });

  it("names what is missing or wrong, with its rule and field", () => {
    const m = MODEL();
    m.number = "";
    m.issueDate = "11/10/2026";
    m.purchaseOrder = "";
    m.dueDate = "";
    m.lines[0].description = "";
    m.lines[1].vatRate = 0;
    m.lines[2].quantity = 0;
    const rules = validate(m).map((f: { rule: string; field: string }) => `${f.rule} ${f.field}`);
    expect(rules).toEqual([
      "BR-02 number",
      "BR-03 issueDate",
      "PEPPOL-EN16931-R003 buyerReference",
      "BR-25 line:0:description",
      "BR-S-05 line:1:vatRate",
      "BR-22 line:2:quantity",
      "BR-CO-25 dueDate",
    ]);
  });

  it("asks for an exemption reason, and both VAT numbers for a reverse charge", () => {
    const m = MODEL();
    m.lines[2].vatCategory = "AE";
    m.buyer.vatId = "";
    expect(validate(m).map((f: { rule: string }) => f.rule)).toEqual(["BR-E-10", "BR-AE-03"]);
  });

  it("needs an electronic address for each party: the record's, or its VAT number under the country's scheme", () => {
    expect(endpointOf({ endpoint: "0088:5012345000004" })).toEqual({ scheme: "0088", id: "5012345000004" });
    expect(endpointOf({ vatId: "DE 123456789" })).toEqual({ scheme: "9930", id: "DE123456789" });
    expect(endpointOf({ vatId: "", country: "GB" })).toBeNull();
    const m = MODEL();
    m.seller.vatId = "";
    expect(validate(m).map((f: { rule: string }) => f.rule)).toEqual(["PEPPOL-EN16931-R020"]);
  });
});

describe("the XML", () => {
  it("declares Peppol BIS Billing 3.0, in UBL's order, with the totals and the account, and escapes what it is given", () => {
    const m = MODEL();
    m.account = { means: "58", identifier: "DE89 3704 0044 0532 0130 00", name: "Lager Nord" };
    m.lines[1].description = "Lunch & <drinks>";
    const xml = toXml(m);
    expect(xml).toContain("<cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>");
    expect(xml).toContain('<cbc:EndpointID schemeID="9930">DE123456789</cbc:EndpointID>');
    expect(xml).toContain('<cbc:EndpointID schemeID="0088">5012345000004</cbc:EndpointID>');
    expect(xml).toContain("<cac:OrderReference><cbc:ID>690000321</cbc:ID></cac:OrderReference>");
    expect(xml).toContain("<cbc:ID>DE89370400440532013000</cbc:ID>");
    expect(xml).toContain('<cbc:PayableAmount currencyID="GBP">23.20</cbc:PayableAmount>');
    expect(xml).toContain("<cbc:Name>Lunch &amp; &lt;drinks&gt;</cbc:Name>");
    expect(xml).toContain("<cac:OrderLineReference><cbc:LineID>10</cbc:LineID></cac:OrderLineReference>");
    const order = ["cbc:CustomizationID", "cbc:ProfileID", "cbc:IssueDate", "cbc:DueDate", "cbc:InvoiceTypeCode", "cbc:DocumentCurrencyCode", "cac:OrderReference", "cac:AccountingSupplierParty", "cac:AccountingCustomerParty", "cac:PaymentMeans", "cac:TaxTotal", "cac:LegalMonetaryTotal", "cac:InvoiceLine"];
    const at = order.map((tag) => xml.indexOf(`<${tag}`));
    expect(at.every((p: number) => p > 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    // No empty element is written (PEPPOL-EN16931-R008).
    expect(xml).not.toMatch(/<(cbc:[A-Za-z]+)[^>]*><\/\1>/);
  });
});
