import { describe, expect, it } from "vitest";
import { parseUblOrder, UblOrderParseError } from "./ubl-order-parser.js";

/**
 * Shaped after the spec's own examples (docs.peppol.eu, BIS Order Only
 * 3.3, sections 6.1 to 6.9) rather than invented.
 */
const SAMPLE_ORDER = `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>PO-34500</cbc:ID>
  <cbc:IssueDate>2026-07-15</cbc:IssueDate>
  <cbc:OrderTypeCode>220</cbc:OrderTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:OriginatorDocumentReference><cbc:ID>2139239</cbc:ID></cac:OriginatorDocumentReference>
  <cac:BuyerCustomerParty>
    <cac:Party><cac:PartyIdentification><cbc:ID schemeID="0007">5541277710</cbc:ID></cac:PartyIdentification></cac:Party>
  </cac:BuyerCustomerParty>
  <cac:SellerSupplierParty>
    <cac:Party><cac:PartyIdentification><cbc:ID schemeID="0192">987654325</cbc:ID></cac:PartyIdentification></cac:Party>
  </cac:SellerSupplierParty>
  <cac:AnticipatedMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">700</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="EUR">800</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">885.63</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">751.00</cbc:PayableAmount>
  </cac:AnticipatedMonetaryTotal>
  <cac:OrderLine>
    <cac:LineItem>
      <cbc:ID>1</cbc:ID>
      <cbc:Quantity unitCode="LTR">120</cbc:Quantity>
      <cbc:LineExtensionAmount currencyID="EUR">720</cbc:LineExtensionAmount>
      <cac:Price>
        <cbc:PriceAmount currencyID="EUR">6</cbc:PriceAmount>
        <cbc:BaseQuantity unitCode="LTR">1</cbc:BaseQuantity>
      </cac:Price>
      <cac:Item>
        <cbc:Name>White sauce</cbc:Name>
        <cbc:Description>1x12 pack sauce bags</cbc:Description>
        <cac:SellersItemIdentification><cbc:ID>SN-33</cbc:ID></cac:SellersItemIdentification>
        <cac:StandardItemIdentification><cbc:ID schemeID="0160">05704066204093</cbc:ID></cac:StandardItemIdentification>
      </cac:Item>
    </cac:LineItem>
  </cac:OrderLine>
  <cac:OrderLine>
    <cac:LineItem>
      <cbc:ID>2</cbc:ID>
      <cbc:Quantity unitCode="NAR">2</cbc:Quantity>
      <cac:Item><cbc:Name>Surgical gloves</cbc:Name></cac:Item>
    </cac:LineItem>
  </cac:OrderLine>
</Order>`;

describe("parseUblOrder — a document shaped like the spec's own examples", () => {
  it("extracts the order number an invoice's BT-13 would point at", () => {
    // The join that makes matching possible at all.
    expect(parseUblOrder(SAMPLE_ORDER).orderNumber).toBe("PO-34500");
  });

  it("extracts the header fields", () => {
    const o = parseUblOrder(SAMPLE_ORDER);
    expect(o.issueDate).toBe("2026-07-15");
    expect(o.orderTypeCode).toBe("220");
    expect(o.currency).toBe("EUR");
    expect(o.originatorReference).toBe("2139239");
  });

  it("takes the totals from AnticipatedMonetaryTotal, not LegalMonetaryTotal", () => {
    // The element differs from the invoice side, and assuming otherwise
    // would silently yield no totals at all.
    const o = parseUblOrder(SAMPLE_ORDER);
    expect(o.lineExtensionAmount).toBe(700);
    expect(o.taxExclusiveAmount).toBe(800);
    expect(o.taxInclusiveAmount).toBe(885.63);
    expect(o.payableAmount).toBe(751);
  });

  it("extracts both parties by their PartyIdentification", () => {
    const o = parseUblOrder(SAMPLE_ORDER);
    expect(o.buyerPartyId).toBe("5541277710");
    expect(o.sellerPartyId).toBe("987654325");
  });
});

describe("parseUblOrder — lines", () => {
  it("reads lines from cac:OrderLine/cac:LineItem, a level deeper than an invoice's", () => {
    expect(parseUblOrder(SAMPLE_ORDER).lines).toHaveLength(2);
  });

  it("keeps the unit with the quantity", () => {
    // 120 of something is not a quantity. The unit is on the attribute.
    const [first] = parseUblOrder(SAMPLE_ORDER).lines;
    expect(first.quantity).toBe(120);
    expect(first.unitCode).toBe("LTR");
  });

  it("extracts both item identifiers and the name", () => {
    const [first] = parseUblOrder(SAMPLE_ORDER).lines;
    expect(first.itemName).toBe("White sauce");
    expect(first.sellersItemId).toBe("SN-33");
    expect(first.standardItemId).toBe("05704066204093");
  });

  it("extracts the price and its base quantity", () => {
    const [first] = parseUblOrder(SAMPLE_ORDER).lines;
    expect(first.priceAmount).toBe(6);
    expect(first.baseQuantity).toBe(1);
  });

  it("handles a line carrying only a name, which the spec permits", () => {
    // "Each order line MUST have an item identifier and/or an item
    // name" — a name alone is conforming.
    const [, second] = parseUblOrder(SAMPLE_ORDER).lines;
    expect(second.itemName).toBe("Surgical gloves");
    expect(second.sellersItemId).toBeUndefined();
  });

  it("handles a single line that is not an array", () => {
    const single = SAMPLE_ORDER.replace(/<cac:OrderLine>[\s\S]*?<\/cac:OrderLine>\s*<cac:OrderLine>/, "<cac:OrderLine>");
    const o = parseUblOrder(single);
    expect(o.lines).toHaveLength(1);
  });

  it("falls back to position for a line with no cbc:ID", () => {
    // A line without an id is still a line; dropping it would lose an
    // ordered item.
    const noId = SAMPLE_ORDER.replace("<cbc:ID>1</cbc:ID>", "");
    expect(parseUblOrder(noId).lines[0].lineNumber).toBe(1);
  });
});

describe("parseUblOrder — refusals", () => {
  it("refuses an Invoice handed to it, rather than interpreting it charitably", () => {
    const invoice = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>INV-1</ID></Invoice>`;
    expect(() => parseUblOrder(invoice)).toThrow(UblOrderParseError);
  });

  it("refuses an order with no cbc:ID — nothing could reference it", () => {
    const noId = SAMPLE_ORDER.replace("<cbc:ID>PO-34500</cbc:ID>", "");
    expect(() => parseUblOrder(noId)).toThrow(/no cbc:ID/);
  });

  it("refuses malformed XML", () => {
    expect(() => parseUblOrder("<Order><unclosed>")).toThrow(UblOrderParseError);
  });

  it("accepts an order with no totals at all, which the spec permits", () => {
    // AnticipatedMonetaryTotal is an OPTIONAL class. A NOT NULL
    // assumption here would reject conforming documents.
    const noTotals = SAMPLE_ORDER.replace(/<cac:AnticipatedMonetaryTotal>[\s\S]*?<\/cac:AnticipatedMonetaryTotal>/, "");
    const o = parseUblOrder(noTotals);
    expect(o.payableAmount).toBeUndefined();
    expect(o.orderNumber).toBe("PO-34500");
  });
});
