import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleIngestPurchaseOrder,
  handleGetPurchaseOrder,
  handleLoadPurchaseOrdersCsv,
  handleListPurchaseOrders,
  handleGetPurchaseOrderCsvFormat,
  handleGetPurchaseOrderStatusCounts,
  handleSetPurchaseOrderStatus,
} from "../src/purchase-order-route.js";

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

/**
 * Acme UK and Acme France both beneath a parent, Acme Group — the
 * exact structure the operator's own live deployment showed. Module
 * scope, not local to one describe block — decision 0376's own
 * search and pagination tests need the same real hierarchy and
 * role-scoped user decision 0375's tests already set up.
 *
 * Acme France created here, with its parent set from the start —
 * acme-uk already exists (this file's own shared beforeEach), but
 * acme-fr does not yet, and an UPDATE naming a row that does not
 * exist yet is a silent no-op, not an error, so this was found by
 * checking the actual result rather than assuming the SQL ran.
 */
async function seedGroupHierarchy() {
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-group', 'Acme Group', 'legal_entity')").run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind, vat_id, parent_unit_id) VALUES ('acme-fr', 'Acme France', 'legal_entity', 'FR12345678901', 'acme-group') ON CONFLICT(id) DO UPDATE SET parent_unit_id = 'acme-group'"
  ).run();
  await env.DB.prepare("UPDATE org_units SET parent_unit_id = 'acme-group' WHERE id = 'acme-uk'").run();
  await env.DB.prepare(
    `INSERT INTO org_roles (id, name, permissions_json) VALUES ('validator', 'AP Validator', '["AP.Validate"]')`
  ).run();
}

async function scopeAliceTo(unitId: string | null) {
  // org_user_roles.user_id is a real foreign key — a role means
  // nothing assigned to a person who does not exist.
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('alice', 'alice@acme.com', 'Alice')").run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('alice', 'validator', ?)")
    .bind(unitId)
    .run();
}

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
    expect(result.body).toEqual({ purchaseOrders: [], total: 0, page: 1, pageSize: 50 });
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
    // seeded legal entity's own VAT or the whole order is refused;
    // status must be one of the three real lifecycle values — everything
    // else tolerates a generic placeholder just fine.
    const valueFor = (key: string) => {
      if (key === "order_type_code") return "220";
      if (key === "buyer_party_id") return "GB907856452";
      if (key === "status") return "active";
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

describe("real access control, not just a browsing convenience — decision 0375", () => {
  it("narrows to only the units a role permits, regardless of what is chosen in the switcher", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo("acme-uk");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    // Selecting the parent, which a real permission scope would
    // otherwise let her see all of — the role is what actually
    // decides, not the switcher.
    const result = await handleListPurchaseOrders(env.DB, "acme-group", "alice");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-UK"]);
  });

  it("still narrows further by the chosen org, within what the role already permits", async () => {
    await seedGroupHierarchy();
    // Held at the group level — covers both subsidiaries.
    await scopeAliceTo("acme-group");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const result = await handleListPurchaseOrders(env.DB, "acme-uk", "alice");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-UK"]);
  });

  it("refuses the detail of an order outside the caller's own permitted scope, as if it did not exist", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo("acme-uk");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const result = await handleGetPurchaseOrder(env.DB, "PO-FR", "alice");
    expect(result.status).toBe(404);
    // Identical to a genuinely nonexistent order — never a 403 that
    // would confirm the order is real.
    expect((result.body as { error: string }).error).toBe("no purchase order PO-FR");
  });

  it("returns the detail of an order the caller's own scope actually covers", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo("acme-uk");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");

    const result = await handleGetPurchaseOrder(env.DB, "PO-UK", "alice");
    expect(result.status).toBe(200);
  });

  it("keeps a pre-existing, unassigned order visible in both list and detail, regardless of a scoped caller's own role", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo("acme-uk");
    await env.DB.prepare(
      "INSERT INTO purchase_orders (id, order_number, payable_amount) VALUES ('po-legacy', 'PO-LEGACY', 100)"
    ).run();

    const list = await handleListPurchaseOrders(env.DB, null, "alice");
    const listBody = list.body as { purchaseOrders: Record<string, unknown>[] };
    expect(listBody.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-LEGACY"]);

    const detail = await handleGetPurchaseOrder(env.DB, "PO-LEGACY", "alice");
    expect(detail.status).toBe(200);
  });

  it("sees and can fetch everything when the role holds no unit restriction at all", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo(null);
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const list = await handleListPurchaseOrders(env.DB, null, "alice");
    const listBody = list.body as { purchaseOrders: Record<string, unknown>[] };
    expect(listBody.purchaseOrders.map((p) => p.order_number).sort()).toEqual(["PO-FR", "PO-UK"]);

    expect((await handleGetPurchaseOrder(env.DB, "PO-FR", "alice")).status).toBe(200);
  });
});

