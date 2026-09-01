import { describe, expect, it } from "vitest";
import { UblParseError, parseUblInvoice } from "./ubl-parser.js";

/**
 * A genuine, well-formed Peppol BIS Billing 3.0 sample — the real
 * namespace URIs, the real element structure, two real invoice lines.
 * Not a synthetic shortcut: this is what an actual UBL invoice
 * document looks like.
 */
const SAMPLE_UBL_INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-2026-0042</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DueDate>2026-08-31</cbc:DueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PostalAddress>
        <cac:Country>
          <cbc:IdentificationCode>DE</cbc:IdentificationCode>
        </cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>DE123456789</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>FR987654321</cbc:CompanyID>
        <cac:TaxScheme>
          <cbc:ID>VAT</cbc:ID>
        </cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">1500.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">1500.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">1785.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">1785.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">5</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="EUR">500.00</cbc:LineExtensionAmount>
  </cac:InvoiceLine>
</Invoice>`;

describe("parseUblInvoice — a genuine, well-formed sample", () => {
  it("extracts every header field this codebase's own vocabulary declares", () => {
    const { facts } = parseUblInvoice(SAMPLE_UBL_INVOICE);
    expect(facts).toEqual({
      "BT-1": "INV-2026-0042",
      "BT-2": "2026-08-01",
      "BT-5": "EUR",
      "BT-9": "2026-08-31",
      "BT-31": "DE123456789",
      "BT-40": "DE",
      "BT-48": "FR987654321",
      "BT-112": 1785,
    });
  });

  it("extracts both lines, each with its own real lineNumber, quantity, and net amount", () => {
    const { lines } = parseUblInvoice(SAMPLE_UBL_INVOICE);
    expect(lines).toEqual([
      { lineNumber: 1, "BT-129": 10, "BT-131": 1000 },
      { lineNumber: 2, "BT-129": 5, "BT-131": 500 },
    ]);
  });
});

describe("parseUblInvoice — a single line, not an array", () => {
  const SINGLE_LINE = SAMPLE_UBL_INVOICE.replace(
    /<cac:InvoiceLine>[\s\S]*<\/cac:InvoiceLine>\s*<cac:InvoiceLine>[\s\S]*?<\/cac:InvoiceLine>/,
    `<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity>3</cbc:InvoicedQuantity><cbc:LineExtensionAmount>300.00</cbc:LineExtensionAmount></cac:InvoiceLine>`
  );

  it("a document with exactly one line still produces a real array of length one, not a bare object", () => {
    const { lines } = parseUblInvoice(SINGLE_LINE);
    expect(lines).toEqual([{ lineNumber: 1, "BT-129": 3, "BT-131": 300 }]);
  });
});

describe("parseUblInvoice — a genuinely thin document, missing optional fields", () => {
  const THIN = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">INV-THIN</cbc:ID>
</Invoice>`;

  it("a missing OPTIONAL field is never an error — it's simply absent from the result, matching decision 0029's content-agnostic philosophy", () => {
    const { facts, lines } = parseUblInvoice(THIN);
    expect(facts).toEqual({ "BT-1": "INV-THIN" });
    expect(lines).toEqual([]);
  });
});

describe("parseUblInvoice — genuine structural failures", () => {
  it("refuses XML that is not well-formed at all", () => {
    expect(() => parseUblInvoice("<Invoice><ID>unclosed")).toThrow(UblParseError);
  });

  it("refuses a well-formed XML document that has no root <Invoice> element — this isn't a UBL invoice at all", () => {
    expect(() => parseUblInvoice("<SomethingElse><ID>1</ID></SomethingElse>")).toThrow(UblParseError);
  });

  it("refuses plain, non-XML text", () => {
    expect(() => parseUblInvoice("this is not xml at all")).toThrow(UblParseError);
  });
});

describe("parseUblInvoice — a party with more than one PartyTaxScheme (the real spec's own worked example, docs.peppol.eu §11.1.1)", () => {
  // A seller carrying BOTH a VAT scheme and a separate general tax
  // registration scheme — genuinely valid per the real specification,
  // not a synthetic edge case. Caught a real bug in a first version
  // of this parser, which assumed a single PartyTaxScheme element.
  const TWO_TAX_SCHEMES = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-TWO-SCHEMES</cbc:ID>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>GB76576657</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
      <cac:PartyTaxScheme>
        <cbc:CompanyID>TaxRegistrationID</cbc:CompanyID>
        <cac:TaxScheme><cbc:ID>TAX</cbc:ID></cac:TaxScheme>
      </cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
</Invoice>`;

  it("finds the genuine VAT scheme's CompanyID, not the general tax registration one, and not undefined", () => {
    const { facts } = parseUblInvoice(TWO_TAX_SCHEMES);
    expect(facts["BT-31"]).toBe("GB76576657");
  });

  it("a single PartyTaxScheme (the common case) still works exactly as before — not broken by the fix", () => {
    const { facts } = parseUblInvoice(SAMPLE_UBL_INVOICE);
    expect(facts["BT-31"]).toBe("DE123456789");
  });
});
