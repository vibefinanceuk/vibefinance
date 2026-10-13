import type { PortalAccessClaims } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";
import { BARE_SQL, bareVat, loadReceiptSharingConfig } from "./receipt-sharing.js";
import { EFFECTIVE_STATUS_CASE, INVOICED_AMOUNTS_JOIN } from "./purchase-order-route.js";
import { orderFigures, receiptStateJoin } from "./goods-receipts.js";
import { getOrgMatchingConfig } from "./po-matching.js";
import { portalView, type MessageRow } from "./supplier-messages.js";

/**
 * **Purchase orders, shared with suppliers in the network — decision
 * 0751**, slice 3 of the purchase orders proposal (0749), as goods
 * receipts are (0738).
 *
 * AP Setup › Supplier Network says whether suppliers see the orders
 * placed with them (off until someone turns it on), and, if wanted, only
 * those issued on or after a date. A supplier's own page can say otherwise
 * for that supplier, and **the supplier's setting wins**.
 *
 * What a supplier sees of an order is what the buyer ordered from them,
 * and where it has got to: its number, date, company, currency and total,
 * and per line the item, quantity, unit, price, amount, and how much has
 * been received and invoiced. **Never** why an order is on hold, who
 * bought it, its coding, or anything on its way in (0749): only orders in
 * force are shown.
 */

export type SupplierSetting = "default" | "share" | "none";

async function supplierSetting(db: D1Database, supplierId: string): Promise<SupplierSetting> {
  const row = await db.prepare("SELECT setting FROM supplier_order_sharing WHERE supplier_id = ?").bind(supplierId).first<{ setting: string }>();
  return row?.setting === "share" || row?.setting === "none" ? row.setting : "default";
}

/** Whether this supplier sees its orders: its own setting, or else AP Setup's; and from when. */
export async function ordersSharedWith(db: D1Database, supplierId: string): Promise<{ shared: boolean; from: string | null }> {
  const [config, own] = await Promise.all([loadReceiptSharingConfig(db), supplierSetting(db, supplierId)]);
  return { shared: own === "default" ? config.shareOrders : own === "share", from: config.ordersFrom };
}