describe("searching the list — decision 0376", () => {
  it("matches on order number", async () => {
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id\nPO-ALPHA,1,Widgets,GB907856452\nPO-BETA,1,Widgets,GB907856452"
    );
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "ALPHA");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-ALPHA"]);
  });

  it("matches on the seller's own VAT id, a header field", async () => {
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,seller vat id,buyer vat id\nPO-1,1,Widgets,GB223344556,GB907856452\nPO-2,1,Widgets,GB998877665,GB907856452"
    );
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "GB223344556");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-1"]);
  });

  it("matches on a line's own item name", async () => {
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id\nPO-1,1,Ergonomic office chairs,GB907856452\nPO-2,1,Pallet handling,GB907856452"
    );
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "chairs");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-1"]);
  });

  it("matches on a line's own item description, independent of its name", async () => {
    const csv = `order_number,line number,item,description,buyer vat id\nPO-1,1,Widgets,a genuinely long free-text description,GB907856452`;
    await handleLoadPurchaseOrdersCsv(env.DB, csv);
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "free-text");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-1"]);
  });

  it("is case-insensitive", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "widgets");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-1"]);
  });

  it("never returns the same order twice when more than one of its own lines match, and its line count stays honest", async () => {
    const csv = `order_number,line number,item,buyer vat id
PO-1,1,Widget A,GB907856452
PO-1,2,Widget B,GB907856452
PO-1,3,Gadget,GB907856452`;
    await handleLoadPurchaseOrdersCsv(env.DB, csv);
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "Widget");
    const body = result.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders).toHaveLength(1);
    // Every line of the matched order, not just the ones the search
    // itself matched — the EXISTS subquery only decides whether the
    // header appears at all.
    expect(body.purchaseOrders[0].line_count).toBe(3);
  });

  it("treats a literal percent or underscore in the term as itself, not a SQL wildcard", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO_1,1,50% off widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPOX1,1,Something else,GB907856452");

    const percentResult = await handleListPurchaseOrders(env.DB, null, undefined, "50%");
    expect((percentResult.body as { purchaseOrders: unknown[] }).purchaseOrders).toHaveLength(1);

    // "PO_1" must not match "POX1" — a literal underscore, not "any
    // single character."
    const underscoreResult = await handleListPurchaseOrders(env.DB, null, undefined, "PO_1");
    const body = underscoreResult.body as { purchaseOrders: Record<string, unknown>[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO_1"]);
  });

  it("returns everything, unfiltered, when no search term is given", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "");
    expect((result.body as { purchaseOrders: unknown[] }).purchaseOrders).toHaveLength(1);
  });

  it("returns an empty list, not an error, when nothing matches", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "no such thing anywhere");
    const body = result.body as { purchaseOrders: unknown[]; total: number };
    expect(body.purchaseOrders).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("combines with the real permission scope — a match outside the caller's own scope never appears", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo("acme-uk");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const result = await handleListPurchaseOrders(env.DB, null, "alice", "Widgets");
    expect((result.body as { purchaseOrders: unknown[] }).purchaseOrders).toEqual([]);
  });
});

