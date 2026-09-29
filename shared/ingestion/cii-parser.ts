import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { InvoiceFacts } from "../interpreter/types.js";
import {
  UblParseError,
  getAttribute,
  getNumber,
  getText,
  type InvoiceCheckInputs,
  type ParsedUblInvoice,
} from "./ubl-parser.js";

/**
 * Reading a UN/CEFACT Cross Industry Invoice — decision 0560.
 *
 * **The other syntax EN 16931 allows.** UBL is the one Peppol uses;
 * CII is the one inside every Factur-X and ZUGFeRD PDF, and one of the
 * two an XRechnung may be written in. Until this module existed a
 * hybrid PDF's embedded XML was handed to the UBL parser, which
 * refused it for having no `<Invoice>` root — so the path decision
 * 0042 built for exactly these documents only ever worked for the
 * rare hybrid that embedded UBL.
 *
 * **The same Business Terms as the UBL parser, from the same places in
 * the model.** The paths below follow the EN 16931-3-3 syntax binding
 * for CII D16B. What matters downstream is that an invoice's facts do
 * not depend on which syntax it arrived in: a rule written against
 * BT-115 must not care.
 *
 * Two things differ in shape rather than place:
 *
 * - **Dates are `udt:DateTimeString` with a format code**, `102`
 *   meaning CCYYMMDD. Turned into the ISO date the UBL path already
 *   produces; any other format is left unread rather than guessed.
 * - **A party's VAT identifier is a `SpecifiedTaxRegistration` whose
 *   ID carries `schemeID="VA"`**; `FC` is a tax registration (BT-32),
 *   which is not a VAT number and must not be read as one.
 *
 * Credit notes are refused here exactly as the UBL parser refuses a
 * `<CreditNote>`: in CII they share the root and differ only by type
 * code, so the refusal is by code.
 */

/** UNTDID 1001 codes EN 16931 treats as credit notes. */
export const CREDIT_NOTE_TYPE_CODES = new Set(["81", "83", "261", "262", "296", "308", "381", "396", "420", "458", "532"]);

type Node = Record<string, unknown> | undefined;

function node(value: unknown): Node {
  if (value === undefined || value === null || typeof value !== "object") return undefined;
  return Array.isArray(value) ? (value[0] as Node) : (value as Node);
}

