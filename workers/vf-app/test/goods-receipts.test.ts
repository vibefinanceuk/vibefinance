import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleIngestPurchaseOrder, handleListPurchaseOrders, handleLoadPurchaseOrdersCsv } from "../src/purchase-order-route.js";
import {
  handleCancelGoodsReceipt,
  handleCreateGoodsReceipt,
  handleGetGoodsReceipt,
  handleGetOrderReceipts,
  handleGoodsReceiptStatusCounts,
  handleListGoodsReceipts,
  handleLoadGoodsReceiptsCsv,
  lineState,
  orderFigures,
} from "../src/goods-receipts.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Goods receipts, the register — decision 0644.** PO-4501 (Acme UK,
 * Northwind, Receipting required): line 1, 200 cartons; line 2, 50 rolls
 * of bubble wrap; line 3, 120 rolls of tape. PO-7000 is Acme France's.
 */

const PO_CSV = `order_number,buyer_party_id,seller_party_id,currency,line_number,quantity,unit_code,item_name,price_amount
PO-4501,GB907856452,GB111,GBP,1,200,EA,Shipping carton,1
PO-4501,GB907856452,GB111,GBP,2,50,EA,Bubble wrap roll,10
PO-4501,GB907856452,GB111,GBP,3,120,EA,Packing tape,2
PO-7000,FR12345678901,FR222,EUR,1,10,EA,Pallet,30`;

async function role(id: string, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(id, id, JSON.stringify(permissions)).run();
}
async function person(id: string, roleId: string, unitId: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id[0].toUpperCase() + id.slice(1)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, roleId, unitId).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-uk', 'Acme UK', 'legal_entity', 'GB907856452')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-fr', 'Acme France', 'legal_entity', 'FR12345678901')").run();
  expect((await handleLoadPurchaseOrdersCsv(env.DB, PO_CSV)).body).toMatchObject({ ordersLoaded: 2 });
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('northwind', 'N1', 'Northwind Packaging', 'GB111', 'active', 'three_way', datetime('now'))"
  ).run();
  await role("receiving", ["AP.Receive"]);
  await role("validating", ["AP.Validate"]);
  await person("sam", "receiving", "acme-uk");
  await person("cara", "validating", "acme-uk");
  await person("pat", "receiving", "acme-fr");
});

const receive = (lines: Record<string, unknown>[], number = "GR-1001", date = "2026-09-29", by = "sam") =>
  handleCreateGoodsReceipt(env.DB, by, { receiptNumber: number, receiptDate: date, deliveryNote: "DN-1", lines });

async function invoice(id: string, lines: [number, number][]) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)").bind(id, JSON.stringify({ "BT-13": "PO-4501" })).run();
  for (const [i, [poLine, qty]] of lines.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, i + 1, JSON.stringify({ "BT-132": String(poLine), "BT-129": qty, "BT-131": qty }))
      .run();
  }
}

describe("a line's state", () => {
  it("is not, partially, fully or over-received, within the tolerance", () => {
    expect(lineState(50, 0, 0)).toBe("not_received");
    expect(lineState(50, 35, 0)).toBe("partially_received");
    expect(lineState(50, 50, 0)).toBe("fully_received");
    expect(lineState(50, 51, 0)).toBe("over_received");
    expect(lineState(50, 49, 5)).toBe("fully_received");
    expect(lineState(50, 52, 5)).toBe("fully_received");
    expect(lineState(50, 53, 5)).toBe("over_received");
  });
});

