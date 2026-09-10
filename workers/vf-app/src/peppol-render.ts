import { XMLParser, XMLValidator } from "fast-xml-parser";
import { CODE_LISTS, LABELS, PEPPOL_CSS, type PeppolLanguage } from "./peppol-render-data.js";

/**
 * Rendering a UBL invoice as the document a person expects to see —
 * decision 0205.
 *
 * **The design is OpenPEPPOL's and the traversal is ours.** Their
 * stylesheet is XSLT 2.0; browsers implement 1.0, and SaxonJS — the
 * only viable processor — does not run in `workerd`, which was proven
 * rather than assumed: `ReferenceError: abstractNode is not defined`,
 * on import, before any transform.
 *
 * So this emits the same markup with their CSS, their code lists and
 * their labels. **We own the presentation of nothing.**
 *
 * Rendered **once at capture** and stored beside the original, so the
 * viewer costs nothing at runtime — and so that what a person saw when
 * they approved an invoice is a record rather than something recomputed
 * later from a stylesheet that may have changed.
 */

/**
 * **`fast-xml-parser`, not `DOMParser`.**
 *
 * `workerd` has no DOM. Decision 0018's UBL parser reached the same
 * conclusion and this uses the same library with the same settings —
 * `removeNSPrefix`, so `cbc:ID` and `cac:Party` are read as `ID` and
 * `Party` and the namespaces stop being ceremony.
 *
 * A second parser would be a second set of quirks to learn.
 */
export interface RenderResult {
  html: string | null;
  /**
   * Why nothing was rendered, where nothing was. **A refusal is a
   * first-class output** (decision 0033), and a blank iframe is not an
   * explanation.
   */
  reason: "not_xml" | "not_an_invoice" | "not_peppol" | null;
}

/**
 * Escaped, because a supplier's name is somebody else's text.
 *
 * **An XSLT processor did this by construction** and a string-building
 * renderer has to do it deliberately — which is the one real risk of
 * writing our own, and the reason it is a single function every value
 * passes through.
 */
function esc(value: string | null | undefined): string {
  if (value === null || value === undefined) return "";
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A label in the reader's own language, falling back to English. */
function label(group: string, key: string, lang: PeppolLanguage): string {
  const entry = LABELS[group]?.[key];
  return entry?.[lang] ?? entry?.en ?? key;
}

/** A code's meaning — `380` as *Commercial invoice*, `GB` as a country. */
function codeMeaning(list: string, code: string, lang: PeppolLanguage): string {
  const entry = CODE_LISTS[list]?.[code];
  return entry?.[lang] ?? entry?.en ?? code;
}

type Node = Record<string, unknown>;

/** A child element, or null. Arrays appear where UBL repeats. */
function one(node: Node | null | undefined, name: string): Node | null {
  if (!node) return null;
  const value = node[name];
  if (value === undefined || value === null) return null;
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" ? (first as Node) : ({ "#text": first } as Node);
}

/**
 * The text of a child element.
 *
 * **`fast-xml-parser` collapses an element with no attributes to a bare
 * value** and keeps `#text` where there are attributes — so both shapes
 * have to be read, and a caller should not have to know which it got.
 */
function value(node: Node | null | undefined, name: string): string | null {
  if (!node) return null;
  const raw = node[name];
  if (raw === undefined || raw === null) return null;

  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === null || first === undefined) return null;
  if (typeof first === "object") {
    const text = (first as Node)["#text"];
    return text === undefined || text === null ? null : String(text).trim();
  }
  return String(first).trim();
}

/** An attribute, which the parser prefixes with `@_`. */
function attribute(node: Node | null | undefined, name: string, attr: string): string | null {
  const el = one(node, name);
  const raw = el?.[`@_${attr}`];
  return raw === undefined || raw === null ? null : String(raw);
}

/** Every child of a repeating element, however many there are. */
function many(node: Node | null | undefined, name: string): Node[] {
  if (!node) return [];
  const raw = node[name];
  if (raw === undefined || raw === null) return [];
  return (Array.isArray(raw) ? raw : [raw]).filter(
    (v): v is Node => typeof v === "object" && v !== null
  );
}

