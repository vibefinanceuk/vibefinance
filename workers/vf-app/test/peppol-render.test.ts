import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { preferredDocumentType } from "../src/document-storage.js";
import { renderPeppolDocument } from "../src/peppol-render.js";

/**
 * Rendering a UBL invoice — decision 0205.
 *
 * **The design is OpenPEPPOL's and the traversal is ours**, because
 * their stylesheet is XSLT 2.0 and SaxonJS does not run in `workerd` —
 * proven, not assumed.
 */

const INVOICE = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>TEST-ORG-0001</cbc:ID>
  <cbc:IssueDate>2026-09-10</cbc:IssueDate>
  <cbc:DueDate>2026-10-10</cbc:DueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>GBP</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>ACME-UK-AP</cbc:BuyerReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cbc:EndpointID schemeID="0088">7300010000001</cbc:EndpointID>
    <cac:PartyName><cbc:Name>Northwind Logistics Ltd</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:StreetName>14 Dock Road</cbc:StreetName>
      <cbc:CityName>Felixstowe</cbc:CityName>
      <cbc:PostalZone>IP11 3TA</cbc:PostalZone>
      <cac:Country><cbc:IdentificationCode>GB</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>GB447711223</cbc:CompanyID></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyName><cbc:Name>Acme UK Limited</cbc:Name></cac:PartyName>
    <cac:PostalAddress>
      <cbc:CityName>London</cbc:CityName>
      <cac:Country><cbc:IdentificationCode>GB</cbc:IdentificationCode></cac:Country>
    </cac:PostalAddress>
    <cac:PartyTaxScheme><cbc:CompanyID>GB123456789</cbc:CompanyID></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="GBP">480.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="GBP">576.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="GBP">576.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">10</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="GBP">300.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Pallet handling</cbc:Name>
      <cac:ClassifiedTaxCategory><cbc:ID>S</cbc:ID><cbc:Percent>20</cbc:Percent></cac:ClassifiedTaxCategory>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="GBP">30.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
  <cac:InvoiceLine>
    <cbc:ID>2</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">6</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="GBP">180.00</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Delivery cartage</cbc:Name></cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="GBP">30.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>`;

describe("what it renders", () => {
  it("renders in the Worker runtime at all", () => {
    // **The question SaxonJS failed.** `DOMParser` is available in
    // `workerd`; a 2.3MB XSLT processor was not.
    const result = renderPeppolDocument(INVOICE);
    expect(result.html).not.toBeNull();
    expect(result.reason).toBeNull();
  });

  it("expands a document type code", () => {
    // `380` means something, and OpenPEPPOL's own list says what.
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("Commercial invoice");
  });

  it("expands a country code", () => {
    // 249 countries, transcribed by script rather than by hand
    // (decision 0200's lesson).
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("United Kingdom");
  });

  it("names both parties", () => {
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("Northwind Logistics Ltd");
    expect(html).toContain("Acme UK Limited");
  });

  it("shows every line", () => {
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("Pallet handling");
    expect(html).toContain("Delivery cartage");
  });

  it("carries the official stylesheet's own CSS", () => {
    // **We own the presentation of nothing.** It is normalize.css and
    // Bootstrap's grid, which is why the markup uses `col-sm-6` and
    // friends rather than classes of our own.
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("normalize.css");
    expect(html).toContain("col-sm-6");
  });

  it("says what the page is, with the document's own identifier", () => {
    /**
     * **A notice saying *this is a rendering* without saying of what**
     * leaves somebody with nothing to ask for.
     */
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("Rendered automatically from the XML source received");
    expect(html).toContain("Source document TEST-ORG-0001");
  });

  it("keeps the notice when printed", () => {
    // The official footer is `display: none` on print, which is right
    // for a URN and exactly wrong for this.
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("display: block !important");
  });
});

