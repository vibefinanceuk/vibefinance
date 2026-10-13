import type { PortalAccessClaims } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import type { LicenceLink } from "./invitations-route.js";
import { MAX_BODY, portalView, readLines, recipientsFor, send, unitAndAbove, view, type MessageEmail, type MessageRow } from "./supplier-messages.js";
import { openQuery } from "./receipt-messages.js";
import { BARE_SQL } from "./receipt-sharing.js";
import { ordersSharedWith, portalMayReadOrder } from "./order-sharing.js";

/**
 * **The conversation with a supplier about a purchase order — decision
 * 0752**, as an invoice's (0721) and a goods receipt's (0740, 0748).
 *
 * Purchasing writes, or **asks** (the supplier sees the order as *Query
 * raised* until they write back), on the order's pop-out on Purchase
 * Orders; the supplier's people linked for its company are emailed. The
 * supplier writes on the order in the network; the order's buyer, everyone
 * holding AP.Purchasing for its company (in it, above it, or everywhere),
 * and whoever last wrote to them are emailed, and it is in their
 * Conversations on Tasks until they catch up.
 *
 * **Only while the order is shared with the supplier** (0751). Kept in its
 * own table (`purchase_order_messages`), by the order's number.
 */

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  issue_date: string | null;
  buyer_user_id: string | null;
  org_unit_id: string | null;
  company_name: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
}

/** The order, its company, and its supplier (VAT however written, or ERP number; an active one first). */
export async function orderOf(db: D1Database, orderNumber: string): Promise<OrderRow | null> {
  return db
    .prepare(
      `SELECT po.id, po.order_number, po.status, po.issue_date, po.buyer_user_id, po.org_unit_id, ou.name AS company_name,
              s.id AS supplier_id, s.name AS supplier_name
       FROM purchase_orders po
       LEFT JOIN org_units ou ON ou.id = po.org_unit_id
       LEFT JOIN suppliers s ON s.id = (
         SELECT x.id FROM suppliers x
         WHERE po.seller_party_id IS NOT NULL
           AND ((x.vat_id IS NOT NULL AND ${BARE_SQL("x.vat_id")} = ${BARE_SQL("po.seller_party_id")}) OR x.erp_identifier = po.seller_party_id)
         ORDER BY x.status = 'active' DESC, x.name LIMIT 1)
       WHERE po.order_number = ?`
    )
    .bind(orderNumber)
    .first<OrderRow>();
}

/** Whether the supplier sees this order in the network now: shared with them, and issued on or after AP Setup's date. */
async function visibleToSupplier(db: D1Database, order: OrderRow): Promise<boolean> {
  if (!order.supplier_id || !order.org_unit_id) return false;
  const sharing = await ordersSharedWith(db, order.supplier_id);
  if (!sharing.shared) return false;
  return !sharing.from || (order.issue_date ?? "") >= sharing.from;
}

export async function orderMessages(db: D1Database, orderNumber: string): Promise<MessageRow[]> {
  return (await db.prepare("SELECT * FROM purchase_order_messages WHERE order_number = ? ORDER BY created_at, rowid").bind(orderNumber).all<MessageRow>()).results;
}

/** Who at the supplier is told: everyone linked to the supplier for the order's company (or above), while it is shared. */
async function supplierPeople(db: D1Database, link: LicenceLink | null, order: OrderRow): Promise<string[]> {
  if (!(await visibleToSupplier(db, order))) return [];
  return recipientsFor(db, link, {
    id: order.id,
    supplier_id: order.supplier_id,
    org_unit_id: order.org_unit_id,
    invoice_number: order.order_number,
    supplier_name: order.supplier_name,
    company_name: order.company_name,
  });
}

/** Caught up on an order's conversation: Conversations shows it again only when the supplier writes again. */
export async function markOrderSeen(db: D1Database, userId: string, orderNumber: string, now = new Date()): Promise<void> {
  await db
    .prepare(
      `INSERT INTO purchase_order_reads (order_number, user_id, seen_at) VALUES (?, ?, ?)
       ON CONFLICT (order_number, user_id) DO UPDATE SET seen_at = excluded.seen_at`
    )
    .bind(orderNumber, userId, now.toISOString())
    .run();
}

/**
 * `GET /purchase-orders/:number/supplier-messages` — the conversation, who
 * would be told, and the question it waits on. Reading it catches the
 * person up (Conversations, 0660).
 */
