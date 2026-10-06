import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSetUpWarehouseProcess } from "../src/warehouse-receipts.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateSourceKey, handleListSourceKeys } from "../src/https-in-route.js";
import { handleListRouteMessages, handleGetRouteMessage } from "../src/route-monitor-route.js";
import { receiptsJsonToCsv } from "../src/receipts-in-route.js";
import { heldByLine } from "../src/goods-receipts.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Receipts in — decision 0655.** A warehouse system posts goods
 * receipts to its source on the Warehouse Receipts process, with the
 * source's key; Create's receipt CSV is a message of Receipts upload.
 * PO-300 (Northwind): line 1, 50 rolls.
 */

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-sam', 's@x.com', 'Sam'), ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Receive","Integration.Monitor"]'), ('admin', 'admin', '["Admin.Configure"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-sam', 'r'), ('u-dan', 'admin')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', 'three_way', datetime('now'))"
  ).run();
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, issue_date, currency, seller_party_id, status) VALUES ('po', 'PO-300', '2026-09-01', 'GBP', 'GB111', 'active')").run();
  await env.DB.prepare(
    "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES ('l1', 'po', 1, 50, 'EA', 500, 'Bubble wrap', 10)"
  ).run();
  await handleSetUpWarehouseProcess(env.DB, {});
});

async function warehouseApi() {
  const made = await handleCreateSource(env.DB, "warehouse-receipts", { id: "wh-api", name: "Warehouse API", mechanism: "https" });
  expect(made.status).toBe(201);
  const key = (await handleCreateSourceKey(env.DB, "u-dan", "wh-api", { name: "WMS" })).body as { key: string };
  return key.key;
}

const post = (key: string, body: string, type = "application/json", reference?: string) =>
  SELF.fetch("https://example.com/v1/sources/wh-api/receipts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": type, ...(reference ? { "X-Reference": reference } : {}) },
    body,
  });

describe("the routes and their sources", () => {
  it("are standard routes for goods receipts; the process gets its upload source and takes HTTPS sources only", async () => {
    const routes = (await env.DB.prepare("SELECT route_id, status, receiving_gateway, semantic_model FROM route_versions WHERE route_id IN ('receipts-in', 'receipts-file') ORDER BY route_id").all()).results;
    expect(routes).toEqual([
      { route_id: "receipts-file", status: "live", receiving_gateway: "file_import", semantic_model: "goods_receipt" },
      { route_id: "receipts-in", status: "live", receiving_gateway: "https", semantic_model: "goods_receipt" },
    ]);
    expect(await env.DB.prepare("SELECT s.mechanism, i.route_id FROM sources s JOIN route_instances i ON i.source_id = s.id WHERE s.id = 'upload-warehouse-receipts'").first()).toEqual({
      mechanism: "file_import",
      route_id: "receipts-file",
    });
    expect((await handleCreateSource(env.DB, "warehouse-receipts", { id: "m", name: "Mail", mechanism: "email" })).body).toMatchObject({ reason: "receipts_https_only" });
    await warehouseApi();
    expect(await env.DB.prepare("SELECT route_id FROM route_instances WHERE id = 'wh-api'").first()).toEqual({ route_id: "receipts-in" });
    // No ERP Destination for a process whose end registers receipts.
    expect((await env.DB.prepare("SELECT count(*) AS n FROM route_instances WHERE process_id = 'warehouse-receipts' AND source_id IS NULL").first<{ n: number }>())!.n).toBe(0);
    expect(((await handleListSourceKeys(env.DB, "wh-api", "https://app.example")).body as { address: string; receives: string })).toMatchObject({
      address: "https://app.example/v1/sources/wh-api/receipts",
      receives: "receipts",
    });
  });

  it("reads JSON into our CSV, one row per line, and refuses a body with no receipts or a receipt with no lines", () => {
    const r = receiptsJsonToCsv({
      receipts: [{ receiptNumber: "WH-1", receiptDate: "2026-10-05", deliveryNote: "DN, 7", lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: 5, unit: "EA" }, { line: 9, orderNumber: "PO-300", orderLine: 1, quantity: 1, movement: "returned", reason: "Damaged" }] }],
    });
    expect(r).toEqual({
      csv: 'receipt_number,receipt_line,receipt_date,order_number,order_line,quantity,movement,return_reason,unit_code,delivery_note,note\nWH-1,1,2026-10-05,PO-300,1,5,,,EA,"DN, 7",\nWH-1,9,2026-10-05,PO-300,1,1,returned,Damaged,,"DN, 7",',
      lines: 2,
    });
    expect(receiptsJsonToCsv({})).toEqual({ error: "the body needs a receipts list" });
    expect(receiptsJsonToCsv({ receipts: [{ receiptNumber: "WH-1", lines: [] }] })).toEqual({ error: "receipt WH-1 has no lines" });
  });
});

