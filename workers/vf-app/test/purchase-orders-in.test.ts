import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSetUpOrdersProcess, readOrdersFile, readOrdersJson } from "../src/purchase-orders-in.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateSourceKey, handleListSourceKeys } from "../src/https-in-route.js";
import { handleGetRouteMessage, handleListRouteMessages } from "../src/route-monitor-route.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Purchase orders by Source Routes — decision 0749.** A procurement
 * system sends orders to its source on the Purchase Orders process (HTTPS
 * with the source's key, or email); Purchase Orders' own load is a message
 * of Orders upload. Each order is staged, sent through the process, and
 * released at Complete. Acme UK is GB907856452.
 */

const ORDER = (number: string, lines = 1) => `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:fdc:peppol.eu:poacc:trns:order:3</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:poacc:bis:order_only:3</cbc:ProfileID>
  <cbc:ID>${number}</cbc:ID>
  <cbc:IssueDate>2026-10-12</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>GBP</cbc:DocumentCurrencyCode>
  <cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>GB111</cbc:ID></cac:PartyIdentification></cac:Party></cac:SellerSupplierParty>
  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>GB907856452</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>
  ${Array.from({ length: lines }, (_, i) => `<cac:OrderLine><cac:LineItem><cbc:ID>${i + 1}</cbc:ID><cbc:Quantity unitCode="EA">10</cbc:Quantity><cac:Item><cbc:Name>Bubble wrap</cbc:Name></cac:Item></cac:LineItem></cac:OrderLine>`).join("\n  ")}
</Order>`;

const JSON_ORDER = (id: string, buyer = "GB907856452") => ({
  id,
  issueDate: "2026-10-12",
  documentCurrencyCode: "GBP",
  buyerCustomerParty: { id: buyer },
  sellerSupplierParty: { id: "GB111" },
  anticipatedMonetaryTotal: { lineExtensionAmount: 500, payableAmount: 600 },
  orderLines: [{ quantity: 50, unitCode: "EA", lineExtensionAmount: 500, price: { priceAmount: 10 }, item: { name: "Bubble wrap", sellersItemId: "BW-1" } }],
});

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('admin', 'admin', '["Admin.Configure","AP.Validate","Integration.Monitor"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-dan', 'admin')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-uk', 'Acme UK', 'legal_entity', 'GB907856452')").run();
  expect((await handleSetUpOrdersProcess(env.DB, {})).status).toBe(201);
});

async function procurementApi() {
  expect((await handleCreateSource(env.DB, "purchase-orders", { id: "erp-po", name: "Procurement", mechanism: "https" })).status).toBe(201);
  return ((await handleCreateSourceKey(env.DB, "u-dan", "erp-po", { name: "Coupa" })).body as { key: string }).key;
}

const post = (key: string, body: string, type: string, reference?: string) =>
  SELF.fetch("https://example.com/v1/sources/erp-po/orders", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": type, ...(reference ? { "X-Reference": reference } : {}) },
    body,
  });