export async function handleGetOrderSupplierMessages(db: D1Database, link: LicenceLink | null, orderNumber: string, userId: string | null = null): Promise<RouteResult> {
  const order = await orderOf(db, orderNumber);
  if (!order) return { status: 404, body: { error: `purchase order ${orderNumber} does not exist` } };
  const rows = await orderMessages(db, orderNumber);
  const recipients = await supplierPeople(db, link, order);
  const query = openQuery(rows);
  if (userId) await markOrderSeen(db, userId, orderNumber);
  return {
    status: 200,
    body: {
      available: recipients.length > 0 || rows.length > 0,
      canWrite: recipients.length > 0,
      supplierName: order.supplier_name,
      recipients,
      awaiting: query !== null,
      query: query ? { supplierName: order.supplier_name, askedBy: query.author_name, askedAt: query.created_at } : null,
      messages: rows.map(view),
    },
  };
}

/**
 * `POST /purchase-orders/:number/supplier-messages` `{ body, ask, lines }`
 * — Purchasing writes to the supplier; `ask: true` is *Ask supplier*: the
 * order shows Query raised in the network until they write back.
 */
export async function handlePostOrderSupplierMessage(
  db: D1Database,
  link: LicenceLink | null,
  orderNumber: string,
  user: { id: string; name: string },
  body: Record<string, unknown>,
  email: MessageEmail,
  now = new Date()
): Promise<RouteResult> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write a message", reason: "empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "too_long" } };
  const order = await orderOf(db, orderNumber);
  if (!order) return { status: 404, body: { error: `purchase order ${orderNumber} does not exist` } };
  const recipients = await supplierPeople(db, link, order);
  if (recipients.length === 0) {
    return {
      status: 409,
      body: { error: "this order is not shared with its supplier in the supplier network, or nobody there is linked for its company", reason: "no_recipients" },
    };
  }
  const ask = body.ask === true;
  const lines = readLines(body.lines);
  const customer = order.company_name ?? "Your customer";
  const mail = [
    "Hello,",
    "",
    ask
      ? `${customer} has a question about purchase order ${orderNumber}${lines ? ` (line ${lines.join(", ")})` : ""}:`
      : `${customer} has written about purchase order ${orderNumber}:`,
    "",
    text,
    "",
    `Read and reply in the VibeFinance supplier network: ${email.networkUrl.replace(/\/+$/, "")}/`,
    "",
    "VibeFinance",
  ].join("\n");
  const subject = ask ? `${customer} has a question about purchase order ${orderNumber}` : `${customer} has written about purchase order ${orderNumber}`;
  const emailError = await send(email, recipients, subject, mail);
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO purchase_order_messages (id, order_number, supplier_id, direction, kind, author_user_id, author_name, body, lines_json, emailed_json, email_error, created_at)
       VALUES (?, ?, ?, 'to_supplier', ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, orderNumber, order.supplier_id, ask ? "question" : "message", user.id, user.name, text, lines ? JSON.stringify(lines) : null, JSON.stringify(recipients), emailError, now.toISOString())
    .run();
  await markOrderSeen(db, user.id, orderNumber, now);
  const row = (await db.prepare("SELECT * FROM purchase_order_messages WHERE id = ?").bind(id).first<MessageRow>())!;
  return { status: 201, body: { message: view(row) } };
}

/**
 * **Who at the customer hears of a supplier's message about an order:**
 * the order's buyer, everyone holding AP.Purchasing for its company (in
 * it, above it, or everywhere), and whoever last wrote to the supplier
 * about it. People, by their email; active ones only.
 */
async function purchasingPeopleFor(db: D1Database, order: OrderRow): Promise<string[]> {
  const units = order.org_unit_id ? await unitAndAbove(db, order.org_unit_id) : [];
  const rows = (
    await db
      .prepare(
        `SELECT u.email FROM org_users u WHERE u.id = ? AND u.status = 'active'
         UNION
         SELECT u.email FROM org_users u
           JOIN org_user_roles ur ON ur.user_id = u.id
           JOIN org_roles r ON r.id = ur.role_id
         WHERE u.status = 'active'
           AND EXISTS (SELECT 1 FROM json_each(r.permissions_json) p WHERE p.value = 'AP.Purchasing')
           AND (ur.unit_id IS NULL OR ur.unit_id IN (SELECT value FROM json_each(?)))
         UNION
         SELECT u.email FROM purchase_order_messages m JOIN org_users u ON u.id = m.author_user_id
         WHERE m.id = (SELECT id FROM purchase_order_messages WHERE order_number = ? AND direction = 'to_supplier' ORDER BY created_at DESC, rowid DESC LIMIT 1)
           AND u.status = 'active'`
      )
      .bind(order.buyer_user_id ?? "", JSON.stringify(units), order.order_number)
      .all<{ email: string | null }>()
  ).results;
  return [...new Set(rows.map((r) => r.email).filter((e): e is string => Boolean(e)))].sort();
}