describe("recording on the screen", () => {
  it("receives, returns with a reason, and works out each line and the order", async () => {
    const first = await receive([
      { orderNumber: "PO-4501", orderLine: 1, quantity: 200 },
      { orderNumber: "PO-4501", orderLine: 2, quantity: 40 },
      { orderNumber: "PO-4501", orderLine: 3, quantity: 60 },
    ]);
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ receiptNumber: "GR-1001", lines: 3, warnings: [] });

    await invoice("inv-1", [[2, 40]]);
    const back = await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 5, movement: "returned", returnReason: "damaged" }], "GR-1002", "2026-10-03");
    expect(back.status).toBe(201);

    const f = (await orderFigures(env.DB, "PO-4501"))!;
    expect(f.receiptingRequired).toBe(true);
    expect(f.supplier?.name).toBe("Northwind Packaging");
    expect(f.state).toBe("partially_received");
    expect(f.creditExpected).toBe(true);
    expect(f.lines.map((l) => [l.lineNumber, l.ordered, l.received, l.returned, l.net, l.outstanding, l.invoiced, l.state, l.creditExpected])).toEqual([
      [1, 200, 200, 0, 200, 0, 0, "fully_received", 0],
      [2, 50, 40, 5, 35, 15, 40, "partially_received", 5],
      [3, 120, 60, 0, 60, 60, 0, "partially_received", 0],
    ]);

    // The order's picture, oldest first, with the reason in words.
    const picture = (await handleGetOrderReceipts(env.DB, "cara", "PO-4501")).body as { movements: { receiptNumber: string; movement: string; returnReason: string | null; createdBy: string }[] };
    expect(picture.movements.at(-1)).toMatchObject({ receiptNumber: "GR-1002", movement: "returned", returnReason: "Damaged", createdBy: "Sam" });
  });

  it("saves more than ordered, with a warning", async () => {
    const r = await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 55 }]);
    expect(r.status).toBe(201);
    expect((r.body as { warnings: unknown[] }).warnings).toEqual([{ orderNumber: "PO-4501", orderLine: 2, ordered: 50, netAfter: 55 }]);
    expect((await orderFigures(env.DB, "PO-4501"))!.lines[1].state).toBe("over_received");
  });

  it("refuses, saying which line and why, and records nothing", async () => {
    const refused = async (lines: Record<string, unknown>[], reason: string, by = "sam") => {
      const r = await receive(lines, `GR-${reason}`, "2026-09-29", by);
      expect(r.status, reason).toBe(422);
      expect((r.body as { reason: string }).reason).toBe(reason);
    };
    await refused([{ orderNumber: "PO-9999", orderLine: 1, quantity: 1 }], "order_not_found");
    // Acme France's order is not Sam's: it reads as not there.
    await refused([{ orderNumber: "PO-7000", orderLine: 1, quantity: 1 }], "order_not_found");
    await refused([{ orderNumber: "PO-4501", orderLine: 9, quantity: 1 }], "order_line_not_found");
    await refused([{ orderNumber: "PO-4501", orderLine: 1, quantity: 0 }], "quantity_invalid");
    await refused([{ orderNumber: "PO-4501", orderLine: 1, quantity: 1, unitCode: "BOX" }], "unit_mismatch");
    await refused([{ orderNumber: "PO-4501", orderLine: 1, quantity: 1, movement: "returned" }], "return_reason_missing");
    await refused([{ orderNumber: "PO-4501", orderLine: 1, quantity: 1, movement: "returned", returnReason: "bored" }], "return_reason_unknown");
    await refused([{ orderNumber: "PO-4501", orderLine: 1, quantity: 1, movement: "returned", returnReason: "Damaged" }], "return_exceeds_received");
    // Received and returned in the same receipt is judged in order.
    const both = await receive([
      { orderNumber: "PO-4501", orderLine: 1, quantity: 10 },
      { orderNumber: "PO-4501", orderLine: 1, quantity: 10, movement: "returned", returnReason: "Rejected on delivery" },
    ], "GR-BOTH");
    expect(both.status).toBe(201);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM goods_receipts WHERE receipt_number LIKE 'GR-%' AND receipt_number <> 'GR-BOTH'").first<{ n: number }>())!.n).toBe(0);

    expect((await receive([{ orderNumber: "PO-4501", orderLine: 1, quantity: 1 }], "GR-BOTH")).status).toBe(409);
    expect((await handleCreateGoodsReceipt(env.DB, "sam", { receiptNumber: "X", receiptDate: "2026-02-30", lines: [{}] })).status).toBe(400);

    await env.DB.prepare("UPDATE purchase_orders SET status = 'closed' WHERE order_number = 'PO-4501'").run();
    await refused([{ orderNumber: "PO-4501", orderLine: 1, quantity: 1 }], "order_closed");
  });
});

