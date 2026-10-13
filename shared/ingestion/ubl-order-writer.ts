import type { ParsedOrder } from "./ubl-order-parser.js";

/**
 * **A purchase order written as Peppol BIS Order Only 3 — decision 0759**,
 * for Orders to suppliers: the order as the customer holds it, in the
 * document a supplier's system reads. The writer's counterpart of
 * `ubl-order-parser.ts`, so what it writes reads back as what was held.
 *
 * Elements in the UBL 2.1 Order schema's order. The parties carry what
 * the customer keeps of them (name, address, VAT number, Peppol endpoint,
 * a contact email); anything unknown is left out rather than invented, so
 * an order whose parties have no endpoint is well formed but not every
 * Peppol access point would take it — it is sent by email here.
 */

export interface OrderParty {
  /** Its identifier: a VAT number, or the supplier's ERP number. */
  id?: string | null;
  name?: string | null;
  vatId?: string | null;
  /** Its Peppol endpoint, `scheme:value` (e.g. `0088:5012345000004`). */
  endpoint?: string | null;
  addressLine?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface OrderToWrite extends ParsedOrder {
  buyer?: OrderParty | null;
  seller?: OrderParty | null;
  /** A note for the supplier: a change's or a cancellation's reason, say. */
  note?: string | null;
}

export const ORDER_CUSTOMIZATION_ID = "urn:fdc:peppol.eu:poacc:trns:order:3";
export const ORDER_PROFILE_ID = "urn:fdc:peppol.eu:poacc:bis:order_only:3";

const esc = (v: unknown) =>
  String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

/** One element, or nothing where there is no value. */
const tag = (name: string, value: unknown, attrs: Record<string, unknown> = {}) => {
  if (value === null || value === undefined || value === "") return "";
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== undefined && v !== "")
    .map(([k, v]) => ` ${k}="${esc(v)}"`)
    .join("");
  return `<${name}${a}>${esc(value)}</${name}>`;
};
const wrap = (name: string, inner: string) => (inner ? `<${name}>${inner}</${name}>` : "");
const amount = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(Math.round(n * 100) / 100) : undefined);

function party(p: OrderParty | null | undefined, fallbackId: string | undefined): string {
  const id = p?.id ?? fallbackId;
  const [scheme, endpoint] = p?.endpoint && p.endpoint.includes(":") ? [p.endpoint.slice(0, p.endpoint.indexOf(":")), p.endpoint.slice(p.endpoint.indexOf(":") + 1)] : [null, p?.endpoint ?? null];
  const inner =
    tag("cbc:EndpointID", endpoint, { schemeID: scheme }) +
    wrap("cac:PartyIdentification", tag("cbc:ID", id)) +
    wrap("cac:PartyName", tag("cbc:Name", p?.name)) +
    wrap("cac:PostalAddress", tag("cbc:StreetName", p?.addressLine) + tag("cbc:CityName", p?.city) + tag("cbc:PostalZone", p?.postalCode) + wrap("cac:Country", tag("cbc:IdentificationCode", p?.country))) +
    (p?.vatId ? wrap("cac:PartyTaxScheme", tag("cbc:CompanyID", p.vatId) + wrap("cac:TaxScheme", tag("cbc:ID", "VAT"))) : "") +
    wrap("cac:PartyLegalEntity", tag("cbc:RegistrationName", p?.name)) +
    wrap("cac:Contact", tag("cbc:Telephone", p?.phone) + tag("cbc:ElectronicMail", p?.email));
  return wrap("cac:Party", inner);
}

/** The order as a UBL Order document. */
export function writeUblOrder(o: OrderToWrite): string {
  const cur = o.currency;
  const money = (name: string, n: number | undefined) => tag(name, amount(n), { currencyID: cur });
  const seller = { ...(o.seller ?? {}), email: o.sellerContactEmail ?? o.seller?.email ?? null };
  const lines = o.lines
    .map((l) =>
      wrap(
        "cac:OrderLine",
        wrap(
          "cac:LineItem",
          tag("cbc:ID", l.lineNumber) +
            tag("cbc:Quantity", l.quantity, { unitCode: l.unitCode }) +
            money("cbc:LineExtensionAmount", l.lineExtensionAmount) +
            wrap("cac:Price", money("cbc:PriceAmount", l.priceAmount) + tag("cbc:BaseQuantity", l.baseQuantity, { unitCode: l.unitCode })) +
            wrap(
              "cac:Item",
              tag("cbc:Description", l.itemDescription) +
                tag("cbc:Name", l.itemName ?? l.itemDescription ?? `Line ${l.lineNumber}`) +
                wrap("cac:SellersItemIdentification", tag("cbc:ID", l.sellersItemId)) +
                wrap("cac:StandardItemIdentification", tag("cbc:ID", l.standardItemId))
            )
        )
      )
    )
    .join("\n  ");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  ${tag("cbc:CustomizationID", ORDER_CUSTOMIZATION_ID)}
  ${tag("cbc:ProfileID", ORDER_PROFILE_ID)}
  ${tag("cbc:ID", o.orderNumber)}
  ${tag("cbc:IssueDate", o.issueDate)}
  ${tag("cbc:OrderTypeCode", o.orderTypeCode ?? "220")}
  ${tag("cbc:Note", o.note)}
  ${tag("cbc:DocumentCurrencyCode", cur)}
  ${wrap("cac:OriginatorDocumentReference", tag("cbc:ID", o.originatorReference))}
  ${wrap("cac:BuyerCustomerParty", party(o.buyer, o.buyerPartyId))}
  ${wrap("cac:SellerSupplierParty", party(seller, o.sellerPartyId))}
  ${wrap(
    "cac:AnticipatedMonetaryTotal",
    money("cbc:LineExtensionAmount", o.lineExtensionAmount) + money("cbc:TaxExclusiveAmount", o.taxExclusiveAmount) + money("cbc:TaxInclusiveAmount", o.taxInclusiveAmount) + money("cbc:PayableAmount", o.payableAmount)
  )}
  ${lines}
</Order>
`.replace(/\n\s*\n/g, "\n");
}
