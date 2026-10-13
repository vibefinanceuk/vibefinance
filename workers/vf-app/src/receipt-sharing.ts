import type { PortalAccessClaims } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { portalView, type MessageRow } from "./supplier-messages.js";
// Decision 0757: who an order's supplier is, by the one rule every lookup shares (0756).
import { SUPPLIER_IS_SELLER } from "./order-supplier.js";

/**
 * **Goods receipts, shared with suppliers in the network — decision 0738.**
 *
 * AP Setup › Supplier Network says whether suppliers see the receipts
 * recorded against their purchase orders (off until someone turns it on),
 * and whether only registered ones. A supplier's own page can say
 * otherwise for that supplier — share, or not — and **the supplier's
 * setting wins**; left at "As AP Setup" it follows AP Setup.
 *
 * What a supplier sees of a receipt is what arrived and what went back:
 * its number, date and delivery note, and per line the order line, item,
 * quantity ordered, received, rejected and returned, and the return
 * reason as the customer's list names it. **Never** a receipt's notes,
 * who recorded it, why a line was rejected in checking, or its
 * conversation: those are the customer's own.
 */

export interface ReceiptSharingConfig {
  shareReceipts: boolean;
  registeredOnly: boolean;
  /** Decision 0751: purchase orders shared too, and only those issued on or after `ordersFrom`. */
  shareOrders: boolean;
  ordersFrom: string | null;
}

const DEFAULTS: ReceiptSharingConfig = { shareReceipts: false, registeredOnly: true, shareOrders: false, ordersFrom: null };

export async function loadReceiptSharingConfig(db: D1Database): Promise<ReceiptSharingConfig> {
  const row = await db
    .prepare("SELECT share_receipts, registered_only, share_orders, orders_from FROM network_sharing_config WHERE id = 'default'")
    .first<{ share_receipts: number; registered_only: number; share_orders: number; orders_from: string | null }>();
  if (!row) return DEFAULTS;
  return { shareReceipts: row.share_receipts === 1, registeredOnly: row.registered_only !== 0, shareOrders: row.share_orders === 1, ordersFrom: row.orders_from };
}

/** `GET /network-sharing-config` — AP Setup › Supplier Network, and how many suppliers say otherwise (for receipts, and for orders, 0751). */
export async function handleGetNetworkSharingConfig(db: D1Database): Promise<RouteResult> {
  const own = await db.prepare("SELECT count(*) AS n FROM supplier_receipt_sharing").first<{ n: number }>();
  const ownOrders = await db.prepare("SELECT count(*) AS n FROM supplier_order_sharing").first<{ n: number }>();
  return { status: 200, body: { config: await loadReceiptSharingConfig(db), suppliersWithOwn: own?.n ?? 0, suppliersWithOwnOrders: ownOrders?.n ?? 0 } };
}

/** `PUT /network-sharing-config` — Admin.Configure, as the rest of AP Setup. */
export async function handlePutNetworkSharingConfig(db: D1Database, userId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const now = await loadReceiptSharingConfig(db);
  // Decision 0751: a date, or nothing for every order.
  if (body.ordersFrom !== undefined && body.ordersFrom !== null && body.ordersFrom !== "" && !(typeof body.ordersFrom === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.ordersFrom))) {
    return { status: 400, body: { error: "ordersFrom is a date, YYYY-MM-DD, or empty for every order", reason: "orders_from_invalid" } };
  }
  const next: ReceiptSharingConfig = {
    shareReceipts: typeof body.shareReceipts === "boolean" ? body.shareReceipts : now.shareReceipts,
    registeredOnly: typeof body.registeredOnly === "boolean" ? body.registeredOnly : now.registeredOnly,
    shareOrders: typeof body.shareOrders === "boolean" ? body.shareOrders : now.shareOrders,
    ordersFrom: body.ordersFrom === undefined ? now.ordersFrom : body.ordersFrom ? String(body.ordersFrom) : null,
  };
  await db
    .prepare(
      `INSERT INTO network_sharing_config (id, share_receipts, registered_only, share_orders, orders_from, updated_by, updated_at)
       VALUES ('default', ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET share_receipts = excluded.share_receipts, registered_only = excluded.registered_only,
         share_orders = excluded.share_orders, orders_from = excluded.orders_from,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`
    )
    .bind(next.shareReceipts ? 1 : 0, next.registeredOnly ? 1 : 0, next.shareOrders ? 1 : 0, next.ordersFrom, userId, new Date().toISOString())
    .run();
  return handleGetNetworkSharingConfig(db);
}