function list(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** `udt:DateTimeString` with format 102 (CCYYMMDD) as an ISO date. */
export function ciiDate(value: unknown): string | undefined {
  const dateTime = node(node(value)?.DateTimeString) ?? node(value)?.DateTimeString;
  const text = getText(dateTime);
  if (text === undefined) return undefined;
  const format = getAttribute(dateTime, "format");
  const compact = text.trim();
  if ((format === undefined || format === "102") && /^\d{8}$/.test(compact)) {
    return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}`;
  }
  return undefined;
}

/** The VAT identifier among a party's tax registrations (schemeID VA). */
function vatRegistration(party: Node): string | undefined {
  for (const reg of list(party?.SpecifiedTaxRegistration)) {
    const id = (reg as Node)?.ID;
    if (getAttribute(id, "schemeID") === "VA") return getText(id);
  }
  return undefined;
}

/**
 * BT-110 — the tax total in the invoice currency. `TaxTotalAmount`
 * repeats when a VAT accounting currency is given (the second is BT-111),
 * the same trap the UBL parser records for `cac:TaxTotal`, resolved the
 * same way: by the amount's own `currencyID`.
 */
function taxTotal(summation: Node, currency: string | undefined): number | undefined {
  const amounts = list(summation?.TaxTotalAmount);
  if (amounts.length === 0) return undefined;
  if (currency !== undefined) {
    const match = amounts.find((a) => getAttribute(a, "currencyID") === currency);
    if (match !== undefined) return getNumber(match);
  }
  return getNumber(amounts[0]);
}

export function parseCiiInvoice(xml: string): ParsedUblInvoice {
  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    throw new UblParseError(`not well-formed XML: ${validation.err.msg}`);
  }

  let parsed: unknown;
  try {
    parsed = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true }).parse(xml);
  } catch (err) {
    throw new UblParseError(`not well-formed XML: ${(err as Error).message}`);
  }

  const root = node((parsed as Record<string, unknown>)?.CrossIndustryInvoice);
  if (!root) {
    throw new UblParseError("no root <CrossIndustryInvoice> element found — not a CII invoice document");
  }

  const context = node(root.ExchangedDocumentContext);
  const document = node(root.ExchangedDocument);
  const transaction = node(root.SupplyChainTradeTransaction);
  const agreement = node(transaction?.ApplicableHeaderTradeAgreement);
  const settlement = node(transaction?.ApplicableHeaderTradeSettlement);
  const summation = node(settlement?.SpecifiedTradeSettlementHeaderMonetarySummation);

  const typeCode = getText(document?.TypeCode);
  if (typeCode !== undefined && CREDIT_NOTE_TYPE_CODES.has(typeCode.trim())) {
    throw new UblParseError(`this is a credit note (type code ${typeCode.trim()}), and credit notes are not read yet`);
  }

  const facts: InvoiceFacts = {};
  const set = (key: string, value: string | number | undefined) => {
    if (value !== undefined) facts[key] = value;
  };

  set("BT-1", getText(document?.ID));
  set("BT-2", ciiDate(document?.IssueDateTime));
  set("BT-3", typeCode);
  set("BT-23", getText(node(context?.BusinessProcessSpecifiedDocumentContextParameter)?.ID));
  set("BT-24", getText(node(context?.GuidelineSpecifiedDocumentContextParameter)?.ID));

  const currency = getText(settlement?.InvoiceCurrencyCode);
  set("BT-5", currency);

  set("BT-10", getText(agreement?.BuyerReference));
  set("BT-11", getText(node(agreement?.SpecifiedProcuringProject)?.ID));
  set("BT-13", getText(node(agreement?.BuyerOrderReferencedDocument)?.IssuerAssignedID));

  const seller = node(agreement?.SellerTradeParty);
  set("BT-27", getText(seller?.Name));
  set("BT-31", vatRegistration(seller));
  set("BT-34", getText(node(seller?.URIUniversalCommunication)?.URIID));
  const sellerAddress = node(seller?.PostalTradeAddress);
  set("BT-40", getText(sellerAddress?.CountryID));

  const buyer = node(agreement?.BuyerTradeParty);
  set("BT-44", getText(buyer?.Name));
  set("BT-48", vatRegistration(buyer));
  set("BT-49", getText(node(buyer?.URIUniversalCommunication)?.URIID));
  const buyerAddress = node(buyer?.PostalTradeAddress);
  set("BT-55", getText(buyerAddress?.CountryID));

  // Payment terms: BT-20 is the description, BT-9 the due date, and both
  // live in the same (0..n) group; the first is the one EN 16931 means.
  const terms = node(settlement?.SpecifiedTradePaymentTerms);
  set("BT-20", getText(terms?.Description));
  set("BT-9", ciiDate(terms?.DueDateDateTime));

  set("BT-106", getNumber(summation?.LineTotalAmount));
  set("BT-109", getNumber(summation?.TaxBasisTotalAmount));
  set("BT-110", taxTotal(summation, currency));
  set("BT-112", getNumber(summation?.GrandTotalAmount));
  set("BT-115", getNumber(summation?.DuePayableAmount));

  const lines = list(transaction?.IncludedSupplyChainTradeLineItem).map((raw, idx) => {
    const item = raw as Node;
    const lineDoc = node(item?.AssociatedDocumentLineDocument);
    const product = node(item?.SpecifiedTradeProduct);
    const lineAgreement = node(item?.SpecifiedLineTradeAgreement);
    const lineDelivery = node(item?.SpecifiedLineTradeDelivery);
    const lineSettlement = node(item?.SpecifiedLineTradeSettlement);
    const lineTax = node(lineSettlement?.ApplicableTradeTax);

    const lineIdText = getText(lineDoc?.LineID);
    const parsedNumber = lineIdText !== undefined ? Number(lineIdText) : NaN;
    const lineFacts: InvoiceFacts & { lineNumber: number } = {
      lineNumber: Number.isNaN(parsedNumber) ? idx + 1 : parsedNumber,
    };
    const put = (key: string, value: string | number | undefined) => {
      if (value !== undefined) lineFacts[key] = value;
    };

    put("BT-126", lineIdText);
    put("BT-127", getText(node(lineDoc?.IncludedNote)?.Content));
    const quantity = lineDelivery?.BilledQuantity;
    put("BT-129", getNumber(quantity));
    put("BT-130", getAttribute(node(quantity) ?? quantity, "unitCode"));
    put("BT-131", getNumber(node(lineSettlement?.SpecifiedTradeSettlementLineMonetarySummation)?.LineTotalAmount));
    put("BT-132", getText(node(lineAgreement?.BuyerOrderReferencedDocument)?.LineID));
    put("BT-133", getText(node(lineSettlement?.ReceivableSpecifiedTradeAccountingAccount)?.ID));
    put("BT-146", getNumber(node(lineAgreement?.NetPriceProductTradePrice)?.ChargeAmount));
    put("BT-151", getText(lineTax?.CategoryCode));
    put("BT-152", getNumber(lineTax?.RateApplicablePercent));
    put("BT-153", getText(product?.Name));
    put("BT-154", getText(product?.Description));
    return lineFacts;
  });

  const check: InvoiceCheckInputs = {
    sellerAddress: seller !== undefined && "PostalTradeAddress" in seller,
    buyerAddress: buyer !== undefined && "PostalTradeAddress" in buyer,
  };
  const inCurrency = list(summation?.TaxTotalAmount)
    .filter((a) => currency !== undefined && getAttribute(a, "currencyID") === currency)
    .map((a) => getNumber(a))
    .filter((n): n is number => n !== undefined);
  if (inCurrency.length > 1) check.vatTotalAll = inCurrency.reduce((a, b) => a + b, 0);
  const allowanceTotal = getNumber(summation?.AllowanceTotalAmount);
  if (allowanceTotal !== undefined) check.allowanceTotal = allowanceTotal;
  const chargeTotal = getNumber(summation?.ChargeTotalAmount);
  if (chargeTotal !== undefined) check.chargeTotal = chargeTotal;
  const prepaid = getNumber(summation?.TotalPrepaidAmount);
  if (prepaid !== undefined) check.prepaid = prepaid;
  const rounding = getNumber(summation?.RoundingAmount);
  if (rounding !== undefined) check.rounding = rounding;

  return { facts, lines, check };
}