describe("real, server-side pagination — decision 0376", () => {
  async function seedManyOrders(count: number) {
    const rows = Array.from({ length: count }, (_, i) => `PO-${1000 + i},1,Widgets,GB907856452`);
    const csv = ["order_number,line number,item,buyer vat id", ...rows].join("\n");
    await handleLoadPurchaseOrdersCsv(env.DB, csv);
  }

  it("returns only pageSize rows, defaulting to 50", async () => {
    await seedManyOrders(120);
    const result = await handleListPurchaseOrders(env.DB);
    const body = result.body as { purchaseOrders: unknown[]; total: number; page: number; pageSize: number };
    expect(body.purchaseOrders).toHaveLength(50);
    expect(body.total).toBe(120);
    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(50);
  });

  it("returns the next slice on page 2, with no overlap and no gap", async () => {
    await seedManyOrders(120);
    const page1 = await handleListPurchaseOrders(env.DB, null, undefined, null, "1", "50");
    const page2 = await handleListPurchaseOrders(env.DB, null, undefined, null, "2", "50");
    const ids1 = (page1.body as { purchaseOrders: { order_number: string }[] }).purchaseOrders.map((p) => p.order_number);
    const ids2 = (page2.body as { purchaseOrders: { order_number: string }[] }).purchaseOrders.map((p) => p.order_number);
    expect(ids1).toHaveLength(50);
    expect(ids2).toHaveLength(50);
    expect(new Set([...ids1, ...ids2]).size).toBe(100);
  });

  it("returns a real, partial last page rather than padding or erroring", async () => {
    await seedManyOrders(120);
    const result = await handleListPurchaseOrders(env.DB, null, undefined, null, "3", "50");
    expect((result.body as { purchaseOrders: unknown[] }).purchaseOrders).toHaveLength(20);
  });

  it("falls back to page 1 for anything not a real positive integer", async () => {
    await seedManyOrders(5);
    for (const bad of ["0", "-1", "abc", null]) {
      const result = await handleListPurchaseOrders(env.DB, null, undefined, null, bad);
      expect((result.body as { page: number }).page).toBe(1);
    }
  });

  it("falls back to the default page size for anything outside the allowed set", async () => {
    await seedManyOrders(5);
    for (const bad of ["10", "9999", "abc", null]) {
      const result = await handleListPurchaseOrders(env.DB, null, undefined, null, null, bad);
      expect((result.body as { pageSize: number }).pageSize).toBe(50);
    }
  });

  it("accepts every page size actually offered in the UI", async () => {
    await seedManyOrders(5);
    for (const allowed of ["25", "50", "100", "200"]) {
      const result = await handleListPurchaseOrders(env.DB, null, undefined, null, null, allowed);
      expect((result.body as { pageSize: number }).pageSize).toBe(Number(allowed));
    }
  });

  it("total reflects every matching row, not just the page returned", async () => {
    await seedManyOrders(120);
    const result = await handleListPurchaseOrders(env.DB, null, undefined, null, "1", "25");
    const body = result.body as { purchaseOrders: unknown[]; total: number };
    expect(body.purchaseOrders).toHaveLength(25);
    expect(body.total).toBe(120);
  });

  it("total narrows with search, not just the page's own row count", async () => {
    await seedManyOrders(120);
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-SPECIAL,1,A rare item,GB907856452");
    const result = await handleListPurchaseOrders(env.DB, null, undefined, "rare");
    const body = result.body as { purchaseOrders: unknown[]; total: number };
    expect(body.total).toBe(1);
  });
});

describe("Hold, Release Hold, Close — decision 0377", () => {
  it("refuses to place a hold with no reason", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const result = await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "on_hold" });
    expect(result.status).toBe(400);
  });

  it("places a hold with a real reason, and it reaches the record", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const result = await handleSetPurchaseOrderStatus(env.DB, "PO-34500", {
      status: "on_hold",
      holdReason: "supplier dispute",
    });
    expect(result.status).toBe(200);

    const row = await env.DB.prepare("SELECT status, hold_reason FROM purchase_orders WHERE order_number = 'PO-34500'").first<{
      status: string;
      hold_reason: string;
    }>();
    expect(row?.status).toBe("on_hold");
    expect(row?.hold_reason).toBe("supplier dispute");
  });

  it("releasing a hold clears the reason", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "on_hold", holdReason: "dispute" });
    await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "active" });

    const row = await env.DB.prepare("SELECT status, hold_reason FROM purchase_orders WHERE order_number = 'PO-34500'").first<{
      status: string;
      hold_reason: string | null;
    }>();
    expect(row?.status).toBe("active");
    expect(row?.hold_reason).toBeNull();
  });

  it("closing is terminal — no further hand-driven status change is accepted", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "closed" });

    const again = await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "active" });
    expect(again.status).toBe(422);

    const row = await env.DB.prepare("SELECT status FROM purchase_orders WHERE order_number = 'PO-34500'").first<{
      status: string;
    }>();
    expect(row?.status).toBe("closed");
  });

  it("404s for an order that does not exist", async () => {
    const result = await handleSetPurchaseOrderStatus(env.DB, "PO-NOPE", { status: "closed" });
    expect(result.status).toBe(404);
  });

  it("400s an unrecognised status value", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    const result = await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "cancelled" });
    expect(result.status).toBe(400);
  });
});

