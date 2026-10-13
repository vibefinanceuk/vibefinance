import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { parseUblOrder, type ParsedOrder } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { handleSetUpOrdersProcess, releaseOrder } from "../src/purchase-orders-in.js";
import { handleCreateDestination } from "../src/destination-delivery.js";
import {
  handleGetOrderSending,
  handleGetOrdersOut,
  handlePutOrdersOut,
  handleSendOrderToSupplier,
  handleStartOrdersOut,
  orderRecipients,
  runOrderSends,
  type OrdersOutDeps,
} from "../src/orders-out.js";
import { handleGetOrderTimeline, handleOrderAttachments } from "../src/order-timeline.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Orders to suppliers — decision 0759.** Acme UK (GB907856452) orders
 * from Kingsway (GB111, orders@kingsway.example as its orders address,
 * hello@kingsway.example as its general one). Bea is the buyer; Pat works
 * orders (AP.Purchasing); Val reads them (AP.Validate).
 */

type Sent = { to: string[]; cc?: string[]; replyTo?: string | null; subject: string; text: string; html: string; attachments?: { filename: string; content: string }[] };
let sent: Sent[] = [];
let failNext = false;
const deps = (): OrdersOutDeps => ({
  email: { apiKey: "k", from: "orders@vibefinance.example" },
  bucket: env.DOCUMENTS,
  customerId: "test",
  send: (async (_key: string, input: Sent) => {
    if (failNext) {
      failNext = false;
      return { ok: false, error: "422 the address was refused" };
    }
    sent.push({ ...input, to: Array.isArray(input.to) ? input.to : [input.to as unknown as string] });
    return { ok: true, messageId: `re-${sent.length}` };
  }) as unknown as OrdersOutDeps["send"],
});

const ORDER: ParsedOrder = {
  orderNumber: "PO-7",
  issueDate: "2026-10-12",
  currency: "GBP",
  sellerPartyId: "GB111",
  buyerPartyId: "GB907856452",
  payableAmount: 1450,
  lines: [
    { lineNumber: 1, itemName: "Office chair", quantity: 10, unitCode: "EA", priceAmount: 125, lineExtensionAmount: 1250, sellersItemId: "KI-CH" },
    { lineNumber: 2, itemName: "Footrest", quantity: 10, unitCode: "EA", priceAmount: 20, lineExtensionAmount: 200 },
  ],
};