describe("what it refuses", () => {
  /**
   * **A refusal is a first-class output** (decision 0033), and a blank
   * iframe is not an explanation.
   */
  it("refuses something that is not XML", () => {
    const result = renderPeppolDocument("this is not xml at all");
    expect(result.html).toBeNull();
    expect(result.reason).toBe("not_xml");
  });

  it("refuses XML that is not an invoice", () => {
    const result = renderPeppolDocument("<order><id>1</id></order>");
    expect(result.reason).toBe("not_an_invoice");
  });

  it("refuses an invoice from another profile", () => {
    /**
     * **The same guard the official stylesheet applies.** An EN 16931
     * document from a different customization would lay out wrongly
     * rather than usefully.
     */
    const other = INVOICE.replace(
      "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0",
      "urn:something:else"
    );
    const result = renderPeppolDocument(other);
    expect(result.reason).toBe("not_peppol");
  });
});

describe("escaping", () => {
  it("escapes a supplier's own text", () => {
    /**
     * **The XSLT processor did this by construction**, and a
     * string-building renderer has to do it deliberately — which is the
     * one real risk of writing our own.
     */
    const nasty = INVOICE.replace(
      "Northwind Logistics Ltd",
      "Northwind &lt;script&gt;alert(1)&lt;/script&gt; Ltd"
    );
    const { html } = renderPeppolDocument(nasty);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("a credit note", () => {
  it("renders one, with its own type list", () => {
    // The official stylesheet handles both, and so does this.
    const creditNote = INVOICE.replace(/Invoice/g, "CreditNote")
      .replace(/InvoiceLine/g, "CreditNoteLine")
      .replace("CreditNoteTypeCode>380", "CreditNoteTypeCode>381")
      .replace(/InvoicedQuantity/g, "CreditedQuantity");

    const result = renderPeppolDocument(creditNote);
    expect(result.reason).toBeNull();
    expect(result.html).toContain("Credit note");
  });
});

describe("the choice both routes make (decision 0205)", () => {
  /**
   * **The token names an invoice, not a document.**
   *
   * So `document-url` reports a content type and `/documents/:token`
   * serves bytes, and the two must pick the same file — or the viewer
   * chooses an `<img>` or an `<iframe>` for one and is handed another.
   *
   * Written as one helper for that reason, and this is what proves it
   * is used rather than described.
   */
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}')").run();
  });

  async function store(documentType: string, contentType: string) {
    await env.DB.prepare(
      `INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type)
       VALUES (?, 'inv-1', ?, ?, ?)`
    )
      .bind(crypto.randomUUID(), `k-${documentType}`, documentType, contentType)
      .run();
  }

  it("prefers a rendering to the original", async () => {
    await store("original", "application/xml");
    await store("generated_rendering", "text/html; charset=utf-8");

    const chosen = await preferredDocumentType(env.DB, "inv-1");
    expect(chosen?.documentType).toBe("generated_rendering");
    expect(chosen?.contentType).toContain("text/html");
  });

  it("falls back to the original where there is no rendering", async () => {
    // Which is every photograph and every PDF — most documents.
    await store("original", "image/jpeg");

    const chosen = await preferredDocumentType(env.DB, "inv-1");
    expect(chosen?.documentType).toBe("original");
  });

  it("says nothing where nothing is retained", async () => {
    // An invoice can exist with no original at all — a real state
    // rather than a failure.
    expect(await preferredDocumentType(env.DB, "inv-1")).toBeNull();
  });

  it("does not depend on which was stored first", async () => {
    // **`uploaded_at` would**, and it is the same second in a test —
    // decision 0152's finding that same-second timestamps fall back to
    // insertion order, which is not a rule anybody could state.
    await store("generated_rendering", "text/html; charset=utf-8");
    await store("original", "application/xml");

    const chosen = await preferredDocumentType(env.DB, "inv-1");
    expect(chosen?.documentType).toBe("generated_rendering");
  });
});

describe("it renders on a page (decision 0206)", () => {
  /**
   * **Neither stylesheet defined one.** The markup carries a
   * `"document"` class and no rule ever matched it, so the rendering
   * filled whatever width it was given — in an iframe beside a keying
   * form, a wall of text rather than a document somebody could have
   * received.
   */
  it("is A4 portrait", () => {
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("size: A4 portrait");
    expect(html).toContain("width: 210mm");
  });

  it("grows rather than cutting a long invoice", () => {
    // **A minimum, not a height.** A fixed one would hide the second
    // page of a two-page invoice, which is the opposite of the point.
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("min-height: 297mm");
    expect(html).not.toMatch(/\.document\s*\{[^}]*[^-]height:\s*297mm/);
  });

  it("drops the screen furniture when printed", () => {
    // The border, the shadow and the grey behind it are for a screen;
    // on paper the margins come from the page rule.
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("@media print");
    expect(html).toContain("box-shadow: none");
  });
});

describe("a long invoice over several pages (decision 0206)", () => {
  /**
   * **Twenty lines is two pages**, and a browser given no instruction
   * breaks wherever it runs out of paper — which can be halfway through
   * a line, leaving a description on one page and its amount on the
   * next.
   *
   * That is not a formatting blemish. It reads as two entries, one of
   * which has no money against it.
   */
  const LONG = INVOICE.replace(
    /<cac:InvoiceLine>[\s\S]*<\/cac:InvoiceLine>/,
    Array.from({ length: 20 }, (_, i) => `<cac:InvoiceLine>
      <cbc:ID>${i + 1}</cbc:ID>
      <cbc:InvoicedQuantity unitCode="C62">${i + 1}</cbc:InvoicedQuantity>
      <cbc:LineExtensionAmount currencyID="GBP">${(i + 1) * 30}.00</cbc:LineExtensionAmount>
      <cac:Item><cbc:Name>Line item ${i + 1}</cbc:Name></cac:Item>
      <cac:Price><cbc:PriceAmount currencyID="GBP">30.00</cbc:PriceAmount></cac:Price>
    </cac:InvoiceLine>`).join("\n")
  );

  it("renders every line, not a page's worth", () => {
    const { html } = renderPeppolDocument(LONG);
    expect((html?.match(/class="line"/g) ?? []).length).toBe(20);
    expect(html).toContain("Line item 20");
  });

  it("refuses to break a line across pages", () => {
    const { html } = renderPeppolDocument(LONG);
    expect(html).toContain("page-break-inside: avoid");
  });

  it("refuses to orphan a heading at the foot of a page", () => {
    const { html } = renderPeppolDocument(LONG);
    expect(html).toContain("page-break-after: avoid");
  });

  it("keeps the provenance notice whole", () => {
    // **Half a notice says half of what it means.**
    const { html } = renderPeppolDocument(LONG);
    const printBlock = html?.slice(html.indexOf("@media print"));
    expect(printBlock).toContain("#rendering-notice");
  });
});

describe("sized for a page (decision 0206)", () => {
  it("sets body text smaller than Bootstrap's default", () => {
    // **Two points is about fifteen percent more invoice on a page**,
    // which on a twenty-line document is two pages rather than three.
    const { html } = renderPeppolDocument(INVOICE);
    expect(html).toContain("font-size: 12px");
  });

  it("measures the document in one unit", () => {
    /**
     * **The imported CSS is entirely px**, and one document measured in
     * two units is one nobody can reason about — decision 0031's
     * argument about a vocabulary having one source, applied to a
     * stylesheet.
     *
     * `mm` is the exception and deliberately so: a page's size is a
     * physical fact, not a typographic one.
     */
    const { html } = renderPeppolDocument(INVOICE);
    const ours = html?.slice(html.indexOf("A page, because an invoice is one"));
    expect(ours).not.toMatch(/font-size:\s*\d+pt/);
    expect(ours).not.toMatch(/margin:\s*\d+em/);
  });
});