describe("the CSV status column — decision 0377", () => {
  it("a new order with no status column defaults to Active", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");
    const row = await env.DB.prepare("SELECT status FROM purchase_orders WHERE order_number = 'PO-1'").first<{ status: string }>();
    expect(row?.status).toBe("active");
  });

  it("a new order with an explicit status column uses it", async () => {
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id,status\nPO-1,1,Widgets,GB907856452,closed"
    );
    const row = await env.DB.prepare("SELECT status FROM purchase_orders WHERE order_number = 'PO-1'").first<{ status: string }>();
    expect(row?.status).toBe("closed");
  });

  it("the ERP wins — an explicit status on re-upload overrides even a closed order", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");
    await handleSetPurchaseOrderStatus(env.DB, "PO-1", { status: "closed" });

    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id,status\nPO-1,1,Widgets,GB907856452,active"
    );

    const row = await env.DB.prepare("SELECT status FROM purchase_orders WHERE order_number = 'PO-1'").first<{ status: string }>();
    expect(row?.status).toBe("active");
  });

  it("re-uploading with the status column absent preserves the existing status, rather than resetting to Active", async () => {
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id,status,hold_reason\nPO-1,1,Widgets,GB907856452,on_hold,dispute"
    );
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");

    const row = await env.DB.prepare("SELECT status, hold_reason FROM purchase_orders WHERE order_number = 'PO-1'").first<{
      status: string;
      hold_reason: string;
    }>();
    expect(row?.status).toBe("on_hold");
    expect(row?.hold_reason).toBe("dispute");
  });

  it("refuses a row with an unrecognised status, while a sibling order still loads", async () => {
    const csv = `order_number,line number,item,buyer vat id,status
PO-GOOD,1,Widgets,GB907856452,active
PO-BAD,1,Widgets,GB907856452,cancelled`;
    const result = await handleLoadPurchaseOrdersCsv(env.DB, csv);
    expect(result.body).toMatchObject({
      ordersLoaded: 1,
      refused: [{ orderNumber: "PO-BAD", reason: expect.stringContaining("not recognised") }],
    });
  });

  it("accepts the human-friendly aliases", async () => {
    for (const [alias, expected] of [
      ["Open", "active"],
      ["On Hold", "on_hold"],
      ["Hold", "on_hold"],
      ["Close", "closed"],
    ]) {
      const csv = `order_number,line number,item,buyer vat id,status\nPO-${expected}-${alias},1,Widgets,GB907856452,${alias}`;
      await handleLoadPurchaseOrdersCsv(env.DB, csv);
      const row = await env.DB.prepare("SELECT status FROM purchase_orders WHERE order_number = ?")
        .bind(`PO-${expected}-${alias}`)
        .first<{ status: string }>();
      expect(row?.status).toBe(expected);
    }
  });
});