describe("cancelling a receipt", () => {
  it("keeps it, marked, counts it for nothing, and will not strand a return", async () => {
    const r = await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 40 }]);
    const id = (r.body as { id: string }).id;
    const ret = await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 5, movement: "returned", returnReason: "damaged" }], "GR-1002");
    const retId = (ret.body as { id: string }).id;

    const blocked = await handleCancelGoodsReceipt(env.DB, "sam", id, { reason: "Wrong PO" });
    expect(blocked.status).toBe(409);
    expect((blocked.body as { reason: string }).reason).toBe("returns_depend_on_it");

    expect((await handleCancelGoodsReceipt(env.DB, "sam", retId, {})).status).toBe(400);
    expect((await handleCancelGoodsReceipt(env.DB, "sam", retId, { reason: "Not sent back after all" })).status).toBe(200);
    expect((await handleCancelGoodsReceipt(env.DB, "sam", id, { reason: "Wrong PO" })).status).toBe(200);
    expect((await handleCancelGoodsReceipt(env.DB, "sam", id, { reason: "again" })).status).toBe(409);
    // Pat, in France, cannot see it at all.
    expect((await handleCancelGoodsReceipt(env.DB, "pat", id, { reason: "x" })).status).toBe(404);

    expect((await orderFigures(env.DB, "PO-4501"))!.lines[1]).toMatchObject({ received: 0, returned: 0, state: "not_received" });
    const one = (await handleGetGoodsReceipt(env.DB, "cara", id)).body as { receipt: { cancelled: boolean; cancelReason: string; cancelledBy: string } };
    expect(one.receipt).toMatchObject({ cancelled: true, cancelReason: "Wrong PO", cancelledBy: "Sam" });
  });
});

describe("the CSV", () => {
  const FILE = `GR Number,GR Line,Receipt Date,PO Number,PO Line,Qty,Movement,Return Reason,Delivery Note
GR-2001,1,2026-10-01,PO-4501,1,200,,,DN-9
GR-2001,2,2026-10-01,PO-4501,2,50,,,DN-9
GR-2002,1,2026-10-02,PO-4501,2,4,returned,Wrong item,
GR-2003,1,2026-10-02,PO-4501,7,1,,,
GR-2004,1,2026-10-02,PO-4501,3,1,returned,Damaged,
GR-2005,1,2026-10-02,PO-7000,1,1,,,
GR-2006,1,02/10/2026,PO-4501,3,1,,,`;

  it("loads what it can, says row by row what it refused, and loading again changes nothing", async () => {
    const r = await handleLoadGoodsReceiptsCsv(env.DB, "sam", FILE);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ receiptsCreated: 2, linesLoaded: 3, linesSkipped: 0 });
    expect((r.body as { refused: { row: number; reason: string }[] }).refused.map((x) => [x.row, x.reason])).toEqual([
      [5, "order_line_not_found"],
      [6, "return_exceeds_received"],
      [7, "order_not_found"],
      [8, "date_invalid"],
    ]);
    const lines = (await orderFigures(env.DB, "PO-4501"))!.lines;
    expect(lines[1]).toMatchObject({ received: 50, returned: 4, net: 46, outstanding: 4, state: "partially_received" });

    const again = await handleLoadGoodsReceiptsCsv(env.DB, "sam", FILE);
    expect(again.body).toMatchObject({ receiptsCreated: 0, linesLoaded: 0, linesSkipped: 3 });
    expect((await orderFigures(env.DB, "PO-4501"))!.lines[1].net).toBe(46);

    // A new line for a receipt already on file is added to it.
    const more = await handleLoadGoodsReceiptsCsv(env.DB, "sam", "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity\nGR-2001,3,2026-10-01,PO-4501,3,120");
    expect(more.body).toMatchObject({ receiptsCreated: 0, linesLoaded: 1 });
    expect((await orderFigures(env.DB, "PO-4501"))!.lines[2].state).toBe("fully_received");
  });

  it("refuses a file missing a required column", async () => {
    const r = await handleLoadGoodsReceiptsCsv(env.DB, "sam", "receipt_number,order_number,quantity\nA,PO-4501,1");
    expect(r.status).toBe(400);
    expect((r.body as { missing: string[] }).missing).toEqual(["receipt_line", "receipt_date", "order_line"]);
  });
});