/** A party — supplier or customer — as the stylesheet lays one out. */
function renderParty(party: Node | null, heading: string, lang: PeppolLanguage): string {
  if (!party) return "";

  const name =
    value(one(party, "PartyName"), "Name") ??
    value(one(party, "PartyLegalEntity"), "RegistrationName") ??
    "";

  const address = one(party, "PostalAddress");
  const country = value(one(address, "Country"), "IdentificationCode");

  const lines = [
    value(address, "StreetName"),
    value(address, "AdditionalStreetName"),
    [value(address, "PostalZone"), value(address, "CityName")].filter(Boolean).join(" "),
    country ? codeMeaning("iso3166", country, lang) : null,
  ].filter((l) => l && l.trim() !== "");

  const vat = value(one(party, "PartyTaxScheme"), "CompanyID");
  const endpoint = value(party, "EndpointID");

  return `<div class="col-sm-6">
  <h2>${esc(heading)}</h2>
  <div class="details">
    <div><strong>${esc(name)}</strong></div>
    ${lines.map((l) => `<div>${esc(l)}</div>`).join("\n    ")}
    ${vat ? `<div>${esc(label("party", "TaxId", lang))}: ${esc(vat)}</div>` : ""}
    ${endpoint ? `<div>${esc(label("party", "Endpoint", lang))}: ${esc(endpoint)}</div>` : ""}
  </div>
</div>`;
}

/**
 * One invoice line.
 *
 * **No language parameter**, because nothing on a line is a label or a
 * code: the item name is the supplier's own words, the unit code is
 * printed as given, and the VAT category is a letter. Taking one and
 * ignoring it would suggest a translation that does not happen.
 */
function renderLine(line: Node, currency: string): string {
  const item = one(line, "Item");
  const price = one(line, "Price");

  const quantity = value(line, "InvoicedQuantity") ?? value(line, "CreditedQuantity") ?? "";
  const unit =
    attribute(line, "InvoicedQuantity", "unitCode") ??
    attribute(line, "CreditedQuantity", "unitCode") ??
    "";

  const taxCategory = one(item, "ClassifiedTaxCategory");

  return `<div class="line">
  <div class="col-sm-5">
    <strong>${esc(value(line, "ID") ?? "")}</strong>
    ${esc(value(item, "Name") ?? "")}
    ${
      value(item, "Description")
        ? `<div class="details">${esc(value(item, "Description"))}</div>`
        : ""
    }
  </div>
  <div class="col-sm-2 text-right amount">${esc(quantity)} ${esc(unit)}</div>
  <div class="col-sm-2 text-right amount">${esc(value(price, "PriceAmount") ?? "")} ${esc(currency)}</div>
  <div class="col-sm-3 text-right amount">
    ${esc(value(line, "LineExtensionAmount") ?? "")} ${esc(currency)}
    ${
      taxCategory
        ? `<div class="details">${esc(value(taxCategory, "ID") ?? "")} ${esc(
            value(taxCategory, "Percent") ?? ""
          )}%</div>`
        : ""
    }
  </div>
</div>`;
}

/**
 * Render a UBL invoice or credit note.
 *
 * @param lang the reader's language. **English and Norwegian**, which
 * is what OpenPEPPOL's own labels ship — a German customer gets English
 * rather than a half-translated page.
 */
