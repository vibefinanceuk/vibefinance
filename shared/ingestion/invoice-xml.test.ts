import { describe, expect, it } from "vitest";
import { checkEn16931 } from "./en16931-rules.js";
import { identifyFormat } from "./invoice-format.js";
import { InvoiceXmlError, formatFacts, readInvoiceXml, rootElementOf } from "./invoice-xml.js";

/**
 * Decision 0560 — reading CII, recognising the format, and the EN 16931
 * rules this code checks. The official test cases are the yardstick in
 * `en16931-conformance.test.ts`; these are ours, and always run.
 */

const cii = (opts: { spec?: string; typeCode?: string; buyerReference?: boolean; dueTotal?: string } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<!-- an XRechnung written in CII -->
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:BusinessProcessSpecifiedDocumentContextParameter><ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID></ram:BusinessProcessSpecifiedDocumentContextParameter>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${opts.spec ?? "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0"}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>R-88240</ram:ID>
    <ram:TypeCode>${opts.typeCode ?? "380"}</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260929</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>Hydraulic seal kit</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:BuyerOrderReferencedDocument><ram:LineID>3</ram:LineID></ram:BuyerOrderReferencedDocument>
        <ram:NetPriceProductTradePrice><ram:ChargeAmount>45.50</ram:ChargeAmount></ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="H87">12</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>546.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
        <ram:ReceivableSpecifiedTradeAccountingAccount><ram:ID>HAM-OPS</ram:ID></ram:ReceivableSpecifiedTradeAccountingAccount>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      ${opts.buyerReference === false ? "" : "<ram:BuyerReference>04011000-12345-34</ram:BuyerReference>"}
      <ram:SellerTradeParty>
        <ram:Name>Munch GmbH</ram:Name>
        <ram:PostalTradeAddress><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:URIUniversalCommunication><ram:URIID schemeID="EM">rechnung@munch.de</ram:URIID></ram:URIUniversalCommunication>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="FC">12/345/67890</ram:ID></ram:SpecifiedTaxRegistration>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE812345678</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Acme UK Ltd</ram:Name>
        <ram:PostalTradeAddress><ram:CountryID>GB</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">GB123456789</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:BuyerTradeParty>
      <ram:BuyerOrderReferencedDocument><ram:IssuerAssignedID>PO-4471</ram:IssuerAssignedID></ram:BuyerOrderReferencedDocument>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:TaxCurrencyCode>GBP</ram:TaxCurrencyCode>
      <ram:SpecifiedTradePaymentTerms>
        <ram:Description>30 days net</ram:Description>
        <ram:DueDateDateTime><udt:DateTimeString format="102">20261029</udt:DateTimeString></ram:DueDateDateTime>
      </ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>546.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>546.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="GBP">89.14</ram:TaxTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">103.74</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>649.74</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${opts.dueTotal ?? "649.74"}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;

describe("readInvoiceXml — CII", () => {
  it("reads the same Business Terms the UBL parser reads, from their CII places", () => {
    const read = readInvoiceXml(cii());
    expect(read.syntax).toBe("cii");
    expect(read.format).toBe("xrechnung");
    expect(read.facts).toMatchObject({
      "BT-1": "R-88240",
      "BT-2": "2026-09-29",
      "BT-3": "380",
      "BT-5": "EUR",
      "BT-9": "2026-10-29",
      "BT-10": "04011000-12345-34",
      "BT-13": "PO-4471",
      "BT-20": "30 days net",
      "BT-24": "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0",
      "BT-27": "Munch GmbH",
      "BT-34": "rechnung@munch.de",
      "BT-40": "DE",
      "BT-44": "Acme UK Ltd",
      "BT-48": "GB123456789",
      "BT-55": "GB",
      "BT-106": 546,
      "BT-109": 546,
      "BT-112": 649.74,
      "BT-115": 649.74,
    });
    expect(read.lines).toEqual([
      {
        lineNumber: 1,
        "BT-126": "1",
        "BT-129": 12,
        "BT-130": "H87",
        "BT-131": 546,
        "BT-132": "3",
        "BT-133": "HAM-OPS",
        "BT-146": 45.5,
        "BT-151": "S",
        "BT-152": 19,
        "BT-153": "Hydraulic seal kit",
      },
    ]);
  });

  it("takes the VAT number (schemeID VA), never the tax number (FC)", () => {
    expect(readInvoiceXml(cii()).facts["BT-31"]).toBe("DE812345678");
  });

  it("takes BT-110 in the invoice currency when the VAT accounting currency repeats it", () => {
    expect(readInvoiceXml(cii()).facts["BT-110"]).toBe(103.74);
  });

  it("passes every rule it checks, BR-DE-15 included", () => {
    const read = readInvoiceXml(cii());
    expect(read.en16931?.checked).toContain("BR-DE-15");
    expect(read.en16931?.failed).toEqual([]);
  });

  it("names the rule and the figures when the totals do not add up", () => {
    const read = readInvoiceXml(cii({ dueTotal: "700.00" }));
    expect(read.en16931?.failed).toEqual([{ rule: "BR-CO-16", detail: "BT-115 700.00, expected 649.74" }]);
    expect(formatFacts(read)).toEqual({
      "intake.format": "xrechnung",
      "en16931.checked": true,
      "en16931.failures": "BR-CO-16",
    });
  });

  it("checks BR-DE-15 only on an XRechnung", () => {
    expect(readInvoiceXml(cii({ buyerReference: false })).en16931?.failed).toEqual([{ rule: "BR-DE-15" }]);
    const plain = readInvoiceXml(cii({ buyerReference: false, spec: "urn:cen.eu:en16931:2017" }));
    expect(plain.format).toBe("en16931");
    expect(plain.en16931?.checked).not.toContain("BR-DE-15");
    expect(plain.en16931?.failed).toEqual([]);
  });

  it("recognises Factur-X MINIMUM and does not check it against EN 16931", () => {
    const read = readInvoiceXml(cii({ spec: "urn:factur-x.eu:1p0:minimum" }));
    expect(read.format).toBe("factur_x_minimum");
    expect(read.en16931).toBeNull();
    expect(formatFacts(read)).toEqual({
      "intake.format": "factur_x_minimum",
      "en16931.checked": false,
      "en16931.failures": "",
    });
  });

  it("refuses a CII credit note in words", () => {
    expect(() => readInvoiceXml(cii({ typeCode: "381" }))).toThrow(InvoiceXmlError);
    expect(() => readInvoiceXml(cii({ typeCode: "381" }))).toThrow(/credit note \(type code 381\)/);
  });
});

describe("readInvoiceXml — what is not read", () => {
  it("refuses a UBL credit note in words rather than as 'no root <Invoice>'", () => {
    const xml = `<?xml version="1.0"?><CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"><ID>1</ID></CreditNote>`;
    expect(() => readInvoiceXml(xml)).toThrow(/credit note, and credit notes are not read yet/);
  });

  it("refuses ZUGFeRD 1.0, which predates EN 16931", () => {
    const xml = `<rsm:CrossIndustryDocument xmlns:rsm="urn:ferd:CrossIndustryDocument:invoice:1p0"/>`;
    expect(() => readInvoiceXml(xml)).toThrow(/ZUGFeRD 1\.0/);
  });

  it("still says what the UBL parser always said about something that is not an invoice", () => {
    expect(() => readInvoiceXml(`<Order><ID>1</ID></Order>`)).toThrow(/no root <Invoice>/);
  });
});

describe("rootElementOf", () => {
  it("skips a byte-order mark, the declaration and comments, and drops the prefix", () => {
    expect(rootElementOf(`\uFEFF<?xml version="1.0"?>\n<!-- x <Invoice> -->\n<rsm:CrossIndustryInvoice a="1">`)).toBe(
      "CrossIndustryInvoice"
    );
    expect(rootElementOf(`<Invoice>`)).toBe("Invoice");
    expect(rootElementOf(`not xml`)).toBeNull();
  });
});

describe("identifyFormat", () => {
  it.each([
    ["ubl", "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0", "peppol_bis_3"],
    ["ubl", "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0", "xrechnung"],
    ["cii", "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_2.3", "xrechnung"],
    ["cii", "urn:cen.eu:en16931:2017#conformant#urn:factur-x.eu:1p0:extended", "factur_x_extended"],
    ["cii", "urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:basic", "factur_x_basic"],
    ["cii", "urn:factur-x.eu:1p0:basicwl", "factur_x_basic_wl"],
    ["cii", "urn:zugferd.de:2p0:minimum", "factur_x_minimum"],
    ["cii", "urn:cen.eu:en16931:2017", "en16931"],
    ["ubl", "urn:cen.eu:en16931:2017", "en16931"],
    ["ubl", "urn:example:something-else", "ubl_other"],
    ["cii", undefined, "cii_other"],
  ] as const)("%s %s is %s", (syntax, spec, expected) => {
    expect(identifyFormat(syntax, spec)).toBe(expected);
  });
});

describe("checkEn16931 — the rules with no official unit test", () => {
  const complete = {
    "BT-1": "1", "BT-2": "2026-09-29", "BT-3": "380", "BT-5": "EUR", "BT-24": "urn:cen.eu:en16931:2017",
    "BT-27": "Seller", "BT-40": "DE", "BT-44": "Buyer", "BT-55": "GB",
    "BT-106": 100, "BT-109": 100, "BT-110": 20, "BT-112": 120, "BT-115": 120, "BT-9": "2026-10-29",
  };
  const line = { lineNumber: 1, "BT-126": "1", "BT-129": 1, "BT-130": "H87", "BT-131": 100, "BT-146": 100, "BT-153": "Item" };
  const addresses = { sellerAddress: true, buyerAddress: true };
  const rulesFailed = (facts: Record<string, unknown>) =>
    checkEn16931(facts as never, [line], addresses, { xrechnung: false }).failed.map((f) => f.rule);

  it("passes a complete invoice", () => {
    expect(rulesFailed(complete)).toEqual([]);
  });

  it("BR-CO-9: a VAT identifier starts with a country prefix, EL for Greece included", () => {
    expect(rulesFailed({ ...complete, "BT-31": "812345678" })).toEqual(["BR-CO-9"]);
    expect(rulesFailed({ ...complete, "BT-48": "gb123" })).toEqual(["BR-CO-9"]);
    expect(rulesFailed({ ...complete, "BT-31": "EL123456789" })).toEqual([]);
  });

  it("BR-CO-25: an amount due needs a due date or payment terms", () => {
    const noDue = Object.fromEntries(Object.entries(complete).filter(([k]) => k !== "BT-9"));
    expect(rulesFailed(noDue)).toEqual(["BR-CO-25"]);
    expect(rulesFailed({ ...noDue, "BT-20": "30 days" })).toEqual([]);
    expect(rulesFailed({ ...noDue, "BT-115": 0, "BT-112": 0, "BT-109": 0, "BT-110": 0, "BT-106": 0 })).toContain("BR-CO-10");
  });

  it("names the lines that miss a required term", () => {
    const failed = checkEn16931(complete as never, [line, { lineNumber: 2, "BT-131": 0 }], addresses, { xrechnung: false }).failed;
    expect(failed).toContainEqual({ rule: "BR-25", detail: "line 2" });
  });
});