describe("Receipts in — HTTPS", () => {
  it("stores the message, sends each receipt through the process, and says what each became", async () => {
    const key = await warehouseApi();
    const res = await post(
      key,
      JSON.stringify({
        receipts: [
          { receiptNumber: "WH-1", receiptDate: "2026-10-05", lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: 10 }] },
          { receiptNumber: "WH-2", receiptDate: "2026-10-05", lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: 5 }, { orderNumber: "PO-800", orderLine: 1, quantity: 2 }] },
        ],
      }),
      "application/json",
      "Delivery 4471"
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { message: string; status: string; reference: string; receipts: unknown[]; check: string };
    expect(body).toMatchObject({ status: "delivered", reference: "Delivery 4471" });
    expect(body.receipts).toEqual([
      { receiptNumber: "WH-1", status: "registered" },
      { receiptNumber: "WH-2", status: "pending", stage: "Matching", linesWaitingForOrder: 1 },
    ]);
    expect(body.check).toBe(`https://example.com/v1/sources/wh-api/messages/${body.message}`);

    const m = await env.DB.prepare("SELECT instance_id, route_id, counterparty, recipient, status FROM route_messages WHERE id = ?").bind(body.message).first();
    expect(m).toEqual({ instance_id: "wh-api", route_id: "receipts-in", counterparty: "WMS", recipient: "Warehouse API", status: "delivered" });
    expect((await env.DB.prepare("SELECT receipt_number, created_by, route_message_id FROM goods_receipts ORDER BY receipt_number").all()).results).toEqual([
      { receipt_number: "WH-1", created_by: null, route_message_id: body.message },
      { receipt_number: "WH-2", created_by: null, route_message_id: body.message },
    ]);
    expect((await heldByLine(env.DB, "PO-300")).get(1)).toEqual({ received: 10, returned: 0 });

    // Asked again, the same answer, for this source's key only.
    const again = await SELF.fetch(body.check, { headers: { Authorization: `Bearer ${key}` } });
    expect(((await again.json()) as { receipts: unknown[] }).receipts).toEqual(body.receipts);

    // The Route monitor shows what it made.
    const listed = (await handleListRouteMessages(env.DB, new URLSearchParams("period=today"))).body as { messages: Record<string, unknown>[]; sources: { id: string }[] };
    expect(listed.messages.find((x) => x.id === body.message)).toMatchObject({ sourceName: "Warehouse API", receipts: 2, receiptsWaiting: 1, invoices: 0 });
    expect(listed.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["wh-api", "upload-warehouse-receipts"]));
    const one = (await handleGetRouteMessage(env.DB, body.message)).body as { receipts: Record<string, unknown>[] };
    expect(one.receipts.map((r) => [r.number, r.status, r.stage])).toEqual([
      ["WH-1", "registered", null],
      ["WH-2", "pending", "Matching"],
    ]);
  });

  it("takes our CSV too; a refused row makes the message partial, and every row refused fails it", async () => {
    const key = await warehouseApi();
    const csv = "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity\nWH-3,1,2026-10-05,PO-300,1,4\nWH-4,1,2026-10-05,PO-300,1,x";
    const partial = (await (await post(key, csv, "text/csv")).json()) as { status: string; refused: { row: number; reason: string }[] };
    expect(partial).toMatchObject({ status: "partial", refused: [{ row: 3, reason: "quantity_invalid" }] });
    const failed = await post(key, "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity\nWH-5,1,2026-10-05,PO-300,1,x", "text/csv");
    expect(failed.status).toBe(422);
    expect(await env.DB.prepare("SELECT status, failed_part, error_code FROM route_messages WHERE status = 'failed'").first()).toEqual({ status: "failed", failed_part: "translation", error_code: "refused" });
    // Run again would read it as invoices: it is sent again instead.
    const failedId = (await env.DB.prepare("SELECT id FROM route_messages WHERE status = 'failed'").first<{ id: string }>())!.id;
    expect((await handleGetRouteMessage(env.DB, failedId)).body).toMatchObject({ canReprocess: false, cannotReprocess: "receipts_resend" });
  });

  it("refuses without a live key for this source, a body that is not receipts, and a source that takes invoices", async () => {
    const key = await warehouseApi();
    expect((await post("vf_in_nope", "{}")).status).toBe(401);
    expect((await post(key, "not json")).status).toBe(400);
    expect((await post(key, "x", "application/pdf")).status).toBe(415);
    expect(((await (await post(key, JSON.stringify({ receipts: [] }))).json()) as { reason: string }).reason).toBe("not_receipts");
    // An invoice process's HTTPS source does not take receipts.
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await handleCreateSource(env.DB, "ap", { id: "ap-api", name: "Portal", mechanism: "https" });
    const apKey = ((await handleCreateSourceKey(env.DB, "u-dan", "ap-api", { name: "Portal" })).body as { key: string }).key;
    const r = await SELF.fetch("https://example.com/v1/sources/ap-api/receipts", { method: "POST", headers: { Authorization: `Bearer ${apKey}`, "Content-Type": "application/json" }, body: "{}" });
    expect(r.status).toBe(404);
  });
});

describe("Receipts upload — Create's CSV", () => {
  it("is one message from the person, named by the file, and its receipts name it", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-sam'").bind(await hashApiKey(key)).run();
    const res = await SELF.fetch("https://example.com/goods-receipts/csv-load?name=week-40.csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/csv" },
      body: "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity\nWH-9,1,2026-10-05,PO-300,1,4",
    });
    const body = (await res.json()) as { messageId: string; receipts: { receiptNumber: string }[]; process: { sent: { status: string }[] } };
    expect(body.receipts.map((r) => r.receiptNumber)).toEqual(["WH-9"]);
    expect(body.process.sent.map((s) => s.status)).toEqual(["registered"]);
    expect(await env.DB.prepare("SELECT instance_id, route_id, counterparty, subject, status FROM route_messages WHERE id = ?").bind(body.messageId).first()).toEqual({
      instance_id: "upload-warehouse-receipts",
      route_id: "receipts-file",
      counterparty: "Sam <s@x.com>",
      subject: "Upload of week-40.csv",
      status: "delivered",
    });
    expect(await env.DB.prepare("SELECT created_by, route_message_id FROM goods_receipts").first()).toEqual({ created_by: "u-sam", route_message_id: body.messageId });
  });
});
