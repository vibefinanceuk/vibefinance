import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleIngestPurchaseOrder, handleGetPurchaseOrder, handleLoadPurchaseOrdersCsv, handleListPurchaseOrders, handleGetPurchaseOrderCsvFormat } from "../src/purchase-order-route.js";

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
  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>GB907856452</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>
  <cac:AnticipatedMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="EUR">720</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="EUR">864</cbc:PayableAmount>
  </cac:AnticipatedMonetaryTotal>${lines}
</Order>`;

beforeEach(async () => {
  await applyTestSchema();
  // Decision 0374 — every order now needs a real, matching legal
  // entity or it is refused at ingestion. Reuses the same VAT/name
  // pair the sample data and screenshots already used, for a familiar
  // read rather than a fresh, arbitrary one.
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-uk', 'Acme UK', 'legal_entity', 'GB907856452')").run();
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

describe("loading purchase orders from CSV — decision 0370", () => {
  const CSV = `order_number,issue_date,seller vat id,buyer vat id,order total,line number,item,sku,quantity,unit,amount
PO-9001,2026-09-10,987654325,GB907856452,864,1,White sauce,SN-33,120,LTR,720
PO-9001,2026-09-10,987654325,GB907856452,864,2,Brown sauce,SN-34,30,LTR,144
PO-9002,2026-09-11,987654325,GB907856452,500,1,Widgets,SN-40,10,EA,500`;

  it("stores one order per group and every line", async () => {
    const result = await handleLoadPurchaseOrdersCsv(env.DB, CSV);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ordersLoaded: 2, ordersReplaced: 0, linesLoaded: 3, refused: [] });

    const orders = await env.DB.prepare("SELECT count(*) AS n FROM purchase_orders").first<{ n: number }>();
    const lines = await env.DB.prepare("SELECT count(*) AS n FROM purchase_order_lines").first<{ n: number }>();
    expect(orders?.n).toBe(2);
    expect(lines?.n).toBe(3);

    const po1 = await env.DB.prepare("SELECT * FROM purchase_orders WHERE order_number = 'PO-9001'").first<
      Record<string, unknown>
    >();
    expect(po1?.payable_amount).toBe(864);
    expect(po1?.seller_party_id).toBe("987654325");

    const line1 = await env.DB.prepare(
      "SELECT * FROM purchase_order_lines WHERE purchase_order_id = ? AND line_number = 1"
    )
      .bind(po1?.id)
      .first<Record<string, unknown>>();
    expect(line1?.item_name).toBe("White sauce");
    expect(line1?.quantity).toBe(120);
    expect(line1?.unit_code).toBe("LTR");
    expect(line1?.line_extension_amount).toBe(720);
  });

  it("replaces an order re-loaded in a later file, same as the XML path", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, CSV);
    const again = await handleLoadPurchaseOrdersCsv(env.DB, CSV);
    expect(again.body).toMatchObject({ ordersLoaded: 2, ordersReplaced: 2 });

    const orders = await env.DB.prepare("SELECT count(*) AS n FROM purchase_orders").first<{ n: number }>();
    expect(orders?.n).toBe(2);
  });

  it("refuses a line with neither an item name nor an identifier, per order", async () => {
    const csv = `order_number,line number,item,sku,buyer vat id
PO-1,1,,,GB907856452
PO-2,1,Widgets,,GB907856452`;
    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({ ordersLoaded: 1, refused: [{ orderNumber: "PO-1" }] });
  });

  it("refuses a file with no order number column", async () => {
    const result = await handleLoadPurchaseOrdersCsv(env.DB, "line number,item\n1,Widgets");
    expect(result.status).toBe(400);
  });

  it("refuses a file with no line number column", async () => {
    const result = await handleLoadPurchaseOrdersCsv(env.DB, "order_number,item\nPO-1,Widgets");
    expect(result.status).toBe(400);
  });

  it("refuses duplicate line numbers within one order", async () => {
    const csv = `order_number,line number,item