async function person(id: string, name: string, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id.slice(2)}@acme.example`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, `r-${id}`, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

let n = 0;
/** An order, change or cancellation arriving and released, as Checking would. */
async function release(order: ParsedOrder, kind: "order" | "change" | "cancellation" = "order", note: string | null = null) {
  const id = `i-${++n}`;
  await env.DB.prepare("INSERT INTO purchase_order_intake (id, order_number, order_json, org_unit_id, kind, is_change, note, created_at) VALUES (?, ?, ?, 'acme-uk', ?, ?, ?, ?)")
    .bind(id, order.orderNumber, JSON.stringify(order), kind, kind === "change" ? 1 : 0, note, new Date().toISOString())
    .run();
  await releaseOrder(env.DB, id, new Date(Date.now() + n * 1000));
  await env.DB.prepare("UPDATE purchase_orders SET buyer_user_id = 'u-bea' WHERE order_number = ?").bind(order.orderNumber).run();
  return id;
}

async function destination(start = true) {
  const made = await handleCreateDestination(env.DB, "u-ada", "purchase-orders", { name: "Orders to suppliers", connectorId: "orders-email-out" });
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  if (start) expect((await handleStartOrdersOut(env.DB, id, new Date(Date.now() - 60_000))).status).toBe(200);
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  sent = [];
  failNext = false;
  n = 0;
  await person("u-ada", "Ada Admin", ["Admin.Configure"]);
  await person("u-bea", "Bea Buyer", ["AP.Validate"]);
  await person("u-pat", "Pat Lee", ["AP.Purchasing"]);
  await person("u-val", "Val Viewer", ["AP.Validate"]);
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id, address_line, city, postal_code, country) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity', 'GB907856452', '1 Handover Street', 'London', 'EC1A 1AA', 'GB')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, email, orders_email, country, status, loaded_at) VALUES ('kw', 'K1', 'Kingsway Interiors', 'GB 111', 'hello@kingsway.example', 'orders@kingsway.example, sales@kingsway.example', 'GB', 'active', datetime('now'))"
  ).run();
  expect((await handleSetUpOrdersProcess(env.DB, {})).status).toBe(201);
});

describe("who an order goes to", () => {
  it("the order's own address first, then the supplier's orders address, then its general email, then none", async () => {
    await release({ ...ORDER, sellerContactEmail: "jo@kingsway.example" });
    expect(await orderRecipients(env.DB, "PO-7")).toMatchObject({ to: ["jo@kingsway.example"], from: "order" });
    await env.DB.prepare("UPDATE purchase_orders SET supplier_email = NULL").run();
    expect(await orderRecipients(env.DB, "PO-7")).toMatchObject({ to: ["orders@kingsway.example", "sales@kingsway.example"], from: "orders_email" });
    await env.DB.prepare("UPDATE suppliers SET orders_email = 'not an address'").run();
    expect(await orderRecipients(env.DB, "PO-7")).toMatchObject({ to: ["hello@kingsway.example"], from: "supplier_email" });
    await env.DB.prepare("UPDATE suppliers SET email = NULL").run();
    expect(await orderRecipients(env.DB, "PO-7")).toMatchObject({ to: [], from: null });
  });

  it("the order's address comes in on the UBL order's seller contact", async () => {
    const xml = `<?xml version="1.0"?><Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>PO-9</cbc:ID><cac:SellerSupplierParty><cac:Party><cac:PartyIdentification><cbc:ID>GB111</cbc:ID></cac:PartyIdentification><cac:Contact><cbc:ElectronicMail> jo@kingsway.example </cbc:ElectronicMail></cac:Contact></cac:Party></cac:SellerSupplierParty><cac:OrderLine><cac:LineItem><cbc:ID>1</cbc:ID><cbc:Quantity>1</cbc:Quantity><cac:Item><cbc:Name>X</cbc:Name></cac:Item></cac:LineItem></cac:OrderLine></Order>`;
    expect(parseUblOrder(xml).sellerContactEmail).toBe("jo@kingsway.example");
  });
});

describe("the Destination", () => {
  it("only on a purchase order process, which takes no other; paused until started", async () => {
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
    expect((await handleCreateDestination(env.DB, "u-ada", "ap", { name: "Orders", connectorId: "orders-email-out" })).body).toMatchObject({ reason: "process_not_orders" });
    expect((await handleCreateDestination(env.DB, "u-ada", "purchase-orders", { name: "Web", connectorId: "https-out" })).body).toMatchObject({ reason: "process_orders_only" });
    const id = await destination(false);
    expect((await handleGetOrdersOut(env.DB, id)).body).toMatchObject({ started: false, status: "paused", settings: { sendOnRelease: true, ccBuyer: true, attachUbl: true, attachPdf: true, replyTo: null } });
    await release(ORDER);
    expect(await runOrderSends(env.DB, deps())).toBe(0);
    expect((await handleCreateDestination(env.DB, "u-ada", "purchase-orders", { name: "Again", connectorId: "orders-email-out" })).body).toMatchObject({ reason: "one_per_process" });
    // Its settings: a reply-to must be an address.
    expect((await handlePutOrdersOut(env.DB, id, { replyTo: "purchasing at acme" })).status).toBe(400);
    expect((await handlePutOrdersOut(env.DB, id, { replyTo: "Purchasing@Acme.example", ccBuyer: false })).body).toMatchObject({ settings: { replyTo: "purchasing@acme.example", ccBuyer: false, sendOnRelease: true } });
  });
});

describe("sending on release", () => {
  it("emails what is released after it started, once, with the UBL order, the buyer copied and replies to them", async () => {
    const id = await destination();
    await release(ORDER);
    expect(await runOrderSends(env.DB, deps())).toBe(1);
    expect(await runOrderSends(env.DB, deps())).toBe(0);
    expect(sent).toHaveLength(1);
    const mail = sent[0];
    expect(mail).toMatchObject({ to: ["orders@kingsway.example", "sales@kingsway.example"], cc: ["bea@acme.example"], replyTo: "bea@acme.example", subject: "Purchase order PO-7 from Acme UK Ltd" });
    expect(mail.text).toContain("Acme UK Ltd has placed purchase order PO-7 with you.");
    expect(mail.text).toContain("1 | Office chair | KI-CH | 10 | EA | £125.00 | £1,250.00");
    expect(mail.text).toContain("Reply to this email to reach Bea Buyer.");
    // Decision 0760: the PDF first, for people, then the UBL, for systems.
    expect(mail.attachments?.map((a) => a.filename)).toEqual(["PO-7.pdf", "PO-7.xml"]);
    expect(atob(mail.attachments![0].content).slice(0, 5)).toBe("%PDF-");
    expect(mail.text).toContain("The order is attached as a PDF.");
    const ubl = new TextDecoder().decode(Uint8Array.from(atob(mail.attachments![1].content), (c) => c.charCodeAt(0)));
    expect(parseUblOrder(ubl)).toMatchObject({ orderNumber: "PO-7", currency: "GBP", buyerPartyId: "GB907856452", lines: [{ lineNumber: 1, quantity: 10 }, { lineNumber: 2 }] });
    expect(ubl).toContain("<cbc:RegistrationName>Acme UK Ltd</cbc:RegistrationName>");
    // On the order: its Timeline, its Attachments, and what was sent.
    const items = ((await handleGetOrderTimeline(env.DB, "u-pat", "PO-7")).body as { items: { kind: string; detail?: Record<string, unknown> }[] }).items;
    expect(items.find((i) => i.kind === "sent_to_supplier")?.detail).toMatchObject({ kind: "order", how: "on_release", to: ["orders@kingsway.example", "sales@kingsway.example"], from: "orders_email", ubl: true });
    const files = ((await handleOrderAttachments(env.DB, "u-pat", "PO-7")).body as { files: { filename: string; role: string }[] }).files;
    expect(files.map((f) => [f.filename, f.role])).toEqual([["email.html", "sent"], ["PO-7.pdf", "sent"], ["PO-7.xml", "sent"]]);
    expect((await handleGetOrderSending(env.DB, "PO-7")).body).toMatchObject({ available: true, sends: [{ status: "sent", how: "on_release", kind: "order" }] });
    expect((await handleGetOrdersOut(env.DB, id)).body).toMatchObject({ sends: [{ orderNumber: "PO-7", status: "sent" }] });
    // The Route monitor has it, delivered.
    expect(await env.DB.prepare("SELECT direction, status, destination_id, recipient FROM route_messages WHERE destination_id = ?").bind(id).first()).toEqual({ direction: "out", status: "delivered", destination_id: id, recipient: "orders@kingsway.example, sales@kingsway.example" });
  });

  it("a change and a cancellation say what they are; a German supplier is written to in German", async () => {
    await destination();
    await env.DB.prepare("UPDATE suppliers SET country = 'DE'").run();
    await release(ORDER);
    await release({ ...ORDER, payableAmount: 1500 }, "change");
    await runOrderSends(env.DB, deps());
    await release(ORDER, "cancellation", "Project stopped");
    await runOrderSends(env.DB, deps());
    expect(sent.map((m) => m.subject)).toEqual([
      "Bestellung PO-7 von Acme UK Ltd",
      "Änderung der Bestellung PO-7 von Acme UK Ltd",
      "Stornierung der Bestellung PO-7 von Acme UK Ltd",
    ]);
    const ubl = new TextDecoder().decode(Uint8Array.from(atob(sent[2].attachments![1].content), (c) => c.charCodeAt(0)));
    expect(ubl).toContain("<cbc:Note>Project stopped</cbc:Note>");
    // Decision 0760: each version's PDF is named for what it is.
    expect(sent.map((m) => m.attachments![0].filename)).toEqual(["PO-7.pdf", "PO-7-change.pdf", "PO-7-cancellation.pdf"]);
  });

  it("nothing for a supplier whose orders the customer's own system sends; by hand still sends", async () => {
    await destination();
    await env.DB.prepare("UPDATE suppliers SET send_orders = 0").run();
    await release(ORDER);
    await runOrderSends(env.DB, deps());
    expect(sent).toEqual([]);
    expect((await handleGetOrderSending(env.DB, "PO-7")).body).toMatchObject({ supplierSendsOwn: true, sends: [{ status: "not_sent", how: "on_release" }] });
    expect((await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", {})).status).toBe(201);
    expect(sent).toHaveLength(1);
  });

  it("with no address it waits, saying so; given one by hand, it goes there", async () => {
    await destination();
    await env.DB.prepare("UPDATE suppliers SET orders_email = NULL, email = NULL").run();
    await release(ORDER);
    await runOrderSends(env.DB, deps());
    const items = ((await handleGetOrderTimeline(env.DB, "u-pat", "PO-7")).body as { items: { kind: string; detail?: Record<string, unknown> }[] }).items;
    expect(items.find((i) => i.kind === "not_sent")?.detail).toMatchObject({ reason: "no_address" });
    expect((await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", {})).body).toMatchObject({ status: "no_address", reason: "no_address" });
    expect((await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", { to: "nope" })).status).toBe(400);
    const given = await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", { to: "Jo@Kingsway.example" });
    expect(given).toMatchObject({ status: 201, body: { status: "sent", to: ["jo@kingsway.example"], from: "given" } });
  });

  it("a refused send is recorded as failed, with why, and can be sent again", async () => {
    await destination();
    await release(ORDER);
    failNext = true;
    await runOrderSends(env.DB, deps());
    expect((await handleGetOrderSending(env.DB, "PO-7")).body).toMatchObject({ sends: [{ status: "failed", error: "422 the address was refused" }] });
    expect((await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", {})).body).toMatchObject({ status: "sent" });
  });

  it("by hand is refused while the process has no Orders to suppliers", async () => {
    await release(ORDER);
    expect((await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", {})).body).toMatchObject({ reason: "no_destination" });
  });
});

describe("through the router", () => {
  it("whoever reads orders sees who it would go to; whoever works them sends it", async () => {
    await destination();
    await release(ORDER);
    const key = async (id: string) => {
      const k = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(k), id).run();
      return k;
    };
    const [pat, val, ada] = [await key("u-pat"), await key("u-val"), await key("u-ada")];
    const call = (k: string, path: string, method = "GET", body?: unknown) =>
      SELF.fetch(`https://app.example.com${path}`, { method, headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const seen = (await (await call(val, "/purchase-orders/PO-7/send-to-supplier")).json()) as { to: string[]; available: boolean };
    expect(seen).toMatchObject({ available: true, to: ["orders@kingsway.example", "sales@kingsway.example"] });
    expect((await call(val, "/purchase-orders/PO-7/send-to-supplier", "POST", {})).status).toBe(403);
    // Not configured for email here: refused, and recorded as failed.
    const res = await call(pat, "/purchase-orders/PO-7/send-to-supplier", "POST", {});
    expect([201, 502]).toContain(res.status);
    const id = ((await env.DB.prepare("SELECT id FROM route_instances WHERE route_id = 'orders-email-out'").first()) as { id: string }).id;
    expect((await call(ada, `/route-instances/${id}/orders-out`)).status).toBe(200);
    expect((await call(pat, `/route-instances/${id}/orders-out`)).status).toBe(403);
  });
});
