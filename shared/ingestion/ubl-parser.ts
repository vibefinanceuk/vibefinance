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
 * (BT-1, BT-2, BT-5, BT-9, BT-31, BT-40, BT-48, BT-112, and each
 * line's BT-129/BT-131) against their real, verified UBL paths.
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

  const buyerParty = (invoice.AccountingCustomerParty as Record<string, unknown> | undefined)?.Party as
    | Record<string, unknown>
    | undefined;
  const buyerVatId = findVatSchemeCompanyId(buyerParty?.PartyTaxScheme);
  if (buyerVatId !== undefined) facts["BT-48"] = buyerVatId;

  const totalWithVat = getNumber((invoice.LegalMonetaryTotal as Record<string, unknown> | undefined)?.TaxInclusiveAmount);
  if (totalWithVat !== undefined) facts["BT-112"] = totalWithVat;

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
    return lineFacts;
  });

  return { facts, lines };
}