describe("the routes, the process and its sources", () => {
  it("are standard routes for purchase orders; the process has its stages and upload source, and takes HTTPS and email sources only", async () => {
    const routes = (await env.DB.prepare("SELECT route_id, status, receiving_gateway, semantic_model FROM route_versions WHERE route_id LIKE 'orders-%' ORDER BY route_id").all()).results;
    expect(routes).toEqual([
      { route_id: "orders-email", status: "live", receiving_gateway: "email", semantic_model: "purchase_order" },
      { route_id: "orders-file", status: "live", receiving_gateway: "file_import", semantic_model: "purchase_order" },
      { route_id: "orders-in", status: "live", receiving_gateway: "https", semantic_model: "purchase_order" },
    ]);
    const stages = (await env.DB.prepare("SELECT s.name FROM process_stage_versions v JOIN process_stages s ON s.id = v.stage_id WHERE v.process_id = 'purchase-orders' ORDER BY v.sequence").all()).results;
    expect(stages.map((s) => (s as { name: string }).name)).toEqual(["Intake", "Checking", "Complete"]);
    expect(await env.DB.prepare("SELECT subject_type FROM processes WHERE id = 'purchase-orders'").first()).toEqual({ subject_type: "purchase_order" });
    expect(await env.DB.prepare("SELECT s.mechanism, i.route_id FROM sources s JOIN route_instances i ON i.source_id = s.id WHERE s.id = 'upload-purchase-orders'").first()).toEqual({ mechanism: "file_import", route_id: "orders-file" });
    // Asked again, nothing changes.
    expect((await handleSetUpOrdersProcess(env.DB, {})).body).toMatchObject({ created: false });

    await procurementApi();
    expect((await handleCreateSource(env.DB, "purchase-orders", { id: "po-mail", name: "Orders mailbox", mechanism: "email" })).status).toBe(201);
    expect((await handleCreateSource(env.DB, "purchase-orders", { id: "po-sftp", name: "SFTP", mechanism: "sftp" })).body).toMatchObject({ reason: "orders_https_or_email" });
    expect((await env.DB.prepare("SELECT id, route_id FROM route_instances WHERE id IN ('erp-po', 'po-mail') ORDER BY id").all()).results).toEqual([
      { id: "erp-po", route_id: "orders-in" },
      { id: "po-mail", route_id: "orders-email" },
    ]);
    // No ERP Destination: Complete releases the order.
    expect((await env.DB.prepare("SELECT count(*) AS n FROM route_instances WHERE process_id = 'purchase-orders' AND source_id IS NULL").first<{ n: number }>())!.n).toBe(0);
    expect((await handleListSourceKeys(env.DB, "erp-po", "https://app.example")).body).toMatchObject({ address: "https://app.example/v1/sources/erp-po/orders", receives: "orders" });
  });
});

describe("reading an order, whatever it was sent as", () => {
  it("reads JSON named after the Peppol BIS order's elements, a line's id defaulting to its place", () => {
    const read = readOrdersJson({ orders: [JSON_ORDER("PO-1")] });
    expect(read).toEqual({
      entries: [
        {
          order: {
            parsed: {
              orderNumber: "PO-1",
              issueDate: "2026-10-12",
              orderTypeCode: undefined,
              currency: "GBP",
              sellerPartyId: "GB111",
              buyerPartyId: "GB907856452",
              lineExtensionAmount: 500,
              taxExclusiveAmount: undefined,
              taxInclusiveAmount: undefined,
              payableAmount: 600,
              originatorReference: undefined,
              lines: [{ lineNumber: 1, quantity: 50, unitCode: "EA", lineExtensionAmount: 500, itemName: "Bubble wrap", itemDescription: undefined, sellersItemId: "BW-1", standardItemId: undefined, priceAmount: 10, baseQuantity: undefined }],
            },
            status: undefined,
            holdReason: undefined,
          },
        },
      ],
    });
  });

  it("holds every order to the same line rules, and tells XML, JSON and CSV apart", () => {
    expect(readOrdersJson({})).toEqual({ error: "the body needs an orders list", reason: "not_orders" });
    const refused = readOrdersJson({ orders: [{ ...JSON_ORDER("PO-2"), orderLines: [] }, { ...JSON_ORDER("PO-3"), orderLines: [{ id: 1, quantity: 1 }] }] });
    expect(refused).toEqual({
      entries: [{ refused: { orderNumber: "PO-2", reason: "the order has no lines" } }, { refused: { orderNumber: "PO-3", reason: "line(s) 1 have neither an item name nor an identifier" } }],
    });
    const xml = readOrdersFile(ORDER("PO-X", 2));
    expect("entries" in xml && xml.entries.map((e) => ("order" in e ? [e.order.parsed.orderNumber, e.order.parsed.lines.length] : null))).toEqual([["PO-X", 2]]);
    const csv = readOrdersFile("order_number,buyer_party_id,line_number,item_name\nPO-C,GB907856452,1,Tape");
    expect("entries" in csv && csv.entries.length).toBe(1);
    expect(readOrdersFile("{ not json")).toMatchObject({ reason: "not_json" });
  });
});

