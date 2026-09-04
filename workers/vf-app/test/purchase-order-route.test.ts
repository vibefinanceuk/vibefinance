import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleIngestPurchaseOrder, handleGetPurchaseOrder } from "../src/purchase-order-route.js";

const ORDER = (number = "PO-34500", lines = `
  <cac:OrderLine><cac:LineItem>
    <cbc:ID>1</cbc:ID>
    <cbc:Quantity unitCode="LTR">120</cbc:Quantity>
    <cbc:LineExtensionAmount currencyID="EUR">720</cbc:LineExtensionAmount>
    <cac:Price><cbc:PriceAmount currencyID="EUR">6</cbc:PriceAmount></cac:Price>
    <cac:Item><cbc:Name>White sauce</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>SN-33</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
  </cac:LineItem></cac:OrderLine>`) => `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${number}</cbc:ID>
  <cbc:IssueDate>2026-07-15</cbc:IssueDate>
  <cbc:OrderTypeCode>220</cbc:OrderTypeCode>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>987654325</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>
  <cac:AnticipatedMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">720</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="EUR">864</cbc:PayableAmount>
  </cac:AnticipatedMonetaryTotal>${lines}
</Order>`;

beforeEach(async () => {
  await applyTestSchema();
});

describe("ingesting a purchase order", () => {
  it("stores the order and its lines", async () => {
    const result = await handleIngestPurchaseOrder(env.DB, ORDER());
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ orderNumber: "PO-34500", lines: 1, replaced: false });

    const row = await env.DB.prepare("SELECT * FROM purchase_orders WHERE order_number = 'PO-34500'").first<
      Record<string, unknown>
    >();
    expect(row?.payable_amount).toBe(864);
    expect(row?.seller_party_id).toBe("987654325");
  });

  it("keeps the unit with the quantity", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const line = await env.DB.prepare("SELECT quantity, unit_code FROM purchase_order_lines").first<{
      quantity: number;
      unit_code: string;
    }>();
    expect(line?.quantity).toBe(120);
    expect(line?.unit_code).toBe("LTR");
  });

  it("replaces a re-sent order rather than storing two", async () => {
    // An order number is unique by construction. A buyer re-sending
    // means a revised order, and two versions would make matching
    // ambiguous in the worst way: silently picking one.
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const again = await handleIngestPurchaseOrder(env.DB, ORDER());
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ replaced: true });

    const count = await env.DB.prepare("SELECT count(*) AS n FROM purchase_orders").first<{ n: number }>();
    const lines = await env.DB.prepare("SELECT count(*) AS n FROM purchase_order_lines").first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect(lines?.n).toBe(1);
  });

  it("refuses an Invoice, rather than storing it as an order", async () => {
    const invoice = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>INV-1</ID></Invoice>`;
    expect((await handleIngestPurchaseOrder(env.DB, invoice)).status).toBe(422);
  });

  it("refuses a line with neither an item name nor an identifier", async () => {
    // The spec's own rule, enforced before the database refuses it less
    // helpfully.
    const anonymous = ORDER("PO-1", `
      <cac:OrderLine><cac:LineItem><cbc:ID>1</cbc:ID>
        <cbc:Quantity unitCode="NAR">2</cbc:Quantity>
      </cac:LineItem></cac:OrderLine>`);
    const result = await handleIngestPurchaseOrder(env.DB, anonymous);
    expect(result.status).toBe(422);
    expect(String((result.body as { detail: string }).detail)).toContain("item identifier and/or an item name");
  });

  it("refuses an empty body", async () => {
    expect((await handleIngestPurchaseOrder(env.DB, "   ")).status).toBe(400);
  });

  it("accepts an order with no totals, which the spec permits", async () => {
    const noTotals = ORDER().replace(/<cac:AnticipatedMonetaryTotal>[\s\S]*?<\/cac:AnticipatedMonetaryTotal>/, "");
    expect((await handleIngestPurchaseOrder(env.DB, noTotals)).status).toBe(201);
  });
});

describe("reading a purchase order back", () => {
  it("returns the order with its lines", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    expect(result.status).toBe(200);
    const body = result.body as { order: { order_number: string }; lines: unknown[] };
    expect(body.order.order_number).toBe("PO-34500");
    expect(body.lines).toHaveLength(1);
  });

  it("404s an order that was never loaded", async () => {
    expect((await handleGetPurchaseOrder(env.DB, "PO-NONE")).status).toBe(404);
  });
});
