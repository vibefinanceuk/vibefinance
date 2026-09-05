import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { InvoiceFacts } from "../interpreter/types.js";

/**
 * Real document parsing — see docs/decisions/0030-ubl-invoice-parsing.md.
 * The one piece decision 0029's intake capture deliberately deferred:
 * everything downstream (storage, the workflow engine, analytics) was
 * already built and proven against already-extracted facts. This is
 * what actually extracts them from a real UBL 2.1 document — the
 * exact format Peppol BIS Billing 3.0 (AP/AR) and Peppol BIS
 * Self-Billing 3.0 (a formally-routed expense reimbursement, decision
 * 0026) both genuinely are, structurally identical documents.
 *
 * Deliberately narrow and correct rather than broad and shaky: maps
 * the fields this codebase's own closed vocabulary already declares
 * against their real, verified UBL paths — BT-1, BT-2, BT-3, BT-5,
 * BT-9, BT-10, BT-13, BT-31, BT-40, BT-48, BT-106, BT-110, BT-112,
 * BT-115, and each line's BT-129/BT-131/BT-133/BT-151/BT-152.
 * BG-20/BG-21 (allowances and charges) are genuinely more complex,
 * repeated, structurally nested groups — not a simple path-to-scalar
 * mapping — and are deliberately left out of this pass rather than
 * mapped approximately. A missing OPTIONAL field is normal, not an
 * error — decision 0029's own "Intake stays content-agnostic" holds
 * here too: a thin document still parses successfully into whatever
 * can genuinely be extracted, and Validate is still where thinness
 * gets caught, not this parser.
 *
 * Every mapping here was checked directly against the real Peppol
 * BIS Billing 3.0 documentation (docs.peppol.eu), not trusted from
 * memory alone — which surfaced a real bug before it shipped: the
 * spec's own worked example shows a party can carry more than one
 * PartyTaxScheme (a VAT scheme alongside a separate general tax
 * registration scheme). A first version of this parser assumed a
 * single element and would have silently failed to extract BT-31/
 * BT-48 for a document shaped exactly like that example.
 *
 * BT-133 (line accounting/cost centre reference, cbc:AccountingCost)
 * was added after decision 0028's own gap-hunting discipline was
 * applied to cost_centre: a real database column had existed since
 * decision 0017, but the field had never been added to
 * INVOICE_FIELDS at all — no invoice rule could ever reference it.
 * Verified against the real spec before adding it, the same
 * discipline as every other field here.
 *
 * Credit notes are a deliberate, explicit scope boundary, not an
 * oversight: they use an entirely different root element
 * (<CreditNote>, with CreditNoteLine/CreditedQuantity rather than
 * InvoiceLine/InvoicedQuantity), confirmed directly against the spec.
 * This parser only handles <Invoice> and correctly refuses a
 * CreditNote document rather than silently misreading it as one.
 */

export class UblParseError extends Error {}

export interface ParsedUblInvoice {
  facts: InvoiceFacts;
  lines: Array<InvoiceFacts & { lineNumber: number }>;
}

/**
 * An XML **attribute**, which several BIS 3.0 business terms are —
 * decision 0110.
 *
 * `cbc:InvoicedQuantity/@unitCode` is mandatory and carries BT-130, and
 * `@currencyID` carries the currency of every amount. Reading only
 * elements misses them entirely, which is how a quantity ended up in
 * the vocabulary with no unit beside it.
 *
 * The parser runs with `ignoreAttributes: false` and the default `@_`
 * prefix, so an attribute appears as a sibling key of `#text`.
 */
function getAttribute(value: unknown, name: string): string | undefined {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  const raw = (value as Record<string, unknown>)[`@_${name}`];
  return raw === undefined || raw === null ? undefined : String(raw);
}

function getText(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "#text" in (value as Record<string, unknown>)) {
    return getText((value as Record<string, unknown>)["#text"]);
  }
  return undefined;
}

/**
 * A party can carry more than one PartyTaxScheme — the real spec's
 * own worked example (docs.peppol.eu, §11.1.1) shows a VAT scheme
 * alongside a separate general tax registration scheme on the same
 * party. A single PartyTaxScheme is assumed to be the VAT one (the
 * common case); once there's more than one, the entry whose own
 * TaxScheme/ID is genuinely "VAT" is the one BT-31/BT-48 actually
 * mean — found by checking against the real spec's example, not
 * assumed from memory, after the earlier, single-element-only version
 * of this parser would have silently failed to extract either field
 * for a document shaped exactly like that example.
 */