export function renderPeppolDocument(xml: string, lang: PeppolLanguage = "en"): RenderResult {
  /**
   * **Validated before parsed**, because `fast-xml-parser` is lenient
   * and will happily read something that is not XML as a document with
   * one odd element — which would render as an empty invoice rather
   * than as a refusal.
   */
  if (XMLValidator.validate(xml) !== true) {
    return { html: null, reason: "not_xml" };
  }

  let parsed: Node;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(xml) as Node;
  } catch {
    return { html: null, reason: "not_xml" };
  }

  const isCreditNote = "CreditNote" in parsed;
  const root = one(parsed, isCreditNote ? "CreditNote" : "Invoice");
  if (!root) {
    return { html: null, reason: "not_an_invoice" };
  }

  /**
   * **The same guard the official stylesheet applies.** It matches on a
   * `CustomizationID` beginning with the Peppol BIS Billing 3.0 URN, and
   * a document without one is not what this renders — an EN 16931
   * invoice from another profile would lay out wrongly rather than
   * usefully.
   */
  const customization = value(root, "CustomizationID") ?? "";
  if (!customization.includes("urn:cen.eu:en16931:2017")) {
    return { html: null, reason: "not_peppol" };
  }

  const currency = value(root, "DocumentCurrencyCode") ?? "";
  const typeCode =
    value(root, "InvoiceTypeCode") ?? value(root, "CreditNoteTypeCode") ?? "";
  const typeName = codeMeaning(isCreditNote ? "uncl1001-cn" : "uncl1001invoice", typeCode, lang);

  const supplier = one(one(root, "AccountingSupplierParty"), "Party");
  const customer = one(one(root, "AccountingCustomerParty"), "Party");
  const totals = one(root, "LegalMonetaryTotal");

  const lines = many(root, isCreditNote ? "CreditNoteLine" : "InvoiceLine");

  const metadata: [string, string | null][] = [
    [label("metadata", "ID", lang), value(root, "ID")],
    [label("metadata", "BuyerReference", lang), value(root, "BuyerReference")],
    [label("metadata", "IssueDate", lang), value(root, "IssueDate")],
    [label("metadata", "DueDate", lang), value(root, "DueDate")],
    [label("metadata", "Currency", lang), currency],
  ];

  const amounts: [string, string | null][] = [
    [label("total", "TaxExclusiveAmount", lang), value(totals, "TaxExclusiveAmount")],
    [label("total", "TaxInclusiveAmount", lang), value(totals, "TaxInclusiveAmount")],
    [label("total", "PayableAmount", lang), value(totals, "PayableAmount")],
  ];

  const html = `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(typeName)} ${esc(value(root, "ID") ?? "")}</title>
<style>${PEPPOL_CSS}</style>
<style>
  /*
    **A page, because an invoice is one** — decision 0206.

    Neither the official stylesheet nor ours defined a page: the markup
    carries a "document" class and no rule ever matched it, so the
    rendering filled whatever width it was given. In an iframe beside a
    keying form that reads as a wall of text rather than as a document
    somebody could have received.

    A4 portrait, because that is what an invoice is printed on
    everywhere this product operates. The width is fixed and the height
    is a **minimum** — a two-page invoice grows rather than being cut,
    which is the opposite of what a fixed height would do.
  */
  body {
    background: #e9e9e9;
    margin: 0;
    padding: 12px;
  }
  .document {
    box-sizing: border-box;
    width: 210mm;
    min-height: 297mm;
    max-width: 100%;
    margin: 0 auto;
    padding: 15mm;
    background: #fff;
    border: 1px solid #ccc;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }

  /*
    **Headings sized for a page, not for a web page** — decision 0206.

    The imported CSS is Bootstrap's, where an h1 is 36px and an h2 is
    30px. That is right for a browser at arm's length and wrong on A4
    beside a keying form: "Supplier" and "Customer" arrived larger than
    anything on a real invoice, and the document read as a heading with
    some details attached.

    An invoice's own hierarchy is shallow — a title, then quiet section
    labels — so the section headings are barely larger than the text
    they introduce, and separated by weight and space rather than size.
  */
  /*
    **12px, not Bootstrap's 14** — decision 0206.

    Two points of body text is about fifteen percent more invoice on a
    page, which on a twenty-line document is the difference between two
    pages and three.

    In px because the imported CSS is entirely in px, and one document
    measured in two units is one nobody can reason about — the same
    argument decision 0031 makes about a vocabulary having one source.
  */
  .document {
    font-size: 12px;
    line-height: 1.45;
  }

  .document h1 {
    font-size: 20px;
    font-weight: 600;
    margin: 0 0 14px;
  }
  .document h2 {
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #555;
    margin: 16px 0 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid #ddd;
  }

  /*
    **An amount is one thing and should not break in half** — decision
    0206.

    The line grid was 6-2-2-2, and at 210mm the last column is about
    30mm — enough for "300.00" and not for "300.00 GBP" with a tax rate
    beneath it. So a currency wrapped onto its own line and the rate
    followed, and a reader had to reassemble a number that was never
    two things.

    The description gives up a column and the amount takes it, and every
    numeric cell refuses to wrap at all: **a number that does not fit is
    better clipped than silently rearranged**, because the second looks
    like data.
  */
  .document .amount {
    white-space: nowrap;
  }
  .document .amount .details {
    white-space: normal;
  }

  /*
    **Printed, the page is the paper.** The border, the shadow and the
    grey behind it are all screen furniture — on paper the margins come
    from @page and the rest would only waste ink.
  */
  @page {
    size: A4 portrait;
    margin: 15mm;
  }
  @media print {
    body { background: #fff; padding: 0; }

    /*
      **Where a page may break** — decision 0206.

      Twenty lines is two pages, and a browser given no instruction
      breaks wherever it runs out of paper — which can be halfway
      through a line, leaving a description on one page and its amount
      on the next. That is not a formatting blemish: it reads as two
      entries, one of which has no money against it.

      A section heading alone at the foot of a page is the same fault
      in miniature, and a provenance notice split in half says half of
      what it means.
    */
    .line { page-break-inside: avoid; break-inside: avoid; }
    .document h1, .document h2 { page-break-after: avoid; break-after: avoid; }
    #rendering-notice { page-break-inside: avoid; break-inside: avoid; }
    .document {
      width: auto;
      min-height: 0;
      margin: 0;
      padding: 0;
      border: none;
      box-shadow: none;
    }
  }

  /*
    **What this page is**, and it survives printing — decision 0205.

    The official stylesheet hides its footer when printed, which is
    right for a customization URN and exactly wrong for this: a printed
    copy that does not say it is a rendering is one somebody will take
    for the original.
  */
  #rendering-notice {
    border: 1px solid #999; background: #f4f4f4;
    padding: 6pt 8pt; margin: 15pt 0 5pt; font-size: 85%;
  }
  @media print {
    #rendering-notice {
      display: block !important;
      background: #f4f4f4 !important;
      -webkit-print-color-adjust: exact;
    }
  }
</style>
</head>
<body>
<div class="document">
  <h1>${esc(typeName)}</h1>

  <div class="row">
    ${renderParty(supplier, label("party", "Supplier", lang), lang)}
    ${renderParty(customer, label("party", "Customer", lang), lang)}
  </div>

  <div class="row">
    <div class="info col-sm-6">
      <h2>${esc(label("metadata", "Metadata", lang))}</h2>
      ${metadata
        .filter(([, v]) => v)
        .map(([k, v]) => `<div><span class="details">${esc(k)}</span> ${esc(v)}</div>`)
        .join("\n      ")}
    </div>
    <div class="info col-sm-6">
      <h2>${esc(label("total", "Totals", lang))}</h2>
      ${amounts
        .filter(([, v]) => v)
        .map(
          ([k, v]) =>
            `<div><span class="details">${esc(k)}</span> ${esc(v)} ${esc(currency)}</div>`
        )
        .join("\n      ")}
    </div>
  </div>

  <h2>${esc(label("line", "Lines", lang))}</h2>
  ${lines.map((l: Node) => renderLine(l, currency)).join("\n  ")}

  <div id="rendering-notice">
    <strong>Rendered automatically from the XML source received.</strong>
    ${
      value(root, "ID")
        ? `Source document ${esc(value(root, "ID"))}.`
        : ""
    }
    The XML is the original; this page is a view of it.
  </div>

  <div id="footer">
    <div>${esc(customization)}</div>
    <div>${esc(value(root, "ProfileID") ?? "")}</div>
  </div>
</div>
</body>
</html>`;

  return { html, reason: null };
}