describe("Orders in — HTTPS", () => {
  it("stores the message, sends the order through the process, releases it, and says so", async () => {
    const key = await procurementApi();
    const res = await post(key, ORDER("PO-4501"), "application/xml", "PO-4501");
    expect(res.status).toBe(202);
    const body = (await res.json()) as { message: string; status: string; reference: string; orders: unknown[]; check: string };
    expect(body).toMatchObject({ status: "delivered", reference: "PO-4501", orders: [{ orderNumber: "PO-4501", status: "released", change: false }] });
    expect(body.check).toBe(`https://example.com/v1/sources/erp-po/messages/${body.message}`);

    expect(await env.DB.prepare("SELECT order_number, org_unit_id, currency, status FROM purchase_orders").first()).toEqual({ order_number: "PO-4501", org_unit_id: "acme-uk", currency: "GBP", status: "active" });
    expect(await env.DB.prepare("SELECT status, purchase_order_id IS NOT NULL AS named, created_by FROM purchase_order_intake").first()).toEqual({ status: "released", named: 1, created_by: null });
    expect(await env.DB.prepare("SELECT instance_id, route_id, counterparty, status FROM route_messages WHERE id = ?").bind(body.message).first()).toEqual({
      instance_id: "erp-po",
      route_id: "orders-in",
      counterparty: "Coupa",
      status: "delivered",
    });
    expect(await env.DB.prepare("SELECT status FROM process_instances WHERE subject_type = 'purchase_order'").first()).toEqual({ status: "completed" });

    // Asked again, the same answer.
    const again = await SELF.fetch(body.check, { headers: { Authorization: `Bearer ${key}` } });
    expect(((await again.json()) as { orders: unknown[] }).orders).toEqual(body.orders);

    // The Route monitor shows what it brought; running it again is refused.
    const listed = (await handleListRouteMessages(env.DB, new URLSearchParams("period=today"))).body as { messages: Record<string, unknown>[]; sources: { id: string }[] };
    expect(listed.messages.find((m) => m.id === body.message)).toMatchObject({ orders: 1, ordersWaiting: 0, invoices: 0 });
    expect(listed.sources.map((s) => s.id)).toEqual(expect.arrayContaining(["erp-po", "upload-purchase-orders"]));
    const one = (await handleGetRouteMessage(env.DB, body.message)).body as { orders: Record<string, unknown>[] };
    expect(one.orders.map((o) => [o.number, o.status, o.change])).toEqual([["PO-4501", "released", false]]);
  });

  it("an order sent again is a change, and replaces the order of its number when released", async () => {
    const key = await procurementApi();
    await post(key, ORDER("PO-7"), "application/xml");
    const res = await post(key, ORDER("PO-7", 3), "application/xml");
    expect(((await res.json()) as { orders: unknown[] }).orders).toEqual([{ orderNumber: "PO-7", status: "released", change: true }]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM purchase_orders").first<{ n: number }>())!.n).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM purchase_order_lines").first<{ n: number }>())!.n).toBe(3);
  });

  it("takes JSON too; an order for an unknown company is refused and the message partial, every order refused fails it", async () => {
    const key = await procurementApi();
    const partial = (await (await post(key, JSON.stringify({ orders: [JSON_ORDER("PO-1"), JSON_ORDER("PO-2", "DE999")] }), "application/json")).json()) as Record<string, unknown>;
    expect(partial).toMatchObject({
      status: "partial",
      orders: [{ orderNumber: "PO-1", status: "released" }],
      refused: [{ orderNumber: "PO-2", reason: "buyer tax reference DE999 does not match any known legal entity" }],
    });
    const failed = await post(key, JSON.stringify({ orders: [JSON_ORDER("PO-3", "DE999")] }), "application/json");
    expect(failed.status).toBe(422);
    expect(await env.DB.prepare("SELECT failed_part, error_code FROM route_messages WHERE status = 'failed'").first()).toEqual({ failed_part: "translation", error_code: "refused" });
    // Run again would read it as invoices: it is sent again instead.
    const failedId = (await env.DB.prepare("SELECT id FROM route_messages WHERE status = 'failed'").first<{ id: string }>())!.id;
    expect((await handleGetRouteMessage(env.DB, failedId)).body).toMatchObject({ canReprocess: false, cannotReprocess: "orders_resend" });
  });

  it("refuses without a live key, a body that is not orders, another type, and a source that does not take orders", async () => {
    const key = await procurementApi();
    expect((await post("vf_in_nope", "{}", "application/json")).status).toBe(401);
    expect((await post(key, "not json", "application/json")).status).toBe(400);
    expect((await post(key, "x", "application/pdf")).status).toBe(415);
    expect(((await (await post(key, JSON.stringify({ orders: [] }), "application/json")).json()) as { reason: string }).reason).toBe("not_orders");
    // An XML body that is not an order is stored, and fails at its format.
    const notOrder = await post(key, "<Invoice/>", "application/xml");
    expect(notOrder.status).toBe(422);
    expect(await env.DB.prepare("SELECT failed_part FROM route_messages WHERE status = 'failed'").first()).toEqual({ failed_part: "format" });
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await handleCreateSource(env.DB, "ap", { id: "ap-api", name: "Portal", mechanism: "https" });
    const apKey = ((await handleCreateSourceKey(env.DB, "u-dan", "ap-api", { name: "Portal" })).body as { key: string }).key;
    const r = await SELF.fetch("https://example.com/v1/sources/ap-api/orders", { method: "POST", headers: { Authorization: `Bearer ${apKey}`, "Content-Type": "application/xml" }, body: ORDER("PO-9") });
    expect(r.status).toBe(404);
  });
});