function findVatSchemeCompanyId(partyTaxScheme: unknown): string | undefined {
  if (partyTaxScheme === undefined || partyTaxScheme === null) return undefined;
  const schemes = Array.isArray(partyTaxScheme) ? partyTaxScheme : [partyTaxScheme];
  if (schemes.length === 1) {
    return getText((schemes[0] as Record<string, unknown>)?.CompanyID);
  }
  const vatScheme = schemes.find((s) => {
    const taxScheme = (s as Record<string, unknown>)?.TaxScheme as Record<string, unknown> | undefined;
    return getText(taxScheme?.ID) === "VAT";
  });
  return getText((vatScheme as Record<string, unknown> | undefined)?.CompanyID);
}

/**
 * BT-110, the invoice total VAT amount — and the one mapping here with
 * a real trap in it.
 *
 * cac:TaxTotal has cardinality 1..2 in Peppol BIS Billing 3.0, not 1..1:
 * "when tax currency code is provided, two instances of the tax total
 * must be present, but only one with tax subtotal". The second carries
 * BT-111, the same VAT total expressed in the seller's accounting
 * currency. Taking the first TaxTotal blindly would therefore return
 * BT-111 rather than BT-110 on any invoice using a VAT accounting
 * currency — a wrong number, silently, on exactly the documents where
 * a second currency means the amounts differ.
 *
 * Resolved by the spec's own two discriminators, in order: the
 * TaxAmount's mandatory @currencyID must be BT-5 for BT-110, and only
 * the BT-110 instance carries a TaxSubtotal.
 *
 * The same shape of bug the PartyTaxScheme handling above already
 * records: a element the spec allows to repeat, assumed singular.
 */
function findDocumentCurrencyTaxAmount(taxTotal: unknown, documentCurrency: string | undefined): number | undefined {
  if (taxTotal === undefined || taxTotal === null) return undefined;
  const totals = Array.isArray(taxTotal) ? taxTotal : [taxTotal];
  if (totals.length === 0) return undefined;

  const candidates = totals.filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null);

  if (documentCurrency !== undefined) {
    const matching = candidates.find((t) => {
      const amount = t.TaxAmount as Record<string, unknown> | undefined;
      const currencyId = amount?.["@_currencyID"];
      return typeof currencyId === "string" && currencyId === documentCurrency;
    });
    if (matching !== undefined) return getNumber(matching.TaxAmount);
  }

  // No usable currency attribute — fall back to the instance carrying a
  // TaxSubtotal, which the spec says is the BT-110 one.
  const withSubtotal = candidates.find((t) => t.TaxSubtotal !== undefined);
  if (withSubtotal !== undefined) return getNumber(withSubtotal.TaxAmount);

  return getNumber(candidates[0]?.TaxAmount);
}

function getNumber(value: unknown): number | undefined {
  const text = getText(value);
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isNaN(n) ? undefined : n;
}

/**
 * Parses a real UBL 2.1 invoice document into this system's own facts
 * shape — the same shape POST /invoices and intake capture already
 * take. Throws UblParseError only for a genuinely structural failure
 * (not well-formed XML at all, or no root <Invoice> element — this
 * isn't a UBL invoice document, full stop). A missing optional field
 * within an otherwise valid document is never an error here.
 */