export type SupplierSetting = "default" | "share" | "none";

async function supplierSetting(db: D1Database, supplierId: string): Promise<SupplierSetting> {
  const row = await db.prepare("SELECT setting FROM supplier_receipt_sharing WHERE supplier_id = ?").bind(supplierId).first<{ setting: string }>();
  return row?.setting === "share" || row?.setting === "none" ? row.setting : "default";
}

/** Whether this supplier sees its receipts: its own setting, or else AP Setup's. */
export async function receiptsSharedWith(db: D1Database, supplierId: string): Promise<{ shared: boolean; registeredOnly: boolean }> {
  const [config, own] = await Promise.all([loadReceiptSharingConfig(db), supplierSetting(db, supplierId)]);
  return { shared: own === "default" ? config.shareReceipts : own === "share", registeredOnly: config.registeredOnly };
}

/** `GET /suppliers/:id/receipt-sharing` — the supplier's setting, and what AP Setup says. */
export async function handleGetSupplierReceiptSharing(db: D1Database, supplierId: string): Promise<RouteResult> {
  const supplier = await db.prepare("SELECT 1 FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!supplier) return { status: 404, body: { error: "no such supplier" } };
  const [config, setting] = await Promise.all([loadReceiptSharingConfig(db), supplierSetting(db, supplierId)]);
  return { status: 200, body: { setting, apSetup: config.shareReceipts } };
}

/** `PUT /suppliers/:id/receipt-sharing` `{ setting: "default" | "share" | "none" }` — Supplier.Maintain. */
export async function handlePutSupplierReceiptSharing(db: D1Database, userId: string, supplierId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const setting = body.setting;
  if (setting !== "default" && setting !== "share" && setting !== "none") {
    return { status: 400, body: { error: "setting is default, share or none" } };
  }
  const supplier = await db.prepare("SELECT 1 FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!supplier) return { status: 404, body: { error: "no such supplier" } };
  if (setting === "default") {
    await db.prepare("DELETE FROM supplier_receipt_sharing WHERE supplier_id = ?").bind(supplierId).run();
  } else {
    await db
      .prepare(
        `INSERT INTO supplier_receipt_sharing (supplier_id, setting, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (supplier_id) DO UPDATE SET setting = excluded.setting, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      )
      .bind(supplierId, setting, userId, new Date().toISOString())
      .run();
  }
  return handleGetSupplierReceiptSharing(db, supplierId);
}

// ---------------------------------------------------------------------------
// In the network
// ---------------------------------------------------------------------------

/** What a supplier is told of a receipt: received, with goods sent back, or still being checked. */
export const PORTAL_RECEIPT_STATUSES = ["goods_received", "goods_returned", "goods_checking"] as const;

/**
 * **Which receipts are this supplier's, for these companies.** A receipt
 * naming an order the supplier is the seller on (by its VAT number, however
 * written, or its ERP number), placed in a company the invitation covers
 * or beneath one. Cancelled and rejected receipts never; one still being
 * checked only where AP Setup allows. Null when nothing is shared.
 */
async function receiptScope(db: D1Database, claims: PortalAccessClaims): Promise<{ sql: string; binds: unknown[] } | null> {
  const sharing = await receiptsSharedWith(db, claims.supplierId);
  if (!sharing.shared || claims.orgUnitIds.length === 0) return null;
  const supplier = await db.prepare("SELECT vat_id, erp_identifier FROM suppliers WHERE id = ?").bind(claims.supplierId).first<{ vat_id: string | null; erp_identifier: string | null }>();
  if (!supplier || (!supplier.vat_id && !supplier.erp_identifier)) return null;
  /**
   * **Decision 0757: the one rule every lookup of an order's supplier
   * shares (0756)** — the VAT number however written, its country prefix
   * dropped only where one side leaves it off (GB1 is never DE1), or the
   * ERP number exactly.
   */
  const sellers = [`EXISTS (SELECT 1 FROM suppliers me WHERE me.id = ? AND ${SUPPLIER_IS_SELLER("me", "spo.seller_party_id")})`];
  const binds: unknown[] = [claims.supplierId];
  return {
    sql: `r.cancelled_at IS NULL AND r.status ${sharing.registeredOnly ? "= 'registered'" : "IN ('registered', 'pending')"}
      AND EXISTS (
        SELECT 1 FROM goods_receipt_lines sl JOIN purchase_orders spo ON spo.order_number = sl.order_number
        WHERE sl.receipt_id = r.id AND (${sellers.join(" OR ")})
          AND spo.org_unit_id IN (
            WITH RECURSIVE covered(id) AS (
              SELECT id FROM org_units WHERE id IN (${claims.orgUnitIds.map(() => "?").join(", ")})
              UNION SELECT u.id FROM org_units u JOIN covered c ON u.parent_unit_id = c.id
            ) SELECT id FROM covered))`,
    binds: [...binds, ...claims.orgUnitIds],
  };
}

interface PortalReceiptRow {
  id: string;
  receipt_number: string;
  receipt_date: string;
  delivery_note: string | null;
  status: string;
  created_at: string;
  orders: string | null;
  org_unit_id: string | null;
  org_unit_name: string | null;
  has_returns: number;
  msg_total: number;
  msg_unread: number;
  query_open: number;
}

/**
 * What a row says. The first placeholder is the person's link, for which of
 * the customer's messages they have not read yet (decision 0740, as 0728
 * for invoices).
 */
const RECEIPT_SELECT = `
  SELECT r.id, r.receipt_number, r.receipt_date, r.delivery_note, r.status, r.created_at,
         (SELECT count(*) FROM supplier_messages m WHERE m.receipt_id = r.id) AS msg_total,
         (SELECT count(*) FROM supplier_messages m WHERE m.receipt_id = r.id AND m.direction = 'to_supplier'
            AND m.created_at > COALESCE((SELECT pr.read_at FROM portal_receipt_reads pr WHERE pr.link_id = ? AND pr.receipt_id = r.id), '')) AS msg_unread,
         -- Decision 0748: a question from the customer the supplier has not written back since.
         EXISTS (SELECT 1 FROM supplier_messages q WHERE q.receipt_id = r.id AND q.direction = 'to_supplier' AND q.kind = 'question'
                 AND NOT EXISTS (SELECT 1 FROM supplier_messages a WHERE a.receipt_id = r.id AND a.direction = 'from_supplier' AND a.created_at >= q.created_at)) AS query_open,
         (SELECT group_concat(DISTINCT o.order_number) FROM goods_receipt_lines o WHERE o.receipt_id = r.id) AS orders,
         po.org_unit_id, ou.name AS org_unit_name,
         EXISTS (SELECT 1 FROM goods_receipt_lines m WHERE m.receipt_id = r.id AND m.movement = 'returned') AS has_returns
  FROM goods_receipts r
  LEFT JOIN purchase_orders po ON po.order_number = (SELECT min(fl.order_number) FROM goods_receipt_lines fl WHERE fl.receipt_id = r.id)
  LEFT JOIN org_units ou ON ou.id = po.org_unit_id`;

function receiptSummary(r: PortalReceiptRow) {
  // Decision 0748: Query raised while the customer's question waits on them, as an invoice's (0721).
  const status = r.query_open ? "query_raised" : r.status === "pending" ? "goods_checking" : r.has_returns ? "goods_returned" : "goods_received";
  return {
    id: r.id,
    documentType: "goods_receipt",
    invoiceNumber: r.receipt_number,
    issueDate: r.receipt_date,
    total: null,
    currency: null,
    purchaseOrder: r.orders ? r.orders.split(",").join(", ") : null,
    company: r.org_unit_name ?? r.org_unit_id,
    orgUnitId: r.org_unit_id,
    // Sorted among the invoices by the day the goods arrived, at the time it was recorded.
    receivedAt: `${r.receipt_date}T${(r.created_at.match(/\d{2}:\d{2}:\d{2}/) ?? ["00:00:00"])[0]}`,
    status,
    comment: null,
    messages: { total: r.msg_total ?? 0, unread: r.msg_unread ?? 0 },
    creditedInvoice: null,
    dueDate: null,
    buyerReference: null,
    deliveryNote: r.delivery_note,
  };
}

/** This supplier's shared receipts, newest first, at most `limit` (+1 to say there were more). Empty when nothing is shared. */
export async function listPortalReceipts(db: D1Database, claims: PortalAccessClaims, q: string, limit: number): Promise<{ receipts: ReturnType<typeof receiptSummary>[]; more: boolean; shared: boolean }> {
  const scope = await receiptScope(db, claims);
  if (!scope) return { receipts: [], more: false, shared: false };
  const search = q
    ? ` AND (r.receipt_number LIKE ? OR r.delivery_note LIKE ? OR EXISTS (SELECT 1 FROM goods_receipt_lines ql WHERE ql.receipt_id = r.id AND ql.order_number LIKE ?))`
    : "";
  const rows = (
    await db
      .prepare(`${RECEIPT_SELECT} WHERE ${scope.sql}${search} ORDER BY r.receipt_date DESC, r.created_at DESC, r.id DESC LIMIT ${limit + 1}`)
      .bind(claims.linkId, ...scope.binds, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []))
      .all<PortalReceiptRow>()
  ).results;
  return { receipts: rows.slice(0, limit).map(receiptSummary), more: rows.length > limit, shared: true };
}

/** Decision 0740: whether this receipt is one the token's person may see (shared, theirs, their companies). */
export async function portalMayReadReceipt(db: D1Database, claims: PortalAccessClaims, receiptId: string): Promise<boolean> {
  const scope = await receiptScope(db, claims);
  if (!scope) return false;
  return Boolean(await db.prepare(`SELECT 1 FROM goods_receipts r WHERE r.id = ? AND ${scope.sql}`).bind(receiptId, ...scope.binds).first());
}

/**
 * `GET /portal/receipts/:id` — one shared receipt, line by line. The same
 * answer for one that does not exist, is not this supplier's, or is not
 * shared with them.
 */
export async function getPortalReceipt(db: D1Database, claims: PortalAccessClaims, receiptId: string): Promise<RouteResult> {
  const scope = await receiptScope(db, claims);
  if (!scope) return { status: 404, body: { error: "not found" } };
  const row = await db.prepare(`${RECEIPT_SELECT} WHERE r.id = ? AND ${scope.sql}`).bind(claims.linkId, receiptId, ...scope.binds).first<PortalReceiptRow>();
  if (!row) return { status: 404, body: { error: "not found" } };
  // Decision 0740: opened, so its messages are read, for this person.
  await db
    .prepare("INSERT INTO portal_receipt_reads (link_id, receipt_id, read_at) VALUES (?, ?, ?) ON CONFLICT (link_id, receipt_id) DO UPDATE SET read_at = excluded.read_at")
    .bind(claims.linkId, receiptId, new Date().toISOString())
    .run();
  const lines = (
    await db
      .prepare(
        `SELECT l.line_number, l.order_number, l.order_line_number, l.movement, l.quantity, l.unit_code, l.line_status,
                rr.label AS return_reason, pl.item_name, pl.item_description, pl.quantity AS ordered, pl.unit_code AS ordered_unit
         FROM goods_receipt_lines l
         LEFT JOIN goods_return_reasons rr ON rr.id = l.return_reason_id
         LEFT JOIN purchase_orders po ON po.order_number = l.order_number
         LEFT JOIN purchase_order_lines pl ON pl.purchase_order_id = po.id AND pl.line_number = l.order_line_number
         WHERE l.receipt_id = ?
         ORDER BY l.line_number`
      )
      .bind(receiptId)
      .all<{
        line_number: number;
        order_number: string;
        order_line_number: number;
        movement: string;
        quantity: number;
        unit_code: string | null;
        line_status: string | null;
        return_reason: string | null;
        item_name: string | null;
        item_description: string | null;
        ordered: number | null;
        ordered_unit: string | null;
      }>()
  ).results.map((l) => {
    const rejected = l.line_status === "rejected";
    return {
      lineNumber: l.line_number,
      orderNumber: l.order_number,
      orderLine: l.order_line_number,
      item: l.item_name ?? l.item_description ?? null,
      ordered: l.ordered,
      unitCode: l.unit_code ?? l.ordered_unit ?? null,
      received: !rejected && l.movement === "received" ? l.quantity : 0,
      rejected: rejected ? l.quantity : 0,
      returned: !rejected && l.movement === "returned" ? l.quantity : 0,
      // The reason from the customer's list of return reasons; never a free-text note.
      reason: !rejected && l.movement === "returned" ? l.return_reason : null,
    };
  });
  const messages = portalView(
    (await db.prepare("SELECT * FROM supplier_messages WHERE receipt_id = ? ORDER BY created_at, rowid").bind(receiptId).all<MessageRow>()).results
  );
  // The conversation in place of the list's counts, as an invoice's (0721).
  return { status: 200, body: { receipt: { ...receiptSummary(row), lines, messages } } };
}