describe("pending until released", () => {
  it("an order stopped at Checking is not in force, and a change waiting leaves the order in force untouched", async () => {
    const key = await procurementApi();
    await post(key, ORDER("PO-8"), "application/xml");
    // A rule at Checking that always raises a task.
    await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-po', 'Purchasing', 'acme-uk')").run();
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-po', 'PO', 'all_matches', 'active')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES ('r-po', 'rs-po', 0, 1, 'Look at it')").run();
    await env.DB.prepare(
      "INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from) VALUES ('r-po', 1, 'x', ?, 'test', 'u-dan', '2026-10-01', '2026-01-01')"
    )
      .bind(JSON.stringify({ conditions: { field: "lines", operator: "greater_than", value: 0 }, actions: [{ type: "assign_task", params: { team: "team-po", permission: "Admin.Configure" } }] }))
      .run();
    await env.DB.prepare("UPDATE process_stages SET rule_set_id = 'rs-po' WHERE id = 'purchase-orders-checking'").run();

    const body = (await (await post(key, ORDER("PO-8", 4), "application/xml")).json()) as { orders: unknown[]; message: string };
    expect(body.orders).toEqual([{ orderNumber: "PO-8", status: "pending", change: true, stage: "Checking" }]);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM purchase_order_lines").first<{ n: number }>())!.n).toBe(1);
    const fresh = (await (await post(key, ORDER("PO-NEW"), "application/xml")).json()) as { orders: unknown[] };
    expect(fresh.orders).toEqual([{ orderNumber: "PO-NEW", status: "pending", change: false, stage: "Checking" }]);
    expect(await env.DB.prepare("SELECT 1 FROM purchase_orders WHERE order_number = 'PO-NEW'").first()).toBeNull();
    const listed = (await handleListRouteMessages(env.DB, new URLSearchParams("period=today"))).body as { messages: Record<string, unknown>[] };
    expect(listed.messages.find((m) => m.id === body.message)).toMatchObject({ orders: 1, ordersWaiting: 1 });
  });
});