export function parseUblInvoice(xml: string): ParsedUblInvoice {
  // fast-xml-parser's own .parse() is deliberately lenient by design
  // — it does not throw on malformed input the way a strict validating
  // parser would. XMLValidator.validate() is the library's own,
  // separate tool for genuine well-formedness checking; confirmed
  // directly (not assumed) before relying on it here, after a first
  // version of this function's own test suite caught that an
  // unclosed-tag document was silently accepted rather than refused.
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new UblParseError(`not well-formed XML: ${validation.err.msg}`);
  }

  let parsed: unknown;
  try {
    const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true });
    parsed = parser.parse(xml);
  } catch (err) {
    throw new UblParseError(`not well-formed XML: ${(err as Error).message}`);
  }

  const root = parsed as Record<string, unknown>;
  const invoice = root?.Invoice as Record<string, unknown> | undefined;
  if (!invoice || typeof invoice !== "object") {
    throw new UblParseError("no root <Invoice> element found — not a UBL invoice document");
  }

  const facts: InvoiceFacts = {};

  const id = getText(invoice.ID);
  if (id !== undefined) facts["BT-1"] = id;

  const issueDate = getText(invoice.IssueDate);
  if (issueDate !== undefined) facts["BT-2"] = issueDate;

  const currency = getText(invoice.DocumentCurrencyCode);
  if (currency !== undefined) facts["BT-5"] = currency;

  const dueDate = getText(invoice.DueDate);
  if (dueDate !== undefined) facts["BT-9"] = dueDate;

  const supplierParty = (invoice.AccountingSupplierParty as Record<string, unknown> | undefined)?.Party as
    | Record<string, unknown>
    | undefined;
  const supplierVatId = findVatSchemeCompanyId(supplierParty?.PartyTaxScheme);
  if (supplierVatId !== undefined) facts["BT-31"] = supplierVatId;

  const supplierCountry = getText(
    ((supplierParty?.PostalAddress as Record<string, unknown> | undefined)?.Country as Record<string, unknown> | undefined)
      ?.IdentificationCode
  );
  if (supplierCountry !== undefined) facts["BT-40"] = supplierCountry;

  // The seller's NAME — decision 0112. Mandatory, and its absence is
  // why every screen has been showing a VAT identifier where a person
  // expects a company.
  const supplierName = getText(
    (supplierParty?.PartyLegalEntity as Record<string, unknown> | undefined)?.RegistrationName
  );
  if (supplierName !== undefined) facts["BT-27"] = supplierName;

  const supplierEndpoint = getText(supplierParty?.EndpointID);
  if (supplierEndpoint !== undefined) facts["BT-34"] = supplierEndpoint;

  const buyerParty = (invoice.AccountingCustomerParty as Record<string, unknown> | undefined)?.Party as
    | Record<string, unknown>
    | undefined;
  const buyerVatId = findVatSchemeCompanyId(buyerParty?.PartyTaxScheme);
  if (buyerVatId !== undefined) facts["BT-48"] = buyerVatId;

  const buyerName = getText(
    (buyerParty?.PartyLegalEntity as Record<string, unknown> | undefined)?.RegistrationName
  );
  if (buyerName !== undefined) facts["BT-44"] = buyerName;

  // **What Peppol itself routes on** — decision 0111 needs this to let
  // a customer write a rule placing an invoice in the right part of
  // their enterprise.
  const buyerEndpoint = getText(buyerParty?.EndpointID);
  if (buyerEndpoint !== undefined) facts["BT-49"] = buyerEndpoint;

  const buyerCountry = getText(
    ((buyerParty?.PostalAddress as Record<string, unknown> | undefined)?.Country as Record<string, unknown> | undefined)
      ?.IdentificationCode
  );
  if (buyerCountry !== undefined) facts["BT-55"] = buyerCountry;

  const typeCode = getText(invoice.InvoiceTypeCode);
  if (typeCode !== undefined) facts["BT-3"] = typeCode;

  // **The document-type discriminator** `PROGRESS.md` has recorded as
  // read by nothing since decision 0082. Reading it into the facts does
  // not by itself make detection use it, but it is now referenceable by
  // a rule and present on every parsed invoice.
  const customizationId = getText(invoice.CustomizationID);
  if (customizationId !== undefined) facts["BT-24"] = customizationId;

  const profileId = getText(invoice.ProfileID);
  if (profileId !== undefined) facts["BT-23"] = profileId;

  const buyerReference = getText(invoice.BuyerReference);
  if (buyerReference !== undefined) facts["BT-10"] = buyerReference;

  const orderReference = getText((invoice.OrderReference as Record<string, unknown> | undefined)?.ID);
  if (orderReference !== undefined) facts["BT-13"] = orderReference;

  const monetaryTotal = invoice.LegalMonetaryTotal as Record<string, unknown> | undefined;

  const totalWithVat = getNumber(monetaryTotal?.TaxInclusiveAmount);
  if (totalWithVat !== undefined) facts["BT-112"] = totalWithVat;

  // BT-106, BT-110 and BT-115 are what validation's vat_arithmetic and
  // amount_due_mismatch checks compare (decision 0044). Until they were
  // mapped, neither check could run on the UBL path at all — the most
  // trustworthy path got the least validation, and `checked` reported
  // that honestly rather than anyone noticing.
  const netTotal = getNumber(monetaryTotal?.LineExtensionAmount);
  if (netTotal !== undefined) facts["BT-106"] = netTotal;

  // Mandatory, and the missing middle of the arithmetic — decision
  // 0112. BT-109 + BT-110 should equal BT-112, and without BT-109 that
  // check had nothing to stand on: BT-106 is the sum of LINES, which
  // differs from the total without VAT whenever a document-level
  // allowance or charge exists.
  const netWithoutVat = getNumber(monetaryTotal?.TaxExclusiveAmount);
  if (netWithoutVat !== undefined) facts["BT-109"] = netWithoutVat;

  const payableAmount = getNumber(monetaryTotal?.PayableAmount);
  if (payableAmount !== undefined) facts["BT-115"] = payableAmount;

  const vatTotal = findDocumentCurrencyTaxAmount(invoice.TaxTotal, currency);
  if (vatTotal !== undefined) facts["BT-110"] = vatTotal;

  // InvoiceLine may be a single object (one line) or an array (many) —
  // UBL/fast-xml-parser only produces an array once there's more than
  // one, so both shapes need handling.
  const rawLines = invoice.InvoiceLine;
  const lineArray: unknown[] = rawLines === undefined ? [] : Array.isArray(rawLines) ? rawLines : [rawLines];

  const lines: Array<InvoiceFacts & { lineNumber: number }> = lineArray.map((rawLine, idx) => {
    const line = rawLine as Record<string, unknown>;
    const lineIdText = getText(line?.ID);
    const parsedLineNumber = lineIdText !== undefined ? Number(lineIdText) : NaN;
    const lineNumber = Number.isNaN(parsedLineNumber) ? idx + 1 : parsedLineNumber;

    const lineFacts: InvoiceFacts & { lineNumber: number } = { lineNumber };
    const quantity = getNumber(line?.InvoicedQuantity);
    if (quantity !== undefined) lineFacts["BT-129"] = quantity;
    const lineNet = getNumber(line?.LineExtensionAmount);
    if (lineNet !== undefined) lineFacts["BT-131"] = lineNet;
    const accountingCost = getText(line?.AccountingCost);
    if (accountingCost !== undefined) lineFacts["BT-133"] = accountingCost;
    // BT-151/BT-152 are line-level in UBL — cac:Item/cac:ClassifiedTaxCategory
    // — not document-level, despite reading like header fields.
    const taxCategory = (line?.Item as Record<string, unknown> | undefined)?.ClassifiedTaxCategory as
      | Record<string, unknown>
      | undefined;
    const vatCategory = getText(taxCategory?.ID);
    if (vatCategory !== undefined) lineFacts["BT-151"] = vatCategory;
    const vatRate = getNumber(taxCategory?.Percent);
    if (vatRate !== undefined) lineFacts["BT-152"] = vatRate;

    // The rest of BG-25, checked against the BIS Billing 3.0 UBL tree
    // rather than recalled — decision 0110. Four of these are
    // **mandatory** in the spec and none was being read.
    if (lineIdText !== undefined) lineFacts["BT-126"] = lineIdText;

    const lineNote = getText(line?.Note);
    if (lineNote !== undefined) lineFacts["BT-127"] = lineNote;

    // The unit of measure is an ATTRIBUTE on the quantity, not an
    // element — `cbc:InvoicedQuantity/@unitCode`, mandatory. Without it
    // a quantity of 100 says nothing: 100 hours and 100 pallets are
    // both `100`.
    const unitCode = getAttribute(line?.InvoicedQuantity, "unitCode");
    if (unitCode !== undefined) lineFacts["BT-130"] = unitCode;

    // Which line of the buyer's own order this answers — what
    // three-way matching will need to compare a line to an order line
    // rather than a document to a document.
    const orderLine = (line?.OrderLineReference as Record<string, unknown> | undefined)?.LineID;
    const orderLineRef = getText(orderLine);
    if (orderLineRef !== undefined) lineFacts["BT-132"] = orderLineRef;

    const item = line?.Item as Record<string, unknown> | undefined;
    const itemName = getText(item?.Name);
    if (itemName !== undefined) lineFacts["BT-153"] = itemName;
    const itemDescription = getText(item?.Description);
    if (itemDescription !== undefined) lineFacts["BT-154"] = itemDescription;

    // The unit price, from cac:Price/cbc:PriceAmount. Mandatory, and
    // what makes a line checkable against its own arithmetic.
    const price = (line?.Price as Record<string, unknown> | undefined)?.PriceAmount;
    const netPrice = getNumber(price);
    if (netPrice !== undefined) lineFacts["BT-146"] = netPrice;

    return lineFacts;
  });

  return { facts, lines };
}
