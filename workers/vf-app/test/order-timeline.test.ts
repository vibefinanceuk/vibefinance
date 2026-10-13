import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { ParsedOrder } from "@vibefinance/shared";
import { applyTestSchema } from "./setup.js";
import { storeOrder, handleSetPurchaseOrderStatus } from "../src/purchase-order-route.js";
import { releaseOrder } from "../src/purchase-orders-in.js";
import {
  handleAddOrderCollaborator,
  handleGetOrderTimeline,
  handleOrderAttachments,
  handlePostOrderComment,
  handleRemoveOrderCollaborator,
  handleSearchOrderPeople,
  orderEmail,
  type TimelineDeps,
} from "../src/order-timeline.js";
import { orderConversationsFor } from "../src/order-messages.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **A purchase order's Timeline and Chat, and its Attachments — decision
 * 0754.** PO-7 belongs to Acme UK. Pat holds AP.Purchasing there, Fran in
 * Ireland; Val reads orders everywhere (AP.Validate); Wes collaborates with
 * the warehouse (Warehouse.Collaborate) and reads no orders of his own;
 * Nia holds nothing that opens an order.
 */

type Item = { kind: string; at: string; by: string | null; detail?: Record<string, unknown>; body?: string; mine?: boolean };
const NO_EMAIL: TimelineDeps = { email: null, appUrl: "https://app.example" };