PO-1,1,Widgets
PO-1,1,Gadgets`;
    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({ ordersLoaded: 0, refused: [{ orderNumber: "PO-1" }] });
  });

  it("refuses a file with only a header row", async () => {
    expect((await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number")).status).toBe(400);
  });
});

describe("listing loaded purchase orders — decision 0372", () => {
  it("returns an empty list before anything is loaded", async () => {
    const result = await handleListPurchaseOrders(env.DB);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ purchaseOrders: [] });
  });

  it("summarises every loaded order, with a real line count", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER()); // 1 line, PO-34500
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      `order_number,line number,item,quantity,unit,amount,buyer vat id
PO-9001,1,Widgets,10,EA,500,GB907856452
PO-9001,2,Gadgets,5,EA,250,GB907856452`
    ); // 2 lines, PO-9001

    const result = await handleListPurchaseOrders(env.DB);
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders).toHaveLength(2);

    const po9001 = body.purchaseOrders.find((p) => p.order_number === "PO-9001");
    expect(po9001?.line_count).toBe(2);
    const po34500 = body.purchaseOrders.find((p) => p.order_number === "PO-34500");
    expect(po34500?.line_count).toBe(1);
  });

  it("never returns the lines themselves — a list row is a summary, not the detail", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const result = await handleListPurchaseOrders(env.DB);
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders[0].lines).toBeUndefined();
  });

  it("puts the most recently loaded order first", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER("PO-OLD"));
    // Backdated explicitly rather than relying on two real inserts
    // landing in different seconds — created_at has second-level
    // precision, and a fast test could otherwise tie.
    await env.DB.prepare("UPDATE purchase_orders SET created_at = '2020-01-01 00:00:00' WHERE order_number = 'PO-OLD'").run();
    await handleIngestPurchaseOrder(env.DB, ORDER("PO-NEW"));

    const result = await handleListPurchaseOrders(env.DB);
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-NEW", "PO-OLD"]);
  });

  it("still orders correctly within one CSV batch, where every order genuinely shares the same created_at — found live from a real screenshot", async () => {
    // The bug this guards: created_at has only second-level
    // precision, and every order in one CSV load lands within the
    // same request — so without a real tiebreaker, three orders that
    // share a timestamp came back in whatever order SQLite's storage
    // happened to return them, not the order they were actually
    // loaded in.
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      `order_number,line number,item,buyer vat id
PO-BATCH-A,1,Widgets,GB907856452
PO-BATCH-B,1,Widgets,GB907856452
PO-BATCH-C,1,Widgets,GB907856452`
    );

    const result = await handleListPurchaseOrders(env.DB);
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    // Loaded in A, B, C order — the last one inserted is the most
    // recent, so it comes out first.
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-BATCH-C", "PO-BATCH-B", "PO-BATCH-A"]);
  });

  it("counts zero lines honestly for an order that somehow has none, rather than omitting the row", async () => {
    // Not reachable through either real ingestion path today (both
    // refuse a line-less document), but the join itself should never
    // silently drop a header row for want of a matching line.
    await env.DB.prepare(
      "INSERT INTO purchase_orders (id, order_number, payable_amount) VALUES ('po-empty', 'PO-EMPTY', 100)"
    ).run();
    const result = await handleListPurchaseOrders(env.DB);
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders).toHaveLength(1);
    expect(body.purchaseOrders[0].line_count).toBe(0);
  });
});

describe("the CSV format reference — decision 0373", () => {
  it("lists order_number and buyer_party_id as required header columns, and line_number as the only required line column", async () => {
    // Decision 0374 — buyer_party_id joined required once a missing or
    // unmatched buyer tax reference started refusing the whole order.
    const result = await handleGetPurchaseOrderCsvFormat();
    const body = result.body as { header: { key: string; required: boolean }[]; line: { key: string; required: boolean }[] };
    expect(body.header.filter((f) => f.required).map((f) => f.key)).toEqual(["order_number", "buyer_party_id"]);
    expect(body.line.filter((f) => f.required).map((f) => f.key)).toEqual(["line_number"]);
  });

  it("every column it advertises is genuinely accepted by the real parser — no drift possible by construction", async () => {
    // The whole point of deriving HEADER_COLUMNS/LINE_COLUMNS from
    // these same specs: this test would fail the moment the two ever
    // disagreed, rather than a person discovering it by trial and
    // error against their own file.
    const format = (await handleGetPurchaseOrderCsvFormat()).body as {
      header: { key: string; columns: string[] }[];
      line: { key: string; columns: string[] }[];
    };

    // order_type_code is the one field with a closed set of valid
    // values (a real DB constraint); buyer_party_id must be a real,
    // seeded legal entity's own VAT or the whole order is refused —
    // everything else tolerates a generic placeholder just fine.
    const valueFor = (key: string) => {
      if (key === "order_type_code") return "220";
      if (key === "buyer_party_id") return "GB907856452";
      return "1";
    };

    const headerRow = format.header.map((f) => f.columns[0]);
    const lineRow = format.line.map((f) => f.columns[0]);
    const csv = [
      [...headerRow, ...lineRow].join(","),
      [...format.header.map((f) => valueFor(f.key)), ...format.line.map((f) => valueFor(f.key))].join(","),
    ].join("\n");

    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({ ordersLoaded: 1, refused: [] });
  });

  it("every accepted alias for a field resolves to the same stored value, not just the recommended one", async () => {
    const format = (await handleGetPurchaseOrderCsvFormat()).body as { header: { key: string; columns: string[] }[] };
    const orderNumberField = format.header.find((f) => f.key === "order_number")!;

    for (const alias of orderNumberField.columns) {
      const csv = `${alias},line number,item,buyer vat id\nPO-ALIAS-TEST,1,Widgets,GB907856452`;
      const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
      expect(result.body).toMatchObject({ ordersLoaded: 1, refused: [] });
      const order = await env.DB.prepare("SELECT order_number FROM purchase_orders WHERE order_number = 'PO-ALIAS-TEST'").first();
      expect(order).not.toBeNull();
    }
  });
});

describe("which legal entity an order belongs to — decision 0374", () => {
  it("refuses an XML order with no buyer tax reference at all", async () => {
    const noBuyer = `<?xml version="1.0"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>PO-NOBUYER</cbc:ID>
  <cac:OrderLine><cac:LineItem><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>Widgets</cbc:Name></cac:Item></cac:LineItem></cac:OrderLine>