describe("Invoiced (Part) / Invoiced (Full), derived from real invoices — decision 0377", () => {
  async function seedInvoice(id: string, orderNumber: string, totalWithVat: number) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)")
      .bind(id, JSON.stringify({ "BT-13": orderNumber, "BT-112": totalWithVat }))
      .run();
  }

  it("an order with no matching invoices at all is Active", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER()); // payable_amount 864
    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    expect((result.body as { order: { effective_status: string } }).order.effective_status).toBe("active");
  });

  it("an order with some, but not all, of its own amount invoiced is Invoiced (Part)", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER()); // payable_amount 864
    await seedInvoice("inv-1", "PO-34500", 400);
    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    expect((result.body as { order: { effective_status: string } }).order.effective_status).toBe("invoiced_part");
  });

  it("an order whose matching invoices reach its own total is Invoiced (Full)", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER()); // payable_amount 864
    await seedInvoice("inv-1", "PO-34500", 500);
    await seedInvoice("inv-2", "PO-34500", 400); // 900 total, over the 864 payable amount
    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    expect((result.body as { order: { effective_status: string } }).order.effective_status).toBe("invoiced_full");
  });

  it("On Hold still wins over full invoicing — the lifecycle status, not the invoicing progress", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    await seedInvoice("inv-1", "PO-34500", 900);
    await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "on_hold", holdReason: "dispute" });

    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    expect((result.body as { order: { effective_status: string } }).order.effective_status).toBe("on_hold");
  });

  it("Closed still wins even with no invoices at all", async () => {
    await handleIngestPurchaseOrder(env.DB, ORDER());
    await handleSetPurchaseOrderStatus(env.DB, "PO-34500", { status: "closed" });

    const result = await handleGetPurchaseOrder(env.DB, "PO-34500");
    expect((result.body as { order: { effective_status: string } }).order.effective_status).toBe("closed");
  });
});

describe("the status chart's own aggregate — decision 0377", () => {
  async function seedInvoice(id: string, orderNumber: string, totalWithVat: number) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)")
      .bind(id, JSON.stringify({ "BT-13": orderNumber, "BT-112": totalWithVat }))
      .run();
  }

  it("counts every real bucket correctly", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-ACTIVE,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id,status,hold_reason\nPO-HOLD,1,Widgets,GB907856452,on_hold,dispute"
    );
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id,status\nPO-CLOSED,1,Widgets,GB907856452,closed"
    );
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id,order total\nPO-PART,1,Widgets,GB907856452,1000");
    await seedInvoice("inv-part", "PO-PART", 400);
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id,order total\nPO-FULL,1,Widgets,GB907856452,1000");
    await seedInvoice("inv-full", "PO-FULL", 1000);

    const result = await handleGetPurchaseOrderStatusCounts(env.DB);
    expect(result.body).toEqual({
      counts: { active: 1, on_hold: 1, closed: 1, invoiced_part: 1, invoiced_full: 1 },
    });
  });

  it("respects the chosen org", async () => {
    await seedGroupHierarchy();
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const result = await handleGetPurchaseOrderStatusCounts(env.DB, "acme-uk");
    expect((result.body as { counts: Record<string, number> }).counts.active).toBe(1);
  });

  it("respects the real, permission-based scope", async () => {
    await seedGroupHierarchy();
    await scopeAliceTo("acme-uk");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-UK,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-FR,1,Widgets,FR12345678901");

    const result = await handleGetPurchaseOrderStatusCounts(env.DB, null, "alice");
    expect((result.body as { counts: Record<string, number> }).counts.active).toBe(1);
  });
});

describe("filtering the list by status — decision 0377", () => {
  it("shows only orders in the requested bucket", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-ACTIVE,1,Widgets,GB907856452");
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      "order_number,line number,item,buyer vat id,status,hold_reason\nPO-HOLD,1,Widgets,GB907856452,on_hold,dispute"
    );

    const result = await handleListPurchaseOrders(env.DB, null, undefined, null, null, null, "on_hold");
    const body = result.body as { purchaseOrders: { order_number: string }[]; total: number };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-HOLD"]);
    expect(body.total).toBe(1);
  });

  it("filters by a derived status too, not just the stored one", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id,order total\nPO-FULL,1,Widgets,GB907856452,1000");
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', ?)")
      .bind(JSON.stringify({ "BT-13": "PO-FULL", "BT-112": 1000 }))
      .run();
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-ACTIVE,1,Widgets,GB907856452");

    const result = await handleListPurchaseOrders(env.DB, null, undefined, null, null, null, "invoiced_full");
    const body = result.body as { purchaseOrders: { order_number: string }[] };
    expect(body.purchaseOrders.map((p) => p.order_number)).toEqual(["PO-FULL"]);
  });

  it("shows everything when no status filter is given", async () => {
    await handleLoadPurchaseOrdersCsv(env.DB, "order_number,line number,item,buyer vat id\nPO-1,1,Widgets,GB907856452");
    const result = await handleListPurchaseOrders(env.DB, null, undefined, null, null, null, null);
    expect((result.body as { total: number }).total).toBe(1);
  });
});
