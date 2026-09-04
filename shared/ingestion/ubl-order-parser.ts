import { XMLParser } from "fast-xml-parser";

/**
 * Peppol BIS Order Only 3.3 — decision 0081.
 *
 * A sibling of ubl-parser.ts, deliberately separate rather than a
 * parameterised version of it. The two documents share a syntax and
 * almost nothing else:
 *
 *   - the namespace is `Order-2`, not `Invoice-2`;
 *   - totals live in `cac:AnticipatedMonetaryTotal`, not
 *     `cac:LegalMonetaryTotal`, and the whole class is **optional**;
 *   - lines are `cac:OrderLine/cac:LineItem`, a level deeper than
 *     `cac:InvoiceLine`;
 *   - **there are no BT codes.** The invoice vocabulary is built on EN
 *     16931 Business Terms; this profile derives from CEN BII Profile
 *     03 and addresses everything by UBL element name.
 *
 * A shared parser taking a "document kind" would have to branch on all
 * four, which is a worse thing to read than two files that each say
 * what they parse.
 *
 * Every path below was checked against docs.peppol.eu before being
 * written, not recalled — the discipline ubl-parser.ts established, and
 * the reason decision 0059's `cac:TaxTotal` cardinality trap was
 * noticed there rather than by a customer.
 */

export class UblOrderParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UblOrderParseError";
  }
}

export interface ParsedOrderLine {
  lineNumber: number;
  quantity?: number;
  unitCode?: string;
  lineExtensionAmount?: number;
  itemName?: string;
  itemDescription?: string;
  sellersItemId?: string;
  standardItemId?: string;
  priceAmount?: number;
  baseQuantity?: number;
}

export interface ParsedOrder {
  orderNumber: string;
  issueDate?: string;
  orderTypeCode?: string;
  currency?: string;
  sellerPartyId?: string;
  buyerPartyId?: string;
  lineExtensionAmount?: number;
  taxExclusiveAmount?: number;
  taxInclusiveAmount?: number;
  payableAmount?: number;
  originatorReference?: string;
  lines: ParsedOrderLine[];
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

function getNumber(value: unknown): number | undefined {
  const text = getText(value);
  if (text === undefined) return undefined;
  const n = Number(text);
  return Number.isNaN(n) ? undefined : n;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * A party's identifier, from `cac:PartyIdentification/cbc:ID`.
 *
 * PartyIdentification is repeatable in UBL, so the first is taken and
 * that choice is stated rather than assumed — the same shape of trap as
 * the repeating `PartyTaxScheme` that ubl-parser.ts records, and the
 * repeating `TaxTotal` that decision 0059 found.
 */
function partyId(party: unknown): string | undefined {
  const wrapper = asObject(party);
  const inner = asObject(wrapper?.Party);
  const identification = inner?.PartyIdentification;
  const first = Array.isArray(identification) ? identification[0] : identification;
  return getText(asObject(first)?.ID);
}

export function parseUblOrder(xml: string): ParsedOrder {
  const parser = new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    trimValues: true,
  });

  let parsed: unknown;
  try {
    parsed = parser.parse(xml);
  } catch (err) {
    throw new UblOrderParseError(`not well-formed XML: ${(err as Error).message}`);
  }

  const root = asObject(parsed);
  const order = asObject(root?.Order);
  if (!order) {
    // Refused rather than guessed. An Invoice handed to this parser is
    // a caller mistake worth reporting, not a document to interpret
    // charitably — the same position ubl-parser.ts takes on an Order.
    throw new UblOrderParseError(
      "no <Order> root element — a Peppol BIS Order Only document is expected here"
    );
  }

  const orderNumber = getText(order.ID);
  if (orderNumber === undefined || orderNumber.trim() === "") {
    // cbc:ID is what an invoice's BT-13 points at. Without it the order
    // cannot be matched against anything, which is the entire reason it
    // is being stored.
    throw new UblOrderParseError("the order has no cbc:ID — nothing could reference it");
  }

  const totals = asObject(order.AnticipatedMonetaryTotal);

  const lineNodes = order.OrderLine === undefined ? [] : Array.isArray(order.OrderLine) ? order.OrderLine : [order.OrderLine];
  const lines: ParsedOrderLine[] = [];
  for (const [index, node] of lineNodes.entries()) {
    const lineItem = asObject(asObject(node)?.LineItem);
    if (!lineItem) continue;

    const item = asObject(lineItem.Item);
    const price = asObject(lineItem.Price);

    // The line's own cbc:ID where it has one, falling back to position.
    // A line without an id is still a line, and dropping it would lose
    // an ordered item.
    const declared = getNumber(lineItem.ID);
    lines.push({
      lineNumber: declared ?? index + 1,
      quantity: getNumber(lineItem.Quantity),
      // The unit lives on the attribute, not the element — a quantity
      // without it is half a fact.
      unitCode: getText(asObject(lineItem.Quantity)?.["@_unitCode"]),
      lineExtensionAmount: getNumber(lineItem.LineExtensionAmount),
      itemName: getText(item?.Name),
      itemDescription: getText(item?.Description),
      sellersItemId: getText(asObject(item?.SellersItemIdentification)?.ID),
      standardItemId: getText(asObject(item?.StandardItemIdentification)?.ID),
      priceAmount: getNumber(price?.PriceAmount),
      baseQuantity: getNumber(price?.BaseQuantity),
    });
  }

  return {
    orderNumber,
    issueDate: getText(order.IssueDate),
    orderTypeCode: getText(order.OrderTypeCode),
    currency: getText(order.DocumentCurrencyCode),
    sellerPartyId: partyId(order.SellerSupplierParty),
    buyerPartyId: partyId(order.BuyerCustomerParty),
    // All optional: the spec says AnticipatedMonetaryTotal is an
    // optional class, and an order with no totals is conforming.
    lineExtensionAmount: getNumber(totals?.LineExtensionAmount),
    taxExclusiveAmount: getNumber(totals?.TaxExclusiveAmount),
    taxInclusiveAmount: getNumber(totals?.TaxInclusiveAmount),
    payableAmount: getNumber(totals?.PayableAmount),
    originatorReference: getText(asObject(order.OriginatorDocumentReference)?.ID),
    lines,
  };
}
