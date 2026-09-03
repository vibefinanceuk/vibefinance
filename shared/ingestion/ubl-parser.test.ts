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
      // The document totals, added once it emerged that validation's
      // vat_arithmetic and amount_due_mismatch checks had no inputs on
      // this path at all.
      "BT-106": 1500,
      "BT-112": 1785,
      "BT-115": 1785,
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

describe("parseUblInvoice — BT-133 (line accounting/cost centre reference)", () => {
  const WITH_ACCOUNTING_COST = `<?xml version="1.0"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-CC-1</cbc:ID>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:LineExtensionAmount>500.00</cbc:LineExtensionAmount>
    <cbc:AccountingCost>CC-200</cbc:AccountingCost>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:LineExtensionAmount>300.00</cbc:LineExtensionAmount>
  </cac:InvoiceLine>
</Invoice>`;

  it("extracts a real cost centre reference where present, and omits it where absent — never a false empty value", () => {
    const { lines } = parseUblInvoice(WITH_ACCOUNTING_COST);
    expect(lines[0]["BT-133"]).toBe("CC-200");
    expect(lines[1]["BT-133"]).toBeUndefined();
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

/**
 * A document using a VAT accounting currency — the case that makes
 * cac:TaxTotal repeat. Per Peppol BIS Billing 3.0 the element is 1..2:
 * "when tax currency code is provided, two instances of the tax total
 * must be present, but only one with tax subtotal". The second carries
 * BT-111, the same VAT expressed in the seller's accounting currency.
 */
const SAMPLE_WITH_ACCOUNTING_CURRENCY = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-CUR-1</cbc:ID>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cbc:TaxCurrencyCode>SEK</cbc:TaxCurrencyCode>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="SEK">3300.00</cbc:TaxAmount>
  </cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="EUR">285.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="EUR">1500.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="EUR">285.00</cbc:TaxAmount>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxInclusiveAmount currencyID="EUR">1785.00</cbc:TaxInclusiveAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;

describe("parseUblInvoice — the document totals validation depends on", () => {
  // Until these were mapped, vat_arithmetic and amount_due_mismatch
  // could not run on the UBL path at all: their inputs were never
  // populated. The most trustworthy path got the least validation.
  it("extracts BT-106, the sum of line net amounts", () => {
    expect(parseUblInvoice(SAMPLE_UBL_INVOICE).facts["BT-106"]).toBe(1500);
  });

  it("extracts BT-115, the amount due for payment", () => {
    expect(parseUblInvoice(SAMPLE_UBL_INVOICE).facts["BT-115"]).toBe(1785);
  });

  it("leaves them absent on a document that omits them", () => {
    // A missing OPTIONAL field is normal, not an error — the parser's
    // standing position.
    const thin = SAMPLE_UBL_INVOICE.replace(
      /<cbc:LineExtensionAmount currencyID="EUR">1500.00<\/cbc:LineExtensionAmount>/,
      ""
    );
    expect(parseUblInvoice(thin).facts["BT-106"]).toBeUndefined();
  });
});

describe("parseUblInvoice — BT-110 and the repeating TaxTotal", () => {
  it("takes the amount in the document currency, not the accounting currency", () => {
    // The trap: taking the first TaxTotal blindly returns BT-111 —
    // a wrong number, silently, on exactly the documents where a
    // second currency means the two differ.
    const facts = parseUblInvoice(SAMPLE_WITH_ACCOUNTING_CURRENCY).facts;
    expect(facts["BT-110"]).toBe(285);
    expect(facts["BT-110"]).not.toBe(3300);
  });

  it("handles the ordinary single TaxTotal", () => {
    const single = SAMPLE_UBL_INVOICE.replace(
      "<cac:LegalMonetaryTotal>",
      `<cac:TaxTotal><cbc:TaxAmount currencyID="EUR">285.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>`
    );
    expect(parseUblInvoice(single).facts["BT-110"]).toBe(285);
  });

  it("falls back to the instance carrying a TaxSubtotal when no currency attribute matches", () => {
    const noCurrencyAttrs = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-NOATTR</cbc:ID>
  <cac:TaxTotal><cbc:TaxAmount>3300.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:TaxTotal>
    <cbc:TaxAmount>285.00</cbc:TaxAmount>
    <cac:TaxSubtotal><cbc:TaxAmount>285.00</cbc:TaxAmount></cac:TaxSubtotal>
  </cac:TaxTotal>
</Invoice>`;
    expect(parseUblInvoice(noCurrencyAttrs).facts["BT-110"]).toBe(285);
  });

  it("is absent when the document carries no TaxTotal at all", () => {
    expect(parseUblInvoice(SAMPLE_UBL_INVOICE).facts["BT-110"]).toBeUndefined();
  });
});

describe("parseUblInvoice — the reference fields", () => {
  const withReferences = SAMPLE_UBL_INVOICE.replace(
    "<cbc:IssueDate>2026-08-01</cbc:IssueDate>",
    `<cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:BuyerReference>abs1234</cbc:BuyerReference>
  <cac:OrderReference><cbc:ID>98776</cbc:ID></cac:OrderReference>`
  );

  it("extracts BT-3, the invoice type code", () => {
    expect(parseUblInvoice(withReferences).facts["BT-3"]).toBe("380");
  });

  it("extracts BT-10, the buyer reference", () => {
    expect(parseUblInvoice(withReferences).facts["BT-10"]).toBe("abs1234");
  });

  it("extracts BT-13 from inside cac:OrderReference, not the document root", () => {
    expect(parseUblInvoice(withReferences).facts["BT-13"]).toBe("98776");
  });
});

describe("parseUblInvoice — BT-151 and BT-152 are line-level, not header", () => {
  const withLineVat = SAMPLE_UBL_INVOICE.replace(
    '<cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>',
    `<cbc:LineExtensionAmount currencyID="EUR">1000.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cac:ClassifiedTaxCategory>
        <cbc:ID>S</cbc:ID>
        <cbc:Percent>19</cbc:Percent>
      </cac:ClassifiedTaxCategory>
    </cac:Item>`
  );

  it("reads the VAT category and rate from the line's own Item", () => {
    // They read like header fields and are not: in UBL they live at
    // cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory.
    const parsed = parseUblInvoice(withLineVat);
    expect(parsed.lines[0]["BT-151"]).toBe("S");
    expect(parsed.lines[0]["BT-152"]).toBe(19);
  });

  it("does not put them on the document facts", () => {
    const parsed = parseUblInvoice(withLineVat);
    expect(parsed.facts["BT-151"]).toBeUndefined();
    expect(parsed.facts["BT-152"]).toBeUndefined();
  });

  it("leaves a line without tax category information alone", () => {
    const parsed = parseUblInvoice(withLineVat);
    expect(parsed.lines[1]["BT-151"]).toBeUndefined();
  });
});