describe("Orders by email", () => {
  const ADDRESS = "orders.acme@vibefinance-ai.com";
  function message(attachments: { name: string; type: string; text: string }[]): EmailMessage & { rejected: string | null } {
    const boundary = "----vf-po";
    const raw =
      `Message-ID: <po-${Math.random()}@erp>\r\nFrom: erp@acme.example\r\nTo: ${ADDRESS}\r\nSubject: Orders export\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAttached.\r\n` +
      attachments.map((a) => `--${boundary}\r\nContent-Type: ${a.type}; name="${a.name}"\r\nContent-Transfer-Encoding: base64\r\nContent-Disposition: attachment; filename="${a.name}"\r\n\r\n${btoa(a.text)}\r\n`).join("") +
      `--${boundary}--`;
    const m = {
      from: "erp@acme.example",
      to: ADDRESS,
      raw: new Response(raw).body as ReadableStream,
      rawSize: raw.length,
      rejected: null as string | null,
      setReject(reason: string) {
        m.rejected = reason;
      },
      async forward() {},
    };
    return m;
  }
  const noModel = { extract: async () => { throw new Error("orders are never read by AI"); } };

  beforeEach(async () => {
    await handleCreateSource(env.DB, "purchase-orders", { id: "po-mail", name: "Orders mailbox", mechanism: "email" });
    await env.DB.prepare("UPDATE sources SET email_address = ? WHERE id = 'po-mail'").bind(ADDRESS).run();
  });

  it("reads each order file attached and sends its orders through, never as invoices", async () => {
    const m = message([{ name: "PO-21.xml", type: "application/xml", text: ORDER("PO-21") }, { name: "orders.csv", type: "text/csv", text: "order_number,buyer_party_id,line_number,item_name\nPO-22,GB907856452,1,Tape" }]);
    await handleInboundEmail(m, env.DB, noModel, undefined, undefined, undefined, { readLater: true });
    expect(m.rejected).toBeNull();
    expect((await env.DB.prepare("SELECT order_number FROM purchase_orders ORDER BY order_number").all<{ order_number: string }>()).results.map((r) => r.order_number)).toEqual(["PO-21", "PO-22"]);
    expect(await env.DB.prepare("SELECT route_id, status, read_queued_at FROM route_messages").first()).toEqual({ route_id: "orders-email", status: "delivered", read_queued_at: null });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>())!.n).toBe(0);
  });

  it("bounces an email whose attachments hold no order", async () => {
    const m = message([{ name: "notes.csv", type: "text/csv", text: "hello\nworld" }]);
    await handleInboundEmail(m, env.DB, noModel);
    expect(m.rejected).toBe("The attached file could not be read as purchase orders.");
    expect(await env.DB.prepare("SELECT status, failed_part FROM route_messages").first()).toEqual({ status: "failed", failed_part: "format" });
  });
});

describe("Orders upload — Purchase Orders' own load", () => {
  it("is one message from the person, named by the file; without the process a load stores at once, as before", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-dan'").bind(await hashApiKey(key)).run();
    const res = await SELF.fetch("https://example.com/purchase-orders/csv-load?name=week-41.csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/csv" },
      body: "order_number,buyer_party_id,line_number,item_name\nPO-31,GB907856452,1,Tape\nPO-32,DE999,1,Tape",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown> & { messageId: string };
    expect(body).toMatchObject({
      ordersLoaded: 1,
      orderNumbers: ["PO-31"],
      refused: [{ orderNumber: "PO-32", reason: "buyer tax reference DE999 does not match any known legal entity" }],
      process: { id: "purchase-orders", waiting: 0 },
    });
    expect(await env.DB.prepare("SELECT instance_id, route_id, counterparty, subject, status FROM route_messages WHERE id = ?").bind(body.messageId).first()).toEqual({
      instance_id: "upload-purchase-orders",
      route_id: "orders-file",
      counterparty: "Dan <d@x.com>",
      subject: "Upload of week-41.csv",
      status: "partial",
    });
    expect(await env.DB.prepare("SELECT created_by FROM purchase_order_intake").first()).toEqual({ created_by: "u-dan" });

    // A file with no order number column is refused as before, the message failed at its format.
    const bad = await SELF.fetch("https://example.com/purchase-orders/csv-load", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/csv" }, body: "x,y\n1,2" });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { reason: string }).reason).toBe("no_order_number_column");

    // Without the process: stored at once, no message.
    await env.DB.prepare("UPDATE sources SET status = 'retired', retired_at = datetime('now') WHERE id = 'upload-purchase-orders'").run();
    const before = (await env.DB.prepare("SELECT count(*) AS n FROM route_messages").first<{ n: number }>())!.n;
    const direct = await SELF.fetch("https://example.com/purchase-orders/csv-load", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "text/csv" }, body: "order_number,buyer_party_id,line_number,item_name\nPO-33,GB907856452,1,Tape" });
    expect(((await direct.json()) as { ordersLoaded: number; process?: unknown }).ordersLoaded).toBe(1);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM route_messages").first<{ n: number }>())!.n).toBe(before);
  });

  it("an order document sent to Purchase Orders goes the same way", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-dan'").bind(await hashApiKey(key)).run();
    const res = await SELF.fetch("https://example.com/purchase-orders", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/xml" }, body: ORDER("PO-41") });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ordersLoaded: 1, orderNumbers: ["PO-41"], process: { id: "purchase-orders" } });
    expect(await env.DB.prepare("SELECT route_id, subject FROM route_messages").first()).toEqual({ route_id: "orders-file", subject: "Upload of order.xml" });
  });
});
