/**
 * **A Peppol BIS Billing 3.0 invoice — decision 0727.** What the network's
 * Create form makes: the totals, the rules it must pass before it can be
 * sent, and the UBL 2.1 XML itself.
 *
 * Pure functions on a plain model, with no page and no network, so the
 * page, the network's tests and the customer's instance's tests (which
 * read what this writes) all use the same code.
 *
 * The model:
 *   { number, issueDate, dueDate, currency, typeCode, purchaseOrder,
 *     buyerReference, paymentTerms, note,
 *     seller: { name, vatId, endpoint, addressLine, city, postalCode, country },
 *     buyer:  { name, vatId, endpoint, addressLine, city, postalCode, country },
 *     account: { means, identifier, name } | null,
 *     exemptionReason,
 *     lines: [{ description, poLine, quantity, unitCode, unitPrice, vatCategory, vatRate }],
 *     attachment: { filename, mimeType, base64 } | null }
 *
 * The rules are a working subset of EN 16931 (BR-…) and the Peppol rules
 * (PEPPOL-EN16931-…): the ones a person filling the form can break. Each
 * failure names its rule, the field, and a string key for its words.
 */

export const CUSTOMIZATION_ID = "urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0";
export const PROFILE_ID = "urn:fdc:peppol.eu:2017:poacc:billing:01:1.0";

/** The VAT categories offered, with their EN 16931 codes (UNCL5305). */
export const VAT_CATEGORIES = ["S", "Z", "E", "AE"];

/** Units offered (UN/ECE Recommendation 20). */
export const UNITS = ["C62", "H87", "HUR", "DAY", "KGM", "MTR", "LTR", "SET"];

/**
 * A party's electronic address scheme when only its VAT number is known
 * (Peppol EAS codes for VAT numbers).
 */
const VAT_SCHEMES = { GB: "9932", DE: "9930", IE: "9935", FR: "9957", NL: "9944", BE: "9925", AT: "9914", ES: "9920", IT: "0211", DK: "9902", SE: "9955", NO: "9908", FI: "0213", PT: "9946", PL: "9945", LU: "9938" };

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));

/** A line's net amount: quantity × unit price, to the penny. */
export function lineNet(line) {
  const q = num(line.quantity);
  const p = num(line.unitPrice);
  return Number.isFinite(q) && Number.isFinite(p) ? round2(q * p) : 0;
}

/** The rate a line is taxed at: its own for Standard, nought for the others. */
function rateOf(line) {
  return line.vatCategory === "S" ? num(line.vatRate) : 0;
}

/**
 * The totals: each line's net, the VAT breakdown per category and rate
 * (BR-S-08, BR-S-09: VAT worked out on each group's total, not per line),
 * and the invoice's net, VAT and total.
 */
export function totals(model) {
  const lines = (model.lines ?? []).map(lineNet);
  const groups = new Map();
  (model.lines ?? []).forEach((line, i) => {
    const category = line.vatCategory || "S";
    const rate = rateOf(line);
    const key = `${category}|${Number.isFinite(rate) ? rate : 0}`;
    const g = groups.get(key) ?? { category, rate: Number.isFinite(rate) ? rate : 0, taxable: 0, tax: 0 };
    g.taxable = round2(g.taxable + lines[i]);
    groups.set(key, g);
  });
  const breakdown = [...groups.values()].map((g) => ({ ...g, tax: round2((g.taxable * g.rate) / 100) }));
  const net = round2(lines.reduce((a, b) => a + b, 0));
  const vat = round2(breakdown.reduce((a, g) => a + g.tax, 0));
  return { lines, breakdown, net, vat, total: round2(net + vat) };
}

/**
 * A party's VAT number with its country code: as kept, or, where a record
 * keeps only the digits (`111350965`), with its country's code in front
 * (`GB111350965`), as EN 16931 wants it (BR-CO-09).
 */
