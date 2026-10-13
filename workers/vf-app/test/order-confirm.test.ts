import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedOrder } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { handleSetUpOrdersProcess, releaseOrder } from "../src/purchase-orders-in.js";
import { handleCreateDestination } from "../src/destination-delivery.js";
import { handleGetOrderSending, handleSendOrderToSupplier, handleStartOrdersOut, runOrderSends, type OrdersOutDeps } from "../src/orders-out.js";
import { handleGetOrderTimeline } from "../src/order-timeline.js";
import { hashConfirmToken, orderConfirmation } from "../src/order-confirm.js";

/**
 * **The supplier confirms it has the order — decision 0762**, with the
 * same people and orders as Orders to suppliers' own test (0759).
 *
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
  confirm: { networkUrl: "https://network.example/", environmentId: "test-environment" },
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

const linkOf = (s: Sent) => {
  const m = s.text.match(/https:\/\/network\.example\/confirm#test-environment\.([A-Za-z0-9_-]+)/);
  expect(m, s.text).not.toBeNull();
  return m![1];
};
const click = (token: string, agent = "Mozilla/5.0 (Macintosh) Safari/605") =>
  SELF.fetch("https://app.example.com/portal/order-confirm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, agent }) });
type Items = { items: { kind: string; detail?: Record<string, unknown> }[] };

describe("the email's link", () => {
  it("is in the email, kept here only as a hash, and confirms the order once, with the browser that opened it", async () => {
    await destination();
    await release(ORDER);
    expect(await runOrderSends(env.DB, deps())).toBe(1);
    const token = linkOf(sent[0]);
    expect(sent[0].html).toContain(`href="https://network.example/confirm#test-environment.${token}"`);
    expect(sent[0].html).toContain("Confirm receipt");
    // Only the hash is kept, and the copy of the email kept here leaves the secret out.
    const row = await env.DB.prepare("SELECT confirm_token_hash, message_id FROM purchase_order_sends").first<{ confirm_token_hash: string; message_id: string }>();
    expect(row!.confirm_token_hash).toBe(await hashConfirmToken(token));
    const part = await env.DB.prepare("SELECT r2_key FROM route_message_parts WHERE message_id = ? AND filename = 'email.html'").bind(row!.message_id).first<{ r2_key: string }>();
    const kept = await (await env.DOCUMENTS.get(part!.r2_key))!.text();
    expect(kept).toContain("confirm#test-environment.…");
    expect(kept).not.toContain(token);
    expect((await orderConfirmation(env.DB, "PO-7")).confirmed).toBeNull();
    expect(((await handleGetOrderSending(env.DB, "PO-7")).body as { confirmation: unknown }).confirmation).toEqual({ kind: "order", confirmed: null });

    const res = await click(token);
    expect(res.status).toBe(200);
    const answer = (await res.json()) as Record<string, unknown>;
    const orderId = (await env.DB.prepare("SELECT id FROM purchase_orders WHERE order_number = 'PO-7'").first<{ id: string }>())!.id;
    expect(answer).toMatchObject({ confirmed: true, already: false, current: true, orderNumber: "PO-7", orderId, company: "Acme UK Ltd", kind: "order" });
    expect(((await handleGetOrderSending(env.DB, "PO-7")).body as { confirmation: unknown }).confirmation).toEqual({ kind: "order", confirmed: { at: answer.at, how: "link", by: null, kind: "order" } });
    const items = ((await handleGetOrderTimeline(env.DB, "u-pat", "PO-7")).body as Items).items;
    expect(items.filter((i) => i.kind === "supplier_confirmed").map((i) => i.detail)).toEqual([{ how: "link", kind: "order", by: null, current: true, agent: "Mozilla/5.0 (Macintosh) Safari/605" }]);

    // Again: confirmed already, once.
    expect(await (await click(token)).json()).toMatchObject({ confirmed: true, already: true, at: answer.at });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM purchase_order_confirmations").first<{ n: number }>())!.n).toBe(1);
    // A link not made here, or cut short, confirms nothing.
    expect((await click("A".repeat(43))).status).toBe(404);
    expect((await click(token.slice(0, 10))).status).toBe(404);
    expect((await SELF.fetch("https://app.example.com/portal/order-confirm", { method: "GET" })).status).not.toBe(200);
  });

  it("a change waits to be confirmed again; the earlier email's link confirms only what it sent", async () => {
    await destination();
    await release(ORDER);
    await runOrderSends(env.DB, deps());
    const first = linkOf(sent[0]);
    await release({ ...ORDER, lines: [{ ...ORDER.lines[0], quantity: 12, lineExtensionAmount: 1500 }] }, "change");
    await runOrderSends(env.DB, deps());
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("Please confirm you have received this change:");
    const second = linkOf(sent[1]);
    expect(second).not.toBe(first);

    expect(await (await click(first)).json()).toMatchObject({ confirmed: true, current: false, kind: "order" });
    expect(await orderConfirmation(env.DB, "PO-7")).toEqual({ kind: "change", confirmed: null });
    expect(await (await click(second)).json()).toMatchObject({ confirmed: true, current: true, kind: "change" });
    expect((await orderConfirmation(env.DB, "PO-7")).confirmed).toMatchObject({ how: "link", kind: "change" });
    const items = ((await handleGetOrderTimeline(env.DB, "u-pat", "PO-7")).body as Items).items;
    expect(items.filter((i) => i.kind === "supplier_confirmed").map((i) => [i.detail?.kind, i.detail?.current])).toEqual([
      ["order", false],
      ["change", true],
    ]);
  });

  it("in German to a German supplier; none where the deployment has no supplier network address; sent by hand carries one too", async () => {
    await env.DB.prepare("UPDATE suppliers SET country = 'DE'").run();
    await destination();
    await release(ORDER);
    await runOrderSends(env.DB, { ...deps(), confirm: null });
    expect(sent[0].text).not.toContain("confirm#");
    expect((await env.DB.prepare("SELECT confirm_token_hash FROM purchase_order_sends").first<{ confirm_token_hash: string | null }>())!.confirm_token_hash).toBeNull();
    expect((await handleSendOrderToSupplier(env.DB, deps(), "u-pat", "PO-7", {})).status).toBe(201);
    expect(sent[1].text).toContain("Bitte bestätigen Sie den Empfang dieser Bestellung:");
    expect(sent[1].html).toContain("Empfang bestätigen");
    expect((await click(linkOf(sent[1]))).status).toBe(200);
  });

  it("a send that failed has no link to confirm", async () => {
    await destination();
    await release(ORDER);
    failNext = true;
    await runOrderSends(env.DB, deps());
    expect(sent).toHaveLength(0);
    expect((await env.DB.prepare("SELECT status, confirm_token_hash FROM purchase_order_sends").first())).toEqual({ status: "failed", confirm_token_hash: null });
  });
});