async function person(id: string, name: string, unit: string | null, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id.slice(2)}@acme.example`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, `r-${id}`, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

const ORDER: ParsedOrder = {
  orderNumber: "PO-7",
  issueDate: "2026-10-01",
  currency: "GBP",
  sellerPartyId: "GB111",
  payableAmount: 1450,
  lines: [
    { lineNumber: 1, itemName: "Office chair", quantity: 10, unitCode: "EA", priceAmount: 125, lineExtensionAmount: 1250 },
    { lineNumber: 2, itemName: "Footrest", quantity: 10, unitCode: "EA", priceAmount: 20, lineExtensionAmount: 200 },
  ],
};
const CHANGED: ParsedOrder = {
  ...ORDER,
  payableAmount: 1610,
  lines: [
    { lineNumber: 1, itemName: "Office chair", quantity: 12, unitCode: "EA", priceAmount: 125, lineExtensionAmount: 1500 },
    { lineNumber: 3, itemName: "Desk lamp", quantity: 2, unitCode: "EA", priceAmount: 55, lineExtensionAmount: 110 },
  ],
};

const timeline = async (who = "u-pat") => {
  const r = await handleGetOrderTimeline(env.DB, who, "PO-7");
  return { status: r.status, ...(r.body as { items: Item[]; collaborators: { id: string; name: string; kind: string }[]; canManage: boolean }) };
};
const kinds = (items: Item[]) => items.map((i) => i.kind);

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await person("u-pat", "Pat Lee", "uk", ["AP.Purchasing"]);
  await person("u-fran", "Fran Ode", "ie", ["AP.Purchasing"]);
  await person("u-val", "Val Viewer", null, ["AP.Validate"]);
  await person("u-wes", "Wes Store", null, ["Warehouse.Collaborate"]);
  await person("u-nia", "Nia None", null, []);
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('t-wh', 'Warehouse', 'uk')").run();
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('t-wh', 'u-wes')").run();
});

describe("the order's history", () => {
  it("each load says what it changed: header facts, and lines changed, added and removed, from what to what", async () => {
    await storeOrder(env.DB, ORDER, "uk", undefined, { actorId: "u-pat", at: "2026-10-01T09:00:00Z" });
    await storeOrder(env.DB, CHANGED, "uk", undefined, { actorId: "u-pat", at: "2026-10-03T09:00:00Z" });
    const { items } = await timeline();
    expect(kinds(items)).toEqual(["order_loaded", "order_changed"]);
    expect(items[0]).toMatchObject({ by: "Pat Lee", detail: { lines: 2, status: "active" } });
    expect(items[1].detail!.changes).toEqual({
      header: [{ field: "payable", from: 1450, to: 1610 }],
      lines: [
        { line: 1, change: "changed", item: "Office chair", fields: [{ field: "quantity", from: 10, to: 12 }, { field: "amount", from: 1250, to: 1500 }] },
        { line: 2, change: "removed", item: "Footrest", fields: [] },
        {
          line: 3,
          change: "added",
          item: "Desk lamp",
          fields: [
            { field: "item", from: null, to: "Desk lamp" },
            { field: "quantity", from: null, to: 2 },
            { field: "unit", from: null, to: "EA" },
            { field: "price", from: null, to: 55 },
            { field: "amount", from: null, to: 110 },
          ],
        },
      ],
      receiptWarnings: [],
    });
  });

  it("Hold, Release hold and Close by hand, by whom and why", async () => {
    await storeOrder(env.DB, ORDER, "uk", undefined, { at: "2026-10-01T09:00:00Z" });
    await handleSetPurchaseOrderStatus(env.DB, "PO-7", { status: "on_hold", holdReason: "price dispute" }, "u-pat", new Date("2026-10-05T09:00:00Z"));
    await handleSetPurchaseOrderStatus(env.DB, "PO-7", { status: "active" }, "u-pat", new Date("2026-10-06T09:00:00Z"));
    await handleSetPurchaseOrderStatus(env.DB, "PO-7", { status: "closed" }, "u-val", new Date("2026-10-07T09:00:00Z"));
    const { items } = await timeline();
    expect(items.slice(1).map((i) => [i.kind, i.by, i.detail])).toEqual([
      ["order_held", "Pat Lee", { from: "active", reason: "price dispute" }],
      ["order_hold_released", "Pat Lee", { from: "on_hold", reason: "price dispute" }],
      ["order_closed", "Val Viewer", { from: "active", reason: null }],
    ]);
  });

  it("an order on its way in: how it came, Checking's task, and what its release changed; a rejected change says why", async () => {
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism) SELECT 's-po', id, 'Orders by email', 'email' FROM processes LIMIT 1").run().catch(() => undefined);
    await env.DB.prepare("INSERT INTO route_messages (id, direction, status, counterparty, subject, received_at) VALUES ('m1', 'in', 'delivered', 'erp@acme.example', 'PO-7', '2026-10-01T08:00:00Z'), ('m2', 'in', 'delivered', 'erp@acme.example', 'PO-7 change', '2026-10-03T08:00:00Z')").run();
    const intake = (id: string, kind: string, order: ParsedOrder, message: string, at: string) =>
      env.DB.prepare("INSERT INTO purchase_order_intake (id, order_number, order_json, org_unit_id, route_message_id, kind, is_change, created_at) VALUES (?, 'PO-7', ?, 'uk', ?, ?, ?, ?)")
        .bind(id, JSON.stringify(order), message, kind, kind === "change" ? 1 : 0, at)
        .run();
    await intake("i1", "order", ORDER, "m1", "2026-10-01T08:00:00Z");
    await releaseOrder(env.DB, "i1", new Date("2026-10-01T08:05:00Z"));
    await intake("i2", "change", CHANGED, "m2", "2026-10-03T08:00:00Z");
    await env.DB.prepare("UPDATE purchase_order_intake SET released_by = 'u-pat', release_override = 1 WHERE id = 'i2'").run();
    await releaseOrder(env.DB, "i2", new Date("2026-10-03T10:00:00Z"));
    await intake("i3", "change", ORDER, "m2", "2026-10-04T08:00:00Z");
    await env.DB.prepare("UPDATE purchase_order_intake SET status = 'rejected', rejected_at = '2026-10-04T09:00:00Z', rejected_by = 'u-pat', reject_reason = 'Sent twice' WHERE id = 'i3'").run();

    const { items } = await timeline();
    expect(kinds(items)).toEqual(["order_arrived", "order_released", "order_arrived", "order_released", "order_arrived", "order_rejected"]);
    expect(items[0]).toMatchObject({ by: "erp@acme.example", detail: { orderKind: "order", sender: "erp@acme.example", messageId: "m1", lines: 2 } });
    expect(items[1]).toMatchObject({ detail: { orderKind: "order", first: true } });
    expect(items[3]).toMatchObject({ by: "Pat Lee", detail: { orderKind: "change", override: true, changes: { header: [{ field: "payable", from: 1450, to: 1610 }] } } });
    expect((items[3].detail!.changes as { lines: unknown[] }).lines).toHaveLength(3);
    expect(items[5]).toMatchObject({ by: "Pat Lee", detail: { orderKind: "change", reason: "Sent twice" } });
  });

  it("a change released before this was kept is still said, from the version released before it", async () => {
    await storeOrder(env.DB, CHANGED, "uk");
    await env.DB.prepare("DELETE FROM purchase_order_events").run();
    await env.DB.prepare(
      "INSERT INTO purchase_order_intake (id, order_number, order_json, org_unit_id, kind, is_change, status, created_at, released_at) VALUES ('o1', 'PO-7', ?1, 'uk', 'order', 0, 'released', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'), ('o2', 'PO-7', ?2, 'uk', 'change', 1, 'released', '2026-10-02T08:00:00Z', '2026-10-02T08:00:00Z')"
    )
      .bind(JSON.stringify(ORDER), JSON.stringify(CHANGED))
      .run();
    const released = (await timeline()).items.filter((i) => i.kind === "order_released");
    expect(released[0].detail).toMatchObject({ first: true });
    expect(released[1].detail!.changes).toMatchObject({ reconstructed: true, header: [{ field: "payable", from: 1450, to: 1610 }] });
  });

  it("goods received and returned against it, and invoices and credit notes that name it", async () => {
    await storeOrder(env.DB, ORDER, "uk", undefined, { at: "2026-10-01T09:00:00Z" });
    await env.DB.prepare("INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_by, created_at, registered_at) VALUES ('gr1', 'GR-1', '2026-10-05', 'screen', 'u-wes', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z')").run();
    await env.DB.prepare(
      "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, unit_code, return_reason_id, created_at) VALUES ('g1', 'gr1', 1, 'PO-7', 1, 'received', 10, 'EA', NULL, '2026-10-05T10:00:00Z'), ('g2', 'gr1', 2, 'PO-7', 2, 'received', 8, 'EA', NULL, '2026-10-05T10:00:00Z'), ('g3', 'gr1', 3, 'PO-7', 1, 'returned', 2, 'EA', 'damaged', '2026-10-05T10:00:00Z')"
    ).run();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, created_at) VALUES ('inv-1', json_object('BT-1', 'INV-1', 'BT-5', 'GBP', 'BT-112', 1450, 'BT-13', 'PO-7'), 'uk', '2026-10-06T10:00:00Z')").run();
    const { items } = await timeline();
    expect(items.filter((i) => i.kind.startsWith("goods_")).map((i) => [i.kind, i.by, i.detail])).toEqual([
      ["goods_received", "Wes Store", { receiptId: "gr1", receiptNumber: "GR-1", quantity: 18, lines: [1, 2], pending: false, cancelled: false }],
      ["goods_returned", "Wes Store", { receiptId: "gr1", receiptNumber: "GR-1", quantity: 2, lines: [1], pending: false, cancelled: false }],
    ]);
    expect(items.find((i) => i.kind === "order_invoiced")).toMatchObject({ detail: { invoiceId: "inv-1", number: "INV-1", currency: "GBP", total: 1450 } });
  });

  it("an order loaded before any of this was kept says when it was loaded", async () => {
    await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, org_unit_id, created_at) VALUES ('old', 'PO-7', 'uk', '2026-09-01 10:00:00')").run();
    const { items } = await timeline();
    expect(items).toEqual([expect.objectContaining({ kind: "order_loaded", detail: { earlier: true } })]);
  });
});

describe("who may open it, and the conversation", () => {
  beforeEach(async () => {
    await storeOrder(env.DB, ORDER, "uk", undefined, { at: "2026-10-01T09:00:00Z" });
  });

  it("Purchasing where the order is, and AP.Validate, read it; Purchasing elsewhere and anyone else get the same 404 as none", async () => {
    expect(await timeline("u-pat")).toMatchObject({ status: 200, canManage: true });
    expect(await timeline("u-val")).toMatchObject({ status: 200, canManage: false });
    expect((await timeline("u-fran")).status).toBe(404);
    expect((await timeline("u-wes")).status).toBe(404);
    expect((await handleGetOrderTimeline(env.DB, "u-pat", "PO-NONE")).status).toBe(404);
  });

  it("Purchasing adds the warehouse: they may open the order then; someone who could open no order is refused, saying why", async () => {
    const found = (await handleSearchOrderPeople(env.DB, "u-pat", "PO-7", "n")).body as { users: { id: string; canSee: boolean }[] };
    expect(found.users.find((u) => u.id === "u-nia")?.canSee).toBe(false);
    expect((await handleAddOrderCollaborator(env.DB, "u-pat", "PO-7", { userId: "u-nia" }, NO_EMAIL)).body).toMatchObject({ reason: "cannot_see", name: "Nia None" });
    expect((await handleAddOrderCollaborator(env.DB, "u-val", "PO-7", { teamId: "t-wh" }, NO_EMAIL)).status).toBe(403);
    expect((await handleAddOrderCollaborator(env.DB, "u-pat", "PO-7", { teamId: "t-wh" }, NO_EMAIL)).status).toBe(201);
    expect(await timeline("u-wes")).toMatchObject({ status: 200, canManage: false });
    const { items, collaborators } = await timeline();
    expect(collaborators).toEqual([expect.objectContaining({ kind: "team", name: "Warehouse" })]);
    expect(items.at(-1)).toMatchObject({ kind: "collaborator_added", by: "Pat Lee", detail: { kind: "team", name: "Warehouse" } });
    // Removed: the row stays, and Wes may no longer open it.
    await handleRemoveOrderCollaborator(env.DB, "u-pat", "PO-7", collaborators[0].id);
    expect((await timeline("u-wes")).status).toBe(404);
    expect((await timeline()).items.at(-1)).toMatchObject({ kind: "collaborator_removed", detail: { name: "Warehouse" } });
  });

  it("a post is emailed to everyone else in it, and is in their Conversations until they read it", async () => {
    const sent: { to: string; subject: string }[] = [];
    const deps: TimelineDeps = { email: { apiKey: "k", from: "vf@example" }, appUrl: "https://app.example", send: (async (_k: string, m: { to: string; subject: string }) => (sent.push(m), { ok: true })) as unknown as TimelineDeps["send"] };
    await handleAddOrderCollaborator(env.DB, "u-pat", "PO-7", { userId: "u-wes" }, deps, new Date("2026-10-08T09:00:00Z"));
    expect(sent).toEqual([expect.objectContaining({ to: "wes@acme.example", subject: "[Acme UK Ltd] Purchase order PO-7: Pat Lee added you to its conversation" })]);
    expect((await orderConversationsFor(env.DB, "u-wes"))[0]).toMatchObject({ kind: "order", orderNumber: "PO-7", added: { by: "Pat Lee" }, newMessages: 0 });

    await timeline("u-wes");
    expect(await orderConversationsFor(env.DB, "u-wes")).toEqual([]);
    const posted = await handlePostOrderComment(env.DB, "u-pat", "PO-7", { body: "Did all 10 chairs arrive?" }, deps, new Date(Date.now() + 1000));
    expect(posted).toMatchObject({ status: 201, body: { notified: { sent: 1 } } });
    expect(sent.at(-1)).toMatchObject({ to: "wes@acme.example", subject: "[Acme UK Ltd] Purchase order PO-7: Pat Lee wrote" });
    expect((await orderConversationsFor(env.DB, "u-wes"))[0]).toMatchObject({ newMessages: 1, latest: { by: "Pat Lee", body: "Did all 10 chairs arrive?" } });
    // Wes answers; Pat hears of it.
    await handlePostOrderComment(env.DB, "u-wes", "PO-7", { body: "Two were damaged." }, deps, new Date(Date.now() + 2000));
    expect(sent.at(-1)).toMatchObject({ to: "pat@acme.example" });
    const { items } = await timeline("u-wes");
    expect(items.filter((i) => i.kind === "comment").map((i) => [i.by, i.mine])).toEqual([["Pat Lee", false], ["Wes Store", true]]);
    expect((await handlePostOrderComment(env.DB, "u-pat", "PO-7", { body: "  " }, deps)).status).toBe(400);
  });

  it("the email says which order, in the reader's language", () => {
    const mail = orderEmail("de", { kind: "posted", actor: "Pat", team: null, number: "PO-7", latest: { by: "Pat", body: "Hallo" }, link: "https://app.example/?order=PO-7", context: { organisation: "Acme UK Ltd", supplier: "Kingsway", issueDate: "2026-10-01" } });
    expect(mail.subject).toBe("[Acme UK Ltd] Bestellung PO-7: Pat hat geschrieben");
    expect(mail.text).toContain("Lieferant: Kingsway");
    expect(mail.text).toContain("Bestellung öffnen: https://app.example/?order=PO-7");
  });
});

describe("Attachments", () => {
  it("every message an order, change or cancellation of its number came in, and the files each kept", async () => {
    await storeOrder(env.DB, ORDER, "uk");
    await env.DB.prepare("INSERT INTO route_messages (id, direction, status, counterparty, subject, received_at) VALUES ('m1', 'in', 'delivered', 'erp@acme.example', 'PO-7', '2026-10-01T08:00:00Z'), ('m2', 'in', 'delivered', 'erp@acme.example', 'PO-7 change', '2026-10-03T08:00:00Z')").run();
    await env.DB.prepare(
      "INSERT INTO route_message_parts (message_id, seq, role, filename, content_type, bytes, sha256, r2_key, stored_at) VALUES ('m1', 0, 'original', 'message.eml', 'message/rfc822', 10, 'x', 'k0', '2026-10-01T08:00:00Z'), ('m1', 1, 'attachment', 'PO-7.csv', 'text/csv', 20, 'y', 'k1', '2026-10-01T08:00:00Z'), ('m2', 0, 'attachment', 'PO-7-change.xml', 'application/xml', 30, 'z', 'k2', '2026-10-03T08:00:00Z')"
    ).run();
    await env.DB.prepare("INSERT INTO purchase_order_intake (id, order_number, order_json, org_unit_id, route_message_id, kind, status) VALUES ('i1', 'PO-7', '{}', 'uk', 'm1', 'order', 'released'), ('i2', 'PO-7', '{}', 'uk', 'm2', 'change', 'released')").run();
    const r = (await handleOrderAttachments(env.DB, "u-pat", "PO-7")).body as { messages: { id: string; sender: string }[]; files: { messageId: string; filename: string }[] };
    expect(r.messages.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(r.files.map((f) => `${f.messageId}/${f.filename}`)).toEqual(["m1/message.eml", "m1/PO-7.csv", "m2/PO-7-change.xml"]);
    expect((await handleOrderAttachments(env.DB, "u-fran", "PO-7")).status).toBe(404);
  });
});

describe("through the router", () => {
  it("reads, posts and adds at the order's own addresses; a collaborator opens the order itself", async () => {
    await storeOrder(env.DB, ORDER, "uk");
    const key = async (id: string) => {
      const k = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(k), id).run();
      return k;
    };
    const [pat, fran, wes] = [await key("u-pat"), await key("u-fran"), await key("u-wes")];
    const call = (k: string, path: string, method = "GET", body?: unknown) =>
      SELF.fetch(`https://app.example.com${path}`, { method, headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call(pat, "/purchase-orders/PO-7/timeline")).status).toBe(200);
    expect((await call(fran, "/purchase-orders/PO-7/timeline")).status).toBe(404);
    expect((await call(wes, "/purchase-orders/PO-7")).status).toBe(404);
    expect((await call(pat, "/purchase-orders/PO-7/collaborators", "POST", { userId: "u-wes" })).status).toBe(201);
    expect((await call(wes, "/purchase-orders/PO-7")).status).toBe(200);
    expect((await call(wes, "/purchase-orders/PO-7/comments", "POST", { body: "On it." })).status).toBe(201);
    expect((await call(wes, "/purchase-orders/PO-7/people?q=pat")).status).toBe(403);
    expect((await call(pat, "/purchase-orders/PO-7/attachments")).status).toBe(200);
    const convs = (await (await call(pat, "/receipt-conversations")).json()) as { conversations: { kind?: string; orderNumber?: string; newMessages?: number }[] };
    expect(convs.conversations).toEqual([expect.objectContaining({ kind: "order", orderNumber: "PO-7", newMessages: 1 })]);
  });
});
