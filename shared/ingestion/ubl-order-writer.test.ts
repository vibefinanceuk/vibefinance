import { describe, expect, it } from "vitest";
import { parseUblOrder, type ParsedOrder } from "./ubl-order-parser.js";
import { writeUblOrder, ORDER_CUSTOMIZATION_ID } from "./ubl-order-writer.js";

/** Decision 0759: an order written as Peppol BIS Order Only 3 reads back as the order held. */
const ORDER: ParsedOrder = {
  orderNumber: "PO-7",
  issueDate: "2026-10-01",
  orderTypeCode: "220",
  currency: "GBP",
  sellerPartyId: "GB111222333",
  sellerContactEmail: "orders@kingsway.example",
  buyerPartyId: "GB999888777",
  lineExtensionAmount: 1450,
  payableAmount: 1740,
  originatorReference: "REQ-4410",
  lines: [
    { lineNumber: 1, itemName: "Office chair, mesh", itemDescription: "Black & grey <ergonomic>", sellersItemId: "KI-CH-01", quantity: 10, unitCode: "EA", priceAmount: 125, lineExtensionAmount: 1250 },
    { lineNumber: 2, itemName: "Footrest", quantity: 10, unitCode: "EA", priceAmount: 20, lineExtensionAmount: 200, baseQuantity: 1 },
  ],
};

describe("writeUblOrder", () => {
  it("reads back as the order it was written from", () => {
    const xml = writeUblOrder({ ...ORDER, buyer: { name: "Acme UK Ltd", vatId: "GB999888777", endpoint: "0088:5012345000004", city: "London", country: "GB" }, seller: { name: "Kingsway Interiors" } });
    expect(xml).toContain(`<cbc:CustomizationID>${ORDER_CUSTOMIZATION_ID}</cbc:CustomizationID>`);
    expect(xml).toContain('<cbc:EndpointID schemeID="0088">5012345000004</cbc:EndpointID>');
    expect(xml).toContain("Black &amp; grey &lt;ergonomic&gt;");
    expect(xml).not.toMatch(/\n\s*\n/);
    expect(parseUblOrder(xml)).toEqual(ORDER);
  });

  it("leaves out what is not known rather than writing it empty", () => {
    const xml = writeUblOrder({ orderNumber: "PO-8", lines: [{ lineNumber: 1, quantity: 1 }] });
    expect(xml).not.toContain("<cac:AnticipatedMonetaryTotal>");
    expect(xml).not.toContain("ElectronicMail");
    expect(xml).toContain("<cbc:Name>Line 1</cbc:Name>");
    expect(parseUblOrder(xml).orderNumber).toBe("PO-8");
  });
});