export function vatOf(party) {
  const vat = String(party?.vatId ?? "").replace(/[\s.-]/g, "").toUpperCase();
  if (!vat) return "";
  if (/^[A-Z]{2}/.test(vat)) return vat;
  const country = String(party?.country ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(country) ? `${country === "GR" ? "EL" : country}${vat}` : vat;
}

/** `scheme:id`, as the record keeps it, or the VAT number under its country's scheme. */
export function endpointOf(party) {
  const given = String(party?.endpoint ?? "").trim();
  const m = /^(\d{4}):(.+)$/.exec(given);
  if (m) return { scheme: m[1], id: m[2].trim() };
  const vat = vatOf(party);
  const scheme = VAT_SCHEMES[vat.slice(0, 2)];
  return vat && scheme ? { scheme, id: vat } : null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const blank = (v) => v === null || v === undefined || String(v).trim() === "";

/**
 * Everything wrong, in the order the form shows it. Empty when it may be
 * sent. Each: `{ rule, key, field, params? }` (`field` is a header field,
 * `seller`, `buyer`, `payment`, or `line:<index>:<column>`).
 */
export function validate(model) {
  const out = [];
  const fail = (rule, key, field, params) => out.push({ rule, key, field, ...(params ? { params } : {}) });

  // Decision 0732: a credit note (381) names the invoice it credits, and is not paid.
  const credit = isCreditNoteModel(model);
  if (blank(model.number)) fail("BR-02", "network.bis3.number", "number");
  if (credit && blank(model.precedingInvoice?.number)) fail("BR-55", "network.bis3.preceding", "precedingInvoice");
  if (!DATE.test(String(model.issueDate ?? ""))) fail("BR-03", "network.bis3.issuedate", "issueDate");
  if (!blank(model.dueDate) && !DATE.test(String(model.dueDate))) fail("BR-CO-25", "network.bis3.duedate", "dueDate");
  if (!/^[A-Z]{3}$/.test(String(model.currency ?? ""))) fail("BR-05", "network.bis3.currency", "currency");
  if (blank(model.buyerReference) && blank(model.purchaseOrder)) fail("PEPPOL-EN16931-R003", "network.bis3.reference", "buyerReference");

  const seller = model.seller ?? {};
  const buyer = model.buyer ?? {};
  if (blank(seller.name)) fail("BR-06", "network.bis3.sellername", "seller");
  if (blank(seller.country)) fail("BR-09", "network.bis3.sellercountry", "seller");
  if (!endpointOf(seller)) fail("PEPPOL-EN16931-R020", "network.bis3.sellerendpoint", "seller");
  if (!blank(seller.vatId) && !/^[A-Z]{2}/.test(vatOf(seller))) fail("BR-CO-09", "network.bis3.sellervat", "seller");
  if (blank(buyer.name)) fail("BR-07", "network.bis3.buyername", "buyer");
  if (blank(buyer.country)) fail("BR-11", "network.bis3.buyercountry", "buyer");
  if (!endpointOf(buyer)) fail("PEPPOL-EN16931-R010", "network.bis3.buyerendpoint", "buyer");

  const lines = model.lines ?? [];
  if (lines.length === 0) fail("BR-16", "network.bis3.nolines", "lines");
  lines.forEach((line, i) => {
    const n = { line: i + 1 };
    if (blank(line.description)) fail("BR-25", "network.bis3.linedescription", `line:${i}:description`, n);
    const q = num(line.quantity);
    if (!Number.isFinite(q) || q === 0) fail("BR-22", "network.bis3.linequantity", `line:${i}:quantity`, n);
    if (blank(line.unitCode)) fail("BR-23", "network.bis3.lineunit", `line:${i}:unitCode`, n);
    const p = num(line.unitPrice);
    if (!Number.isFinite(p) || p < 0) fail("BR-27", "network.bis3.lineprice", `line:${i}:unitPrice`, n);
    const category = line.vatCategory || "S";
    if (!VAT_CATEGORIES.includes(category)) fail("BR-CO-04", "network.bis3.linevat", `line:${i}:vatCategory`, n);
    if (category === "S" && !(num(line.vatRate) > 0)) fail("BR-S-05", "network.bis3.linerate", `line:${i}:vatRate`, n);
  });
  const categories = new Set(lines.map((l) => l.vatCategory || "S"));
  if ((categories.has("E") || categories.has("AE")) && blank(model.exemptionReason)) fail("BR-E-10", "network.bis3.exemption", "exemptionReason");
  if (categories.has("AE") && (blank(seller.vatId) || blank(buyer.vatId))) fail("BR-AE-03", "network.bis3.reversecharge", "buyer");

  const t = totals(model);
  if (!credit && t.total > 0 && blank(model.dueDate) && blank(model.paymentTerms)) fail("BR-CO-25", "network.bis3.dueorterms", "dueDate");
  if (!credit && model.account && blank(model.account.identifier)) fail("BR-61", "network.bis3.account", "payment");
  return out;
}

// ---------------------------------------------------------------------------
// The XML.
// ---------------------------------------------------------------------------

const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n) => round2(n).toFixed(2);
const qty = (n) => String(Number(n));
const el = (name, value, attrs = "") => (blank(value) ? "" : `<${name}${attrs}>${esc(value)}</${name}>`);

function party(p) {
  const ep = endpointOf(p);
  const address = [el("cbc:StreetName", p.addressLine), el("cbc:CityName", p.city), el("cbc:PostalZone", p.postalCode), `<cac:Country>${el("cbc:IdentificationCode", String(p.country ?? "").toUpperCase())}</cac:Country>`].join("");
  return [
    "<cac:Party>",
    ep ? `<cbc:EndpointID schemeID="${esc(ep.scheme)}">${esc(ep.id)}</cbc:EndpointID>` : "",
    `<cac:PostalAddress>${address}</cac:PostalAddress>`,
    blank(p.vatId) ? "" : `<cac:PartyTaxScheme>${el("cbc:CompanyID", vatOf(p))}<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>`,
    `<cac:PartyLegalEntity>${el("cbc:RegistrationName", p.name)}</cac:PartyLegalEntity>`,
    "</cac:Party>",
  ].join("");
}

function taxCategory(tag, category, rate, reason) {
  return [
    `<cac:${tag}>`,
    el("cbc:ID", category),
    `<cbc:Percent>${qty(rate)}</cbc:Percent>`,
    tag === "TaxCategory" && (category === "E" || category === "AE") ? el("cbc:TaxExemptionReason", reason) : "",
    "<cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme>",
    `</cac:${tag}>`,
  ].join("");
}

/** Decision 0732: a credit note, by its type code. */
export const isCreditNoteModel = (model) => String(model.typeCode ?? "") === "381";

/**
 * The invoice as Peppol BIS Billing 3.0 UBL — or, for type 381, the credit
 * note (decision 0732): a `CreditNote` root, `CreditNoteTypeCode`,
 * `CreditNoteLine`/`CreditedQuantity`, the invoice it credits as
 * `BillingReference`, and no due date or account to pay into. Call
 * `validate` first: this writes what it is given.
 */
export function toXml(model) {
  const credit = isCreditNoteModel(model);
  const root = credit ? "CreditNote" : "Invoice";
  const lineTag = credit ? "CreditNoteLine" : "InvoiceLine";
  const quantityTag = credit ? "CreditedQuantity" : "InvoicedQuantity";
  const t = totals(model);
  const cur = esc(model.currency);
  const amount = (name, n) => `<cbc:${name} currencyID="${cur}">${money(n)}</cbc:${name}>`;
  const account = credit ? null : model.account;
  const lines = (model.lines ?? []).map((line, i) =>
    [
      `<cac:${lineTag}>`,
      el("cbc:ID", String(i + 1)),
      `<cbc:${quantityTag} unitCode="${esc(line.unitCode || "C62")}">${qty(line.quantity)}</cbc:${quantityTag}>`,
      amount("LineExtensionAmount", t.lines[i]),
      blank(line.poLine) ? "" : `<cac:OrderLineReference>${el("cbc:LineID", line.poLine)}</cac:OrderLineReference>`,
      "<cac:Item>",
      el("cbc:Name", line.description),
      taxCategory("ClassifiedTaxCategory", line.vatCategory || "S", rateOf(line) || 0),
      "</cac:Item>",
      `<cac:Price>${amount("PriceAmount", num(line.unitPrice))}</cac:Price>`,
      `</cac:${lineTag}>`,
    ].join("")
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<${root} xmlns="urn:oasis:names:specification:ubl:schema:xsd:${root}-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">`,
    el("cbc:CustomizationID", CUSTOMIZATION_ID),
    el("cbc:ProfileID", PROFILE_ID),
    el("cbc:ID", model.number),
    el("cbc:IssueDate", model.issueDate),
    credit ? "" : el("cbc:DueDate", model.dueDate),
    credit ? el("cbc:CreditNoteTypeCode", "381") : el("cbc:InvoiceTypeCode", model.typeCode || "380"),
    el("cbc:Note", model.note),
    el("cbc:DocumentCurrencyCode", model.currency),
    el("cbc:BuyerReference", model.buyerReference),
    blank(model.purchaseOrder) ? "" : `<cac:OrderReference>${el("cbc:ID", model.purchaseOrder)}</cac:OrderReference>`,
    credit && !blank(model.precedingInvoice?.number)
      ? `<cac:BillingReference><cac:InvoiceDocumentReference>${el("cbc:ID", model.precedingInvoice.number)}${el("cbc:IssueDate", model.precedingInvoice.issueDate)}</cac:InvoiceDocumentReference></cac:BillingReference>`
      : "",
    model.attachment
      ? `<cac:AdditionalDocumentReference>${el("cbc:ID", model.attachment.filename)}<cac:Attachment><cbc:EmbeddedDocumentBinaryObject mimeCode="${esc(model.attachment.mimeType)}" filename="${esc(model.attachment.filename)}">${model.attachment.base64}</cbc:EmbeddedDocumentBinaryObject></cac:Attachment></cac:AdditionalDocumentReference>`
      : "",
    `<cac:AccountingSupplierParty>${party(model.seller ?? {})}</cac:AccountingSupplierParty>`,
    `<cac:AccountingCustomerParty>${party(model.buyer ?? {})}</cac:AccountingCustomerParty>`,
    account && !blank(account.identifier)
      ? `<cac:PaymentMeans>${el("cbc:PaymentMeansCode", account.means || "30")}<cac:PayeeFinancialAccount>${el("cbc:ID", String(account.identifier).replace(/\s/g, ""))}${el("cbc:Name", account.name)}</cac:PayeeFinancialAccount></cac:PaymentMeans>`
      : "",
    blank(model.paymentTerms) ? "" : `<cac:PaymentTerms>${el("cbc:Note", model.paymentTerms)}</cac:PaymentTerms>`,
    `<cac:TaxTotal>${amount("TaxAmount", t.vat)}${t.breakdown
      .map((g) => `<cac:TaxSubtotal>${amount("TaxableAmount", g.taxable)}${amount("TaxAmount", g.tax)}${taxCategory("TaxCategory", g.category, g.rate, model.exemptionReason)}</cac:TaxSubtotal>`)
      .join("")}</cac:TaxTotal>`,
    `<cac:LegalMonetaryTotal>${amount("LineExtensionAmount", t.net)}${amount("TaxExclusiveAmount", t.net)}${amount("TaxInclusiveAmount", t.total)}${amount("PayableAmount", t.total)}</cac:LegalMonetaryTotal>`,
    ...lines,
    `</${root}>`,
  ].join("");
}