/** `GET /suppliers/:id/order-sharing` — the supplier's setting, and what AP Setup says. */
export async function handleGetSupplierOrderSharing(db: D1Database, supplierId: string): Promise<RouteResult> {
  const supplier = await db.prepare("SELECT 1 FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!supplier) return { status: 404, body: { error: "no such supplier" } };
  const [config, setting] = await Promise.all([loadReceiptSharingConfig(db), supplierSetting(db, supplierId)]);
  return { status: 200, body: { setting, apSetup: config.shareOrders } };
}

/** `PUT /suppliers/:id/order-sharing` `{ setting: "default" | "share" | "none" }` — Supplier.Maintain. */
export async function handlePutSupplierOrderSharing(db: D1Database, userId: string, supplierId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const setting = body.setting;
  if (setting !== "default" && setting !== "share" && setting !== "none") return { status: 400, body: { error: "setting is default, share or none" } };
  const supplier = await db.prepare("SELECT 1 FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!supplier) return { status: 404, body: { error: "no such supplier" } };
  if (setting === "default") {
    await db.prepare("DELETE FROM supplier_order_sharing WHERE supplier_id = ?").bind(supplierId).run();
  } else {
    await db
      .prepare(
        `INSERT INTO supplier_order_sharing (supplier_id, setting, updated_by, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (supplier_id) DO UPDATE SET setting = excluded.setting, updated_by = excluded.updated_by, updated_at = excluded.updated_at`
      )
      .bind(supplierId, setting, userId, new Date().toISOString())
      .run();
  }
  return handleGetSupplierOrderSharing(db, supplierId);
}

// ---------------------------------------------------------------------------
// In the network
// ---------------------------------------------------------------------------

/**
 * What a supplier is told of an order: open, partly or fully received,
 * partly or fully invoiced, on hold, or closed (closed covers cancelled,
 * 0750).
 */
export const PORTAL_ORDER_STATUSES = ["order_open", "order_part_received", "order_received", "order_part_invoiced", "order_invoiced", "order_on_hold", "order_closed"] as const;

/**
 * **Which orders are this supplier's, for these companies**: orders whose
 * seller is the supplier (by its VAT number, however written, or its ERP
 * number), placed by a company the invitation covers or one beneath it,
 * issued on or after AP Setup's date where it gives one. Null when nothing
 * is shared.
 */
async function orderScope(db: D1Database, claims: PortalAccessClaims): Promise<{ sql: string; binds: unknown[] } | null> {
  const sharing = await ordersSharedWith(db, claims.supplierId);
  if (!sharing.shared || claims.orgUnitIds.length === 0) return null;
  const supplier = await db.prepare("SELECT vat_id, erp_identifier FROM suppliers WHERE id = ?").bind(claims.supplierId).first<{ vat_id: string | null; erp_identifier: string | null }>();
  if (!supplier || (!supplier.vat_id && !supplier.erp_identifier)) return null;
  const sellers: string[] = [];
  const binds: unknown[] = [];
  if (supplier.vat_id && bareVat(supplier.vat_id)) {
    sellers.push(`${BARE_SQL("po.seller_party_id")} = ?`);
    binds.push(bareVat(supplier.vat_id));
  }
  if (supplier.erp_identifier) {
    sellers.push("po.seller_party_id = ?");
    binds.push(supplier.erp_identifier);
  }
  return {
    sql: `(${sellers.join(" OR ")})
      ${sharing.from ? "AND po.issue_date >= ?" : ""}
      AND po.org_unit_id IN (
        WITH RECURSIVE covered(id) AS (
          SELECT id FROM org_units WHERE id IN (${claims.orgUnitIds.map(() => "?").join(", ")})
          UNION SELECT u.id FROM org_units u JOIN covered c ON u.parent_unit_id = c.id
        ) SELECT id FROM covered)`,
    binds: [...binds, ...(sharing.from ? [sharing.from] : []), ...claims.orgUnitIds],
  };
}

interface PortalOrderRow {
  id: string;
  order_number: string;
  issue_date: string | null;
  currency: string | null;
  payable_amount: number | null;
  created_at: string;
  org_unit_id: string | null;
  org_unit_name: string | null;
  effective_status: string;
  receipt_state: string | null;
  msg_total: number;
  msg_unread: number;
  query_open: number;
}

async function orderSelect(db: D1Database): Promise<string> {
  const tolerance = (await getOrgMatchingConfig(db)).quantityTolerancePct ?? 0;
  return `
    SELECT po.id, po.order_number, po.issue_date, po.currency, po.payable_amount, po.created_at,
           po.org_unit_id, ou.name AS org_unit_name,
           (${EFFECTIVE_STATUS_CASE}) AS effective_status, rs.state AS receipt_state,
           -- Decision 0752: its conversation, what this person (the first placeholder, their link) has not read, and a question waiting.
           (SELECT count(*) FROM purchase_order_messages m WHERE m.order_number = po.order_number) AS msg_total,
           (SELECT count(*) FROM purchase_order_messages m WHERE m.order_number = po.order_number AND m.direction = 'to_supplier'
              AND m.created_at > COALESCE((SELECT pr.read_at FROM portal_order_reads pr WHERE pr.link_id = ? AND pr.order_number = po.order_number), '')) AS msg_unread,
           EXISTS (SELECT 1 FROM purchase_order_messages q WHERE q.order_number = po.order_number AND q.direction = 'to_supplier' AND q.kind = 'question'
                   AND NOT EXISTS (SELECT 1 FROM purchase_order_messages a WHERE a.order_number = po.order_number AND a.direction = 'from_supplier' AND a.created_at >= q.created_at)) AS query_open
    FROM purchase_orders po
    LEFT JOIN org_units ou ON ou.id = po.org_unit_id
    ${INVOICED_AMOUNTS_JOIN}
    ${receiptStateJoin(tolerance)}`;
}

/** The status a supplier sees: hold and close first, then invoicing, then receiving (0377, 0646). */
export function portalOrderStatus(effective: string, receiptState: string | null): (typeof PORTAL_ORDER_STATUSES)[number] {
  if (effective === "closed") return "order_closed";
  if (effective === "on_hold") return "order_on_hold";
  if (effective === "invoiced_full") return "order_invoiced";
  if (effective === "invoiced_part") return "order_part_invoiced";
  if (receiptState === "fully_received" || receiptState === "over_received") return "order_received";
  if (receiptState === "partially_received") return "order_part_received";
  return "order_open";
}

function orderSummary(r: PortalOrderRow) {
  return {
    id: r.id,
    documentType: "purchase_order",
    invoiceNumber: r.order_number,
    issueDate: r.issue_date,
    total: r.payable_amount,
    currency: r.currency,
    purchaseOrder: r.order_number,
    company: r.org_unit_name ?? r.org_unit_id,
    orgUnitId: r.org_unit_id,
    // Sorted among the invoices by the day it was issued, at the time it was loaded.
    receivedAt: `${r.issue_date ?? r.created_at.slice(0, 10)}T${(r.created_at.match(/\d{2}:\d{2}:\d{2}/) ?? ["00:00:00"])[0]}`,
    // Decision 0752: Query raised while the customer's question waits on the supplier, as an invoice's and a receipt's.
    status: r.query_open ? "query_raised" : portalOrderStatus(r.effective_status, r.receipt_state),
    comment: null,
    messages: { total: r.msg_total ?? 0, unread: r.msg_unread ?? 0 },
    creditedInvoice: null,
    dueDate: null,
    buyerReference: null,
  };
}

/** This supplier's shared orders, newest first, at most `limit` (+1 to say there were more). Empty when nothing is shared. */
export async function listPortalOrders(db: D1Database, claims: PortalAccessClaims, q: string, limit: number): Promise<{ orders: ReturnType<typeof orderSummary>[]; more: boolean; shared: boolean }> {
  const scope = await orderScope(db, claims);
  if (!scope) return { orders: [], more: false, shared: false };
  const search = q ? " AND (po.order_number LIKE ? OR EXISTS (SELECT 1 FROM purchase_order_lines ql WHERE ql.purchase_order_id = po.id AND (ql.item_name LIKE ? OR ql.sellers_item_id LIKE ?)))" : "";
  const rows = (
    await db
      .prepare(`${await orderSelect(db)} WHERE ${scope.sql}${search} ORDER BY po.issue_date DESC, po.created_at DESC, po.id DESC LIMIT ${limit + 1}`)
      .bind(claims.linkId, ...scope.binds, ...(q ? [`%${q}%`, `%${q}%`, `%${q}%`] : []))
      .all<PortalOrderRow>()
  ).results;
  return { orders: rows.slice(0, limit).map(orderSummary), more: rows.length > limit, shared: true };
}

/**
 * `GET /portal/orders/:id` — one shared order, line by line: what was
 * ordered, at what price, and how much has been received (net of returns,
 * registered receipts only) and invoiced. The same answer for one that does
 * not exist, is not this supplier's, or is not shared with them.
 */
export async function getPortalOrder(db: D1Database, claims: PortalAccessClaims, orderId: string): Promise<RouteResult> {
  const scope = await orderScope(db, claims);
  if (!scope) return { status: 404, body: { error: "not found" } };
  const row = await db.prepare(`${await orderSelect(db)} WHERE po.id = ? AND ${scope.sql}`).bind(claims.linkId, orderId, ...scope.binds).first<PortalOrderRow>();
  if (!row) return { status: 404, body: { error: "not found" } };
  // Decision 0752: opened, so its messages are read, for this person.
  await db
    .prepare("INSERT INTO portal_order_reads (link_id, order_number, read_at) VALUES (?, ?, ?) ON CONFLICT (link_id, order_number) DO UPDATE SET read_at = excluded.read_at")
    .bind(claims.linkId, row.order_number, new Date().toISOString())
    .run();
  const [figures, poLines] = await Promise.all([
    orderFigures(db, row.order_number),
    db
      .prepare("SELECT line_number, item_name, item_description, sellers_item_id, quantity, unit_code, price_amount, line_extension_amount FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number")
      .bind(row.id)
      .all<{ line_number: number; item_name: string | null; item_description: string | null; sellers_item_id: string | null; quantity: number | null; unit_code: string | null; price_amount: number | null; line_extension_amount: number | null }>()
      .then((r) => r.results),
  ]);
  const byLine = new Map((figures?.lines ?? []).map((l) => [l.lineNumber, l]));
  const receipting = figures?.receiptingRequired ?? false;
  const lines = poLines.map((l) => {
    const f = byLine.get(l.line_number);
    /**
     * **Still to invoice — decision 0755**, for *Invoice this order*: what
     * has been received and not yet invoiced where the customer receipts
     * this order's goods, what was ordered and not yet invoiced otherwise.
     */
    const basis = receipting ? (f ? f.net : 0) : (l.quantity ?? 0);
    const toInvoice = Math.max(0, Math.round((basis - (f ? f.invoiced : 0)) * 1e6) / 1e6);
    return {
      lineNumber: l.line_number,
      item: l.item_name ?? l.item_description ?? null,
      sellersItemId: l.sellers_item_id,
      ordered: l.quantity,
      unitCode: l.unit_code,
      price: l.price_amount,
      amount: l.line_extension_amount,
      received: f ? f.net : 0,
      invoiced: f ? f.invoiced : 0,
      outstanding: f?.outstanding ?? null,
      toInvoice,
    };
  });
  const messages = portalView(
    (await db.prepare("SELECT * FROM purchase_order_messages WHERE order_number = ? ORDER BY created_at, rowid").bind(row.order_number).all<MessageRow>()).results
  );
  // The conversation in place of the list's counts, as a receipt's (0740).
  /**
   * **Decision 0755: the company it is invoiced to** — the one this
   * person's link covers the order by (its own unit, or the company above
   * it), as Create lists the companies.
   */
  const invoiceCompanyId = row.org_unit_id ? await coveringUnit(db, row.org_unit_id, claims.orgUnitIds) : null;
  return { status: 200, body: { order: { ...orderSummary(row), lines, messages, receiptingRequired: receipting, invoiceCompanyId } } };
}

/** The first of `units` at or above `unitId`, walking up the organisation. */
async function coveringUnit(db: D1Database, unitId: string, units: string[]): Promise<string | null> {
  const chain = (
    await db
      .prepare(
        `WITH RECURSIVE up(id, parent_unit_id, depth) AS (
           SELECT id, parent_unit_id, 0 FROM org_units WHERE id = ?
           UNION ALL SELECT u.id, u.parent_unit_id, up.depth + 1 FROM org_units u JOIN up ON u.id = up.parent_unit_id WHERE up.depth < 20
         ) SELECT id FROM up ORDER BY depth`
      )
      .bind(unitId)
      .all<{ id: string }>()
  ).results;
  return chain.find((u) => units.includes(u.id))?.id ?? null;
}

/** Decision 0752: the order's number when this order is one the token's person may see (shared, theirs, their companies), else null. */
export async function portalMayReadOrder(db: D1Database, claims: PortalAccessClaims, orderId: string): Promise<string | null> {
  const scope = await orderScope(db, claims);
  if (!scope) return null;
  const row = await db.prepare(`SELECT po.order_number FROM purchase_orders po WHERE po.id = ? AND ${scope.sql}`).bind(orderId, ...scope.binds).first<{ order_number: string }>();
  return row?.order_number ?? null;
}