</Order>`;
    const result = await handleIngestPurchaseOrder(env.DB, noBuyer);
    expect(result.status).toBe(422);
    expect((result.body as { error: string }).error).toContain("no buyer tax reference");

    const stored = await env.DB.prepare("SELECT id FROM purchase_orders WHERE order_number = 'PO-NOBUYER'").first();
    expect(stored).toBeNull();
  });

  it("refuses an XML order whose buyer tax reference matches no configured legal entity", async () => {
    const unmatched = `<?xml version="1.0"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>PO-NOMATCH</cbc:ID>
  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>DE999999999</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>
  <cac:OrderLine><cac:LineItem><cbc:ID>1</cbc:ID><cac:Item><cbc:Name>Widgets</cbc:Name></cac:Item></cac:LineItem></cac:OrderLine>
</Order>`;
    const result = await handleIngestPurchaseOrder(env.DB, unmatched);
    expect(result.status).toBe(422);
    expect((result.body as { error: string }).error).toBe("buyer tax reference DE999999999 does not match any known legal entity");
  });

  it("stores the matched legal entity's own id on a successful XML ingestion", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const row = await env.DB.prepare("SELECT org_unit_id FROM purchase_orders WHERE order_number = 'PO-34500'").first<{
      org_unit_id: string;
    }>();
    expect(row?.org_unit_id).toBe("acme-uk");
  });

  it("refuses a CSV order with no buyer tax reference, while a sibling order in the same file still loads", async () => {
    const csv = `order_number,line number,item,buyer vat id
PO-GOOD,1,Widgets,GB907856452
PO-NOBUYER,1,Widgets,`;
    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({
      ordersLoaded: 1,
      refused: [{ orderNumber: "PO-NOBUYER", reason: expect.stringContaining("no buyer tax reference") }],
    });
  });

  it("refuses a CSV order whose buyer tax reference matches no configured legal entity", async () => {
    const csv = `order_number,line number,item,buyer vat id\nPO-1,1,Widgets,DE999999999`;
    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({
      ordersLoaded: 0,
      refused: [{ orderNumber: "PO-1", reason: "buyer tax reference DE999999999 does not match any known legal entity" }],
    });
  });

  it("stores the matched legal entity's own id on a successful CSV load", async () => {
    const csv = `order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452`;
    await handleLoadPurchaseOrdersCsv(env.DB, csv);
    const row = await env.DB.prepare("SELECT org_unit_id FROM purchase_orders WHERE order_number = 'PO-1'").first<{
      org_unit_id: string;
    }>();
    expect(row?.org_unit_id).toBe("acme-uk");
  });

  it("matches a VAT number written with different case or spacing to the same legal entity", async () => {
    // The same normalization deriveOrgUnit already relies on for
    // invoices — a shared function now, not a second rule that could
    // quietly diverge.
    const csv = `order_number,line number,item,buyer vat id\nPO-1,1,Widgets,gb 907 856 452`;
    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({ ordersLoaded: 1, refused: [] });
  });
});

describe("the chosen org narrows the list — decision 0374", () => {
  async function seedTwoLegalEntities() {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-fr', 'Acme France', 'legal_entity', 'FR12345678901')"
    ).run();
  }

  it("shows only orders belonging to the chosen org", async () => {
    await seedTwoLegalEntities();
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const ukOnly = await handleListPurchaseOrders(env.DB, "acme-uk");
    const ukBody = ukOnly.body as { purchaseOrders: Record<string, unknown>[] };
    expect(ukBody.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-UK"]);

    const frOnly = await handleListPurchaseOrders(env.DB, "acme-fr");
    const frBody = frOnly.body as { purchaseOrders: Record<string, unknown>[] };
    expect(frBody.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-FR"]);
  });

  it("shows every order when no org is chosen", async () => {
    await seedTwoLegalEntities();
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const all = await handleListPurchaseOrders(env.DB, null);
    const body = all.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number).sort()).toEqual(["PO-FR", "PO-UK"]);
  });

  it("keeps a pre-existing, unassigned order visible regardless of which org is chosen", async () => {
    // The exact exception decision 0255/0317 already established for
    // Tasks, Documents, and Suppliers — an unassigned row is exactly
    // what somebody needs to notice, not something hiding it helps.
    // Reachable here only for data that predates this feature, since
    // every path that stores a new order now refuses one it cannot
    // place.
    await env.DB.prepare(
      "INSERT INTO purchase_orders (id, order_number, payable_amount) VALUES ('po-legacy', 'PO-LEGACY', 100)"
    ).run();
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");

    const result = await handleListPurchaseOrders(env.DB, "acme-uk");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number).sort()).toEqual(["PO-LEGACY", "PO-UK"]);
  });
});

describe("the org's own name reaches the detail view — decision 0374", () => {
  it("returns the org unit's own name alongside its id", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    const body = result.body as { order: Record<string, unknown> };
    expect(body.order.org_unit_id).toBe("acme-uk");
    expect(body.order.org_unit_name).toBe("Acme UK");
  });
});
