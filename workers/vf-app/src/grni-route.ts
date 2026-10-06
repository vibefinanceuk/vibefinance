import type { RouteResult } from "./org-route.js";
import { loadPoConsumption } from "./po-matching.js";
import { scopedToChosenOrg, unitClause, unitsWherePermitted } from "./enforce.js";

/**
 * **Goods received not invoiced — decision 0650**, slice 1 of the
 * Warehouse Receipts proposal (Goods Receipts level 3). What month-end
 * accrues for goods that are in but not yet billed.
 *
 * Per purchase order line, **as at a date** (Dan agreed both):
 *
 * - **received** — every receipt line dated on or before it (receipt
 *   date), on registered receipts (0651) not cancelled by then, less
 *   what was returned by then. Every receipt counts, not only for suppliers marked Receipting
 *   required: a receipt means the goods are in either way;
 * - **invoiced** — invoices against the line issued on or before it,
 *   counted exactly as matching counts them (`loadPoConsumption`);
 * - **not invoiced** — received less invoiced, only where positive (the
 *   other way round is *Awaiting receipt*, 0647);
 * - **amount** — not invoiced at the PO line's unit price, in the PO's
 *   currency. Never one blended figure across currencies.
 *
 * **Aged** by the receipt date of the oldest goods not yet invoiced:
 * what was invoiced and returned is taken from the earliest receipts
 * first. Scoped as Accruals is: AP.Analysis, by the order's unit, and
 * the chosen organisation.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface GrniLine {
  org: string | null;
  supplier: string | null;
  supplierErpId: string | null;
  orderNumber: string;
  orderLine: number;
  item: string | null;
  received: number;
  returned: number;
  invoiced: number;
  notInvoiced: number;
  unitPrice: number | null;
  amount: number | null;
  currency: string | null;
  oldestReceiptDate: string;
  days: number;
}

export interface GrniReport {
  asAt: string;
  currencies: { currency: string | null; total: number; lines: number; over60: number; unpriced: number }[];
  suppliers: { supplier: string | null; currency: string | null; orders: string[]; d30: number; d60: number; over60: number; total: number }[];
  lines: GrniLine[];
}

function round(n: number, places = 6): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

export async function grniReport(db: D1Database, userId: string | undefined, org: string | null, asAtParam: string | null, now = new Date()): Promise<GrniReport | { error: string }> {
  const asAt = asAtParam ?? now.toISOString().slice(0, 10);
  if (!DATE.test(asAt) || Number.isNaN(Date.parse(`${asAt}T00:00:00Z`))) return { error: "asAt must be a date (YYYY-MM-DD)" };

  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Analysis") : null;
  const scope = unitClause({ units: await scopedToChosenOrg(db, visible, org) }, "po.org_unit_id");

  // Every receipt line in effect at the date, by order line, oldest first.
  const movements = (
    await db
      .prepare(
        `SELECT l.order_number, l.order_line_number AS line, l.movement, l.quantity, r.receipt_date
         FROM goods_receipt_lines l
         JOIN goods_receipts r ON r.id = l.receipt_id
         JOIN purchase_orders po ON po.order_number = l.order_number
         WHERE r.receipt_date <= ? AND r.status = 'registered'
           AND (r.cancelled_at IS NULL OR substr(r.cancelled_at, 1, 10) > ?) ${scope.sql}
         ORDER BY l.order_number, l.order_line_number, r.receipt_date, r.created_at`
      )
      .bind(asAt, asAt, ...scope.binds)
      .all<{ order_number: string; line: number; movement: string; quantity: number; receipt_date: string }>()
  ).results;

  const byOrder = new Map<string, Map<number, { received: { date: string; qty: number }[]; returned: number }>>();
  for (const m of movements) {
    const lines = byOrder.get(m.order_number) ?? new Map();
    const l = lines.get(m.line) ?? { received: [], returned: 0 };
    if (m.movement === "returned") l.returned += m.quantity;
    else l.received.push({ date: m.receipt_date, qty: m.quantity });
    lines.set(m.line, l);
    byOrder.set(m.order_number, lines);
  }

  const out: GrniLine[] = [];
  for (const [orderNumber, lines] of byOrder) {
    const order = await db
      .prepare(
        `SELECT po.id, po.currency, u.name AS org_name,
                (SELECT s.name FROM suppliers s WHERE s.vat_id = po.seller_party_id ORDER BY s.status = 'active' DESC, s.name LIMIT 1) AS supplier,
                (SELECT s.erp_identifier FROM suppliers s WHERE s.vat_id = po.seller_party_id ORDER BY s.status = 'active' DESC, s.name LIMIT 1) AS supplier_erp_id
         FROM purchase_orders po LEFT JOIN org_units u ON u.id = po.org_unit_id
         WHERE po.order_number = ?`
      )
      .bind(orderNumber)
      .first<{ id: string; currency: string | null; org_name: string | null; supplier: string | null; supplier_erp_id: string | null }>();
    if (!order) continue;
    const poLines = new Map(
      (
        await db
          .prepare("SELECT line_number, quantity, item_name, item_description, price_amount, base_quantity, line_extension_amount FROM purchase_order_lines WHERE purchase_order_id = ?")
          .bind(order.id)
          .all<{ line_number: number; quantity: number | null; item_name: string | null; item_description: string | null; price_amount: number | null; base_quantity: number | null; line_extension_amount: number | null }>()
      ).results.map((p) => [p.line_number, p])
    );
    const consumption = await loadPoConsumption(db, orderNumber, null, asAt);

    for (const [lineNumber, l] of [...lines].sort((a, b) => a[0] - b[0])) {
      const received = l.received.reduce((s, r) => s + r.qty, 0);
      const invoiced = consumption.byLine.get(lineNumber)?.quantity ?? 0;
      const notInvoiced = round(received - l.returned - invoiced);
      if (notInvoiced <= 1e-9) continue;
      // The oldest goods still not invoiced: invoiced and returned are taken from the earliest receipts first.
      let used = invoiced + l.returned;
      let oldest = l.received[l.received.length - 1]?.date ?? asAt;
      for (const r of l.received) {
        if (used < r.qty - 1e-9) {
          oldest = r.date;
          break;
        }
        used -= r.qty;
      }
      const po = poLines.get(lineNumber);
      const unitPrice =
        po?.price_amount !== null && po?.price_amount !== undefined
          ? po.price_amount / (po.base_quantity || 1)
          : po?.line_extension_amount !== null && po?.line_extension_amount !== undefined && po.quantity
            ? po.line_extension_amount / po.quantity
            : null;
      out.push({
        org: order.org_name,
        supplier: order.supplier,
        supplierErpId: order.supplier_erp_id,
        orderNumber,
        orderLine: lineNumber,
        item: po?.item_name ?? po?.item_description ?? null,
        received: round(received),
        returned: round(l.returned),
        invoiced: round(invoiced),
        notInvoiced,
        unitPrice: unitPrice === null ? null : round(unitPrice),
        amount: unitPrice === null ? null : round(notInvoiced * unitPrice, 2),
        currency: order.currency,
        oldestReceiptDate: oldest,
        days: Math.max(0, daysBetween(oldest, asAt)),
      });
    }
  }

  const currencies = new Map<string | null, { currency: string | null; total: number; lines: number; over60: number; unpriced: number }>();
  const suppliers = new Map<string, GrniReport["suppliers"][number]>();
  for (const l of out) {
    const c = currencies.get(l.currency) ?? { currency: l.currency, total: 0, lines: 0, over60: 0, unpriced: 0 };
    c.lines++;
    if (l.amount === null) c.unpriced++;
    else {
      c.total = round(c.total + l.amount, 2);
      if (l.days > 60) c.over60 = round(c.over60 + l.amount, 2);
    }
    currencies.set(l.currency, c);
    const key = `${l.supplier ?? ""}|${l.currency ?? ""}`;
    const s = suppliers.get(key) ?? { supplier: l.supplier, currency: l.currency, orders: [], d30: 0, d60: 0, over60: 0, total: 0 };
    if (!s.orders.includes(l.orderNumber)) s.orders.push(l.orderNumber);
    const amount = l.amount ?? 0;
    if (l.days <= 30) s.d30 = round(s.d30 + amount, 2);
    else if (l.days <= 60) s.d60 = round(s.d60 + amount, 2);
    else s.over60 = round(s.over60 + amount, 2);
    s.total = round(s.total + amount, 2);
    suppliers.set(key, s);
  }

  return {
    asAt,
    currencies: [...currencies.values()].sort((a, b) => b.total - a.total),
    suppliers: [...suppliers.values()].sort((a, b) => b.total - a.total),
    lines: out,
  };
}

export async function handleGrni(db: D1Database, userId: string, org: string | null, asAt: string | null): Promise<RouteResult> {
  const report = await grniReport(db, userId, org, asAt);
  if ("error" in report) return { status: 400, body: { error: report.error, reason: "as_at_invalid" } };
  return { status: 200, body: { ...report } };
}

const CSV_COLUMNS: [string, (l: GrniLine, asAt: string) => unknown][] = [
  ["as_at", (_, asAt) => asAt],
  ["org", (l) => l.org],
  ["supplier", (l) => l.supplier],
  ["supplier_erp_id", (l) => l.supplierErpId],
  ["order_number", (l) => l.orderNumber],
  ["order_line", (l) => l.orderLine],
  ["item", (l) => l.item],
  ["received", (l) => l.received],
  ["returned", (l) => l.returned],
  ["invoiced", (l) => l.invoiced],
  ["not_invoiced", (l) => l.notInvoiced],
  ["unit_price", (l) => l.unitPrice],
  ["amount", (l) => l.amount],
  ["currency", (l) => l.currency],
  ["oldest_receipt_date", (l) => l.oldestReceiptDate],
  ["days", (l) => l.days],
];

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return String(v);
  // A spreadsheet would read a leading = + - @ as a formula: kept as text.
  let s = String(v);
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The lines as a CSV for the accrual journal: one row per PO line not fully invoiced. */
export function grniCsv(report: GrniReport): string {
  const rows = [CSV_COLUMNS.map(([h]) => h).join(",")];
  for (const l of report.lines) rows.push(CSV_COLUMNS.map(([, f]) => cell(f(l, report.asAt))).join(","));
  return rows.join("\r\n") + "\r\n";
}