describe("change orders", () => {
  it("keeps receipts when the PO is loaded again, and shows a line it no longer has", async () => {
    await receive([
      { orderNumber: "PO-4501", orderLine: 2, quantity: 35 },
      { orderNumber: "PO-4501", orderLine: 3, quantity: 10 },
    ]);
    // The change order: line 2 lowered to 35, line 3 dropped.
    await handleLoadPurchaseOrdersCsv(
      env.DB,
      `order_number,buyer_party_id,seller_party_id,line_number,quantity,unit_code,item_name
PO-4501,GB907856452,GB111,1,200,EA,Shipping carton
PO-4501,GB907856452,GB111,2,35,EA,Bubble wrap roll`
    );
    const f = (await orderFigures(env.DB, "PO-4501"))!;
    expect(f.lines.map((l) => [l.lineNumber, l.onOrder, l.state])).toEqual([
      [1, true, "not_received"],
      [2, true, "fully_received"],
      [3, false, "over_received"],
    ]);
    expect(f.state).toBe("partially_received");
  });
});

describe("on the Purchase Orders screen — decision 0646", () => {
  it("gives each order its receipt state, filters by it, and leaves orders receipting does not concern without one", async () => {
    await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 40 }]);
    const list = async (receipt: string | null) =>
      ((await handleListPurchaseOrders(env.DB, null, undefined, null, null, null, null, receipt)).body as { purchaseOrders: { order_number: string; receipt_state: string | null }[]; total: number });
    const all = await list(null);
    expect(Object.fromEntries(all.purchaseOrders.map((p) => [p.order_number, p.receipt_state]))).toEqual({ "PO-4501": "partially_received", "PO-7000": null });
    expect((await list("partially_received")).purchaseOrders.map((p) => p.order_number)).toEqual(["PO-4501"]);
    expect((await list("fully_received")).total).toBe(0);
    expect((await list("nonsense")).total).toBe(0);

    // Fully received with the supplier's tolerance: 48 of 50 within 5%.
    await env.DB.prepare("UPDATE suppliers SET quantity_tolerance_pct = 5").run();
    await receive([{ orderNumber: "PO-4501", orderLine: 1, quantity: 200 }, { orderNumber: "PO-4501", orderLine: 2, quantity: 8 }, { orderNumber: "PO-4501", orderLine: 3, quantity: 120 }], "GR-1009");
    expect((await list("fully_received")).purchaseOrders.map((p) => p.order_number)).toEqual(["PO-4501"]);
  });

  it("says when a change order meets goods already received, by CSV and by Peppol order", async () => {
    await receive([
      { orderNumber: "PO-4501", orderLine: 2, quantity: 40 },
      { orderNumber: "PO-4501", orderLine: 3, quantity: 10 },
    ]);
    const csv = await handleLoadPurchaseOrdersCsv(
      env.DB,
      `order_number,buyer_party_id,seller_party_id,line_number,quantity,unit_code,item_name
PO-4501,GB907856452,GB111,1,200,EA,Shipping carton
PO-4501,GB907856452,GB111,2,30,EA,Bubble wrap roll`
    );
    expect((csv.body as { receiptWarnings: unknown[] }).receiptWarnings).toEqual([
      { orderNumber: "PO-4501", line: 2, kind: "below_received", net: 40, ordered: 30 },
      { orderNumber: "PO-4501", line: 3, kind: "line_removed", net: 10 },
    ]);
    // A first load of an order has nothing to warn about.
    expect((await handleLoadPurchaseOrdersCsv(env.DB, "order_number,buyer_party_id,line_number,quantity,item_name\nPO-NEW,GB907856452,1,5,Thing")).body).toMatchObject({ receiptWarnings: [] });
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>PO-4501</cbc:ID><cbc:IssueDate>2026-07-15</cbc:IssueDate>
  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>GB907856452</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>
  <cac:OrderLine><cac:LineItem><cbc:ID>1</cbc:ID><cbc:Quantity unitCode="EA">200</cbc:Quantity><cac:Item><cbc:Name>Shipping carton</cbc:Name></cac:Item></cac:LineItem></cac:OrderLine>
</Order>`;
    const ingested = await handleIngestPurchaseOrder(env.DB, xml);
    expect((ingested.body as { receiptWarnings: { line: number; kind: string }[] }).receiptWarnings.map((w) => [w.line, w.kind])).toEqual([
      [2, "line_removed"],
      [3, "line_removed"],
    ]);
  });
});

describe("seeing the register", () => {
  it("lists, searches and scopes receipts, with each order's state now; counts orders by state", async () => {
    await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 40 }]);
    await receive([{ orderNumber: "PO-4501", orderLine: 2, quantity: 5, movement: "returned", returnReason: "damaged" }], "GR-1002", "2026-10-03");
    await invoice("inv-1", [[2, 40]]);
    await handleCreateGoodsReceipt(env.DB, "pat", { receiptNumber: "FR-1", receiptDate: "2026-10-01", lines: [{ orderNumber: "PO-7000", orderLine: 1, quantity: 10 }] });

    const list = (await handleListGoodsReceipts(env.DB, "cara", {})).body as {
      total: number;
      receipts: { receiptNumber: string; movements: string[]; returnReason: string | null; createdBy: string; orders: { orderNumber: string; state: string; creditExpected: boolean; supplier: string }[] }[];
    };
    expect(list.total).toBe(2);
    expect(list.receipts[0]).toMatchObject({
      receiptNumber: "GR-1002",
      movements: ["returned"],
      returnReason: "Damaged",
      createdBy: "Sam",
      orders: [{ orderNumber: "PO-4501", state: "partially_received", creditExpected: true, supplier: "Northwind Packaging" }],
    });
    // Search by item and by supplier; the clerk sees nothing of France.
    expect(((await handleListGoodsReceipts(env.DB, "cara", { search: "bubble" })).body as { total: number }).total).toBe(2);
    expect(((await handleListGoodsReceipts(env.DB, "cara", { search: "northwind", kind: "returned" })).body as { total: number }).total).toBe(1);
    expect(((await handleListGoodsReceipts(env.DB, "pat", {})).body as { receipts: { receiptNumber: string }[] }).receipts.map((r) => r.receiptNumber)).toEqual(["FR-1"]);
    expect((await handleGetGoodsReceipt(env.DB, "pat", (list.receipts[0] as unknown as { id: string }).id)).status).toBe(404);
    expect((await handleGetOrderReceipts(env.DB, "pat", "PO-4501")).status).toBe(404);

    const counts = (await handleGoodsReceiptStatusCounts(env.DB, "cara", null)).body as { counts: Record<string, number> };
    expect(counts.counts).toEqual({ not_received: 0, partially_received: 1, fully_received: 0, over_received: 0, credit_expected: 1 });
  });
});

describe("through the router", () => {
  async function keyFor(userId: string) {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(key), userId).run();
    return key;
  }

  it("lets AP.Receive record and AP.Validate only look", async () => {
    const sam = await keyFor("sam");
    const cara = await keyFor("cara");
    const post = (key: string) =>
      SELF.fetch("https://example.com/goods-receipts", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ receiptNumber: "GR-R1", receiptDate: "2026-10-01", lines: [{ orderNumber: "PO-4501", orderLine: 1, quantity: 5 }] }),
      });
    expect((await post(cara)).status).toBe(403);
    expect((await post(sam)).status).toBe(201);
    const listed = await SELF.fetch("https://example.com/goods-receipts", { headers: { Authorization: `Bearer ${cara}` } });
    expect(listed.status).toBe(200);
    expect(((await listed.json()) as { total: number }).total).toBe(1);
    expect((await SELF.fetch("https://example.com/goods-receipts/status-counts", { headers: { Authorization: `Bearer ${cara}` } })).status).toBe(200);
    expect((await SELF.fetch("https://example.com/goods-receipts/order/PO-4501", { headers: { Authorization: `Bearer ${cara}` } })).status).toBe(200);
    expect((await SELF.fetch("https://example.com/goods-receipts/csv-format", { headers: { Authorization: `Bearer ${cara}` } })).status).toBe(403);
    const format = await SELF.fetch("https://example.com/goods-receipts/csv-format", { headers: { Authorization: `Bearer ${sam}` } });
    expect(((await format.json()) as { fields: { key: string }[] }).fields[0].key).toBe("receipt_number");
    const load = await SELF.fetch("https://example.com/goods-receipts/csv-load", {
      method: "POST",
      headers: { Authorization: `Bearer ${sam}`, "Content-Type": "text/csv" },
      body: "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity\nGR-R2,1,2026-10-01,PO-4501,3,1",
    });
    expect(((await load.json()) as { linesLoaded: number }).linesLoaded).toBe(1);
  });
});