/**
 * `POST /portal/orders/:id/messages` `{ body }` — the supplier's person
 * writes about an order shared with them. The same 404 for one they may
 * not see as for none.
 */
export async function handlePortalOrderReply(
  db: D1Database,
  claims: PortalAccessClaims,
  orderId: string,
  body: Record<string, unknown>,
  email: MessageEmail,
  now = new Date()
): Promise<RouteResult> {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  if (!text) return { status: 400, body: { error: "write a message", reason: "empty" } };
  if (text.length > MAX_BODY) return { status: 400, body: { error: `a message is at most ${MAX_BODY} characters`, reason: "too_long" } };
  const orderNumber = await portalMayReadOrder(db, claims, orderId);
  if (!orderNumber) return { status: 404, body: { error: "not found" } };
  const order = (await orderOf(db, orderNumber))!;
  const people = await purchasingPeopleFor(db, order);
  const supplier = order.supplier_name ?? "Your supplier";
  const mail = [
    "Hello,",
    "",
    `${supplier} (${claims.email}) has written about purchase order ${orderNumber}:`,
    "",
    text,
    "",
    email.appUrl ? `Open it in VibeFinance: ${email.appUrl}/` : "Open it in VibeFinance, on the order in Purchase Orders.",
    "",
    "VibeFinance",
  ].join("\n");
  const emailError = await send(email, people, `${supplier} wrote about purchase order ${orderNumber}`, mail);
  await db
    .prepare(
      `INSERT INTO purchase_order_messages (id, order_number, supplier_id, direction, kind, author_email, author_name, body, emailed_json, email_error, created_at)
       VALUES (?, ?, ?, 'from_supplier', 'message', ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), orderNumber, claims.supplierId, claims.email, claims.email, text, JSON.stringify(people), emailError, now.toISOString())
    .run();
  return { status: 201, body: { messages: portalView(await orderMessages(db, orderNumber)) } };
}

/**
 * **Orders in Conversations — decision 0752**, beside receipts (0660,
 * 0748): those whose supplier wrote to this person (they were emailed)
 * since they last caught up.
 */
export async function orderConversationsFor(db: D1Database, userId: string) {
  const email = ((await db.prepare("SELECT email FROM org_users WHERE id = ?").bind(userId).first<{ email: string | null }>())?.email ?? "").toLowerCase();
  if (!email) return [];
  const rows = (
    await db
      .prepare(
        `SELECT m.order_number, count(*) AS n, max(m.created_at) AS last_at
         FROM purchase_order_messages m
         LEFT JOIN purchase_order_reads r ON r.order_number = m.order_number AND r.user_id = ?1
         WHERE m.direction = 'from_supplier' AND (r.seen_at IS NULL OR m.created_at > r.seen_at)
           AND EXISTS (SELECT 1 FROM json_each(m.emailed_json) e WHERE lower(e.value) = ?2)
         GROUP BY m.order_number`
      )
      .bind(userId, email)
      .all<{ order_number: string; n: number; last_at: string }>()
  ).results;
  const out = [];
  for (const r of rows) {
    const order = await orderOf(db, r.order_number);
    if (!order) continue;
    const latest = await db
      .prepare("SELECT body, created_at FROM purchase_order_messages WHERE order_number = ? AND direction = 'from_supplier' ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .bind(r.order_number)
      .first<{ body: string; created_at: string }>();
    out.push({
      kind: "order" as const,
      orderNumber: r.order_number,
      organisation: order.company_name,
      supplier: order.supplier_name,
      orders: [],
      added: null,
      newMessages: r.n,
      supplierMessages: r.n,
      latest: latest ? { by: order.supplier_name, body: latest.body.length > 280 ? `${latest.body.slice(0, 279)}…` : latest.body, at: latest.created_at } : null,
      lastAt: r.last_at,
    });
  }
  return out;
}
