import type { RouteResult } from "./org-route.js";
import { parseCsv } from "./load-suppliers.js";
import { getOrgMatchingConfig, loadPoConsumption } from "./po-matching.js";
import { isWithinScope, scopedToChosenOrg, unitClause, unitsWherePermitted } from "./enforce.js";

/**
 * **Goods receipts — decision 0644, slice 2 of the Goods Receipts
 * proposal (0643).** What arrived and what went back, against purchase
 * order lines, and what that leaves each line and each order.
 *
 * - A receipt has a number, a date and lines. Each line moves a
 *   quantity against one PO line: **received** (accepted into stock) or
 *   **returned** (sent back, with a goods return reason).
 * - Lines name the **order number and line number**, never the internal
 *   PO line id: a PO loaded again (a change order) recreates its lines.
 * - **Nothing is deleted.** A receipt entered by mistake is cancelled,
 *   with a reason, and its lines count for nothing.
 * - Every figure is derived from the lines; none is stored.
 *
 * Who: **AP.Receive** records and cancels, for orders in the units where
 * it is held. **AP.Receive or AP.Validate** sees, in the units where
 * either is held (Dan: AP clerks see receipts read-only).
 */

export type LineState = "not_received" | "partially_received" | "fully_received" | "over_received";
export type Movement = "received" | "returned";
/** Decision 0651: a receipt counts only once registered. */
export type ReceiptStatus = "pending" | "registered" | "rejected";

const EPS = 1e-9;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 500;

function isDate(v: unknown): v is string {
  if (typeof v !== "string" || !DATE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function text(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s === "" ? null : s.slice(0, NOTE_MAX);
}

export function quantityOf(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.trim()) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Where a person may see receipts: wherever they hold AP.Receive or AP.Validate. `null` is everywhere. */
export async function receiptViewScope(db: D1Database, userId: string): Promise<string[] | null> {
  const [receive, validate] = await Promise.all([
    unitsWherePermitted(db, userId, "AP.Receive"),
    unitsWherePermitted(db, userId, "AP.Validate"),
  ]);
  if (receive === null || validate === null) return null;
  return [...new Set([...receive, ...validate])];
}

/**
 * A line's state, from what was ordered and what is held — within the
 * supplier's quantity tolerance (or the organisation's), the same
 * tolerance two-way matching allows.
 */
export function lineState(ordered: number | null, net: number, tolerancePct: number): LineState {
  if (net <= EPS) return "not_received";
  if (ordered === null || ordered <= 0) return "fully_received";
  const slack = (ordered * tolerancePct) / 100;
  if (net > ordered + slack + EPS) return "over_received";
  if (net >= ordered - slack - EPS) return "fully_received";
  return "partially_received";
}

/** An order's state, from its lines' (only those still on the order). */
export function orderState(states: LineState[]): LineState {
  if (states.length === 0 || states.every((s) => s === "not_received")) return "not_received";
  if (states.includes("over_received")) return "over_received";
  if (states.every((s) => s === "fully_received")) return "fully_received";
  return "partially_received";
}

interface OrderRow {
  id: string;
  order_number: string;
  status: string;
  org_unit_id: string | null;
  seller_party_id: string | null;
  currency: string | null;
}

interface PoLineRow {
  line_number: number;
  quantity: number | null;
  unit_code: string | null;
  item_name: string | null;
  item_description: string | null;
}

async function supplierOf(db: D1Database, sellerPartyId: string | null) {
  if (!sellerPartyId) return null;
  return db
    .prepare(
      `SELECT id, name, match_option, quantity_tolerance_pct FROM suppliers
       WHERE vat_id = ? ORDER BY status = 'active' DESC, name LIMIT 1`
    )
    .bind(sellerPartyId)
    .first<{ id: string; name: string; match_option: string | null; quantity_tolerance_pct: number | null }>();
}

/** Received and returned per order line, on registered receipts not cancelled (0651: a pending one does not count yet). */
export async function heldByLine(db: D1Database, orderNumber: string): Promise<Map<number, { received: number; returned: number }>> {
  const rows = (
    await db
      .prepare(
        `SELECT l.order_line_number AS line, l.movement, SUM(l.quantity) AS qty
         FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id
         WHERE l.order_number = ? AND r.cancelled_at IS NULL AND r.status = 'registered' AND l.line_status = 'active' AND l.waiting_since IS NULL
         GROUP BY l.order_line_number, l.movement`
      )
      .bind(orderNumber)
      .all<{ line: number; movement: Movement; qty: number }>()
  ).results;
  const held = new Map<number, { received: number; returned: number }>();
  for (const r of rows) {
    const h = held.get(r.line) ?? { received: 0, returned: 0 };
    h[r.movement] += r.qty;
    held.set(r.line, h);
  }
  return held;
}

export interface LineFigures {
  lineNumber: number;
  itemName: string | null;
  unitCode: string | null;
  /** False for a line receipts name that the order (since changed) no longer has. */
  onOrder: boolean;
  ordered: number | null;
  received: number;
  returned: number;
  net: number;
  outstanding: number | null;
  invoiced: number;
  state: LineState;
  /** Invoiced beyond what was kept (beyond tolerance): that much is owed back. 0 when none. */
  creditExpected: number;
}

export interface OrderFigures {
  orderNumber: string;
  status: string;
  orgUnitId: string | null;
  currency: string | null;
  supplier: { id: string; name: string } | null;
  receiptingRequired: boolean;
  tolerancePct: number;
  state: LineState;
  creditExpected: boolean;
  lines: LineFigures[];
}

/** One order's lines and what receipts, returns and invoices leave each. `null` when there is no such order. */
export async function orderFigures(db: D1Database, orderNumber: string): Promise<OrderFigures | null> {
  const order = await db
    .prepare("SELECT id, order_number, status, org_unit_id, seller_party_id, currency FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<OrderRow>();
  if (!order) return null;
  const [poLines, held, supplier, config, consumption] = await Promise.all([
    db
      .prepare("SELECT line_number, quantity, unit_code, item_name, item_description FROM purchase_order_lines WHERE purchase_order_id = ? ORDER BY line_number")
      .bind(order.id)
      .all<PoLineRow>()
      .then((r) => r.results),
    heldByLine(db, orderNumber),
    supplierOf(db, order.seller_party_id),
    getOrgMatchingConfig(db),
    loadPoConsumption(db, orderNumber, null),
  ]);
  const tolerancePct = supplier?.quantity_tolerance_pct ?? config.quantityTolerancePct ?? 0;

  const figure = (n: number, po: PoLineRow | undefined): LineFigures => {
    const h = held.get(n) ?? { received: 0, returned: 0 };
    const net = round(h.received - h.returned);
    const ordered = po ? po.quantity : null;
    const invoiced = round(consumption.byLine.get(n)?.quantity ?? 0);
    const slack = ordered ? (ordered * tolerancePct) / 100 : 0;
    const owed = invoiced - net - slack;
    return {
      lineNumber: n,
      itemName: po?.item_name ?? po?.item_description ?? null,
      unitCode: po?.unit_code ?? null,
      onOrder: Boolean(po),
      ordered,
      received: round(h.received),
      returned: round(h.returned),
      net,
      outstanding: ordered === null ? null : round(Math.max(0, ordered - net)),
      invoiced,
      state: po ? lineState(ordered, net, tolerancePct) : net > EPS ? "over_received" : "not_received",
      creditExpected: h.returned > EPS && owed > EPS ? round(invoiced - net) : 0,
    };
  };

  const lines = poLines.map((l) => figure(l.line_number, l));
  for (const n of [...held.keys()].sort((a, b) => a - b)) {
    if (!poLines.some((l) => l.line_number === n)) lines.push(figure(n, undefined));
  }
  return {
    orderNumber: order.order_number,
    status: order.status,
    orgUnitId: order.org_unit_id,
    currency: order.currency,
    supplier: supplier ? { id: supplier.id, name: supplier.name } : null,
    receiptingRequired: supplier?.match_option === "three_way",
    tolerancePct,
    state: orderState(lines.filter((l) => l.onOrder).map((l) => l.state)),
    creditExpected: lines.some((l) => l.creditExpected > 0),
    lines,
  };
}

// ── Recording ──────────────────────────────────────────────────────────

export interface LineInput {
  orderNumber?: unknown;
  orderLine?: unknown;
  quantity?: unknown;
  movement?: unknown;
  returnReason?: unknown;
  unitCode?: unknown;
  note?: unknown;
}

export interface Refusal {
  reason: string;
  message: string;
}

export interface OverReceipt {
  orderNumber: string;
  orderLine: number;
  ordered: number;
  netAfter: number;
}

interface OrderContext {
  order: OrderRow;
  lines: Map<number, PoLineRow>;
  net: Map<number, number>;
}

/**
 * Checks lines against their orders, keeping a running net per line so
 * a file that receives and then returns in the same load is judged in
 * order. Built once per save or load.
 */
export class Checker {
  private orders = new Map<string, OrderContext | null>();
  private reasons: { id: string; label: string }[] | null = null;
  constructor(
    private db: D1Database,
    private scope: string[] | null
  ) {}

  private async context(orderNumber: string): Promise<OrderContext | null> {
    if (this.orders.has(orderNumber)) return this.orders.get(orderNumber)!;
    const order = await this.db
      .prepare("SELECT id, order_number, status, org_unit_id, seller_party_id, currency FROM purchase_orders WHERE order_number = ?")
      .bind(orderNumber)
      .first<OrderRow>();
    let ctx: OrderContext | null = null;
    if (order && isWithinScope({ units: this.scope }, order.org_unit_id)) {
      const poLines = (
        await this.db
          .prepare("SELECT line_number, quantity, unit_code, item_name, item_description FROM purchase_order_lines WHERE purchase_order_id = ?")
          .bind(order.id)
          .all<PoLineRow>()
      ).results;
      const held = await heldByLine(this.db, orderNumber);
      ctx = {
        order,
        lines: new Map(poLines.map((l) => [l.line_number, l])),
        net: new Map([...held.entries()].map(([n, h]) => [n, h.received - h.returned])),
      };
    }
    this.orders.set(orderNumber, ctx);
    return ctx;
  }

  private async reasonId(given: string): Promise<string | null> {
    if (!this.reasons) {
      this.reasons = (
        await this.db.prepare("SELECT id, label FROM goods_return_reasons WHERE active = 1").all<{ id: string; label: string }>()
      ).results;
    }
    const g = given.trim().toLowerCase();
    return this.reasons.find((r) => r.id.toLowerCase() === g || r.label.toLowerCase() === g)?.id ?? null;
  }

  /**
   * One line: refused with a reason, or accepted with what to store and
   * any over-receipt it causes. Accepting moves the running net, so call
   * `commit` only for lines that will be stored.
   */
  async check(input: LineInput): Promise<
    | { refused: Refusal }
    | {
        line: { orderNumber: string; orderLine: number; movement: Movement; quantity: number; unitCode: string | null; returnReasonId: string | null; note: string | null };
        over: OverReceipt | null;
      }
  > {
    const orderNumber = typeof input.orderNumber === "string" ? input.orderNumber.trim() : "";
    if (!orderNumber) return { refused: { reason: "order_missing", message: "no order number" } };
    const orderLine = Number(typeof input.orderLine === "string" ? input.orderLine.trim() : input.orderLine);
    if (!Number.isInteger(orderLine) || orderLine < 1)
      return { refused: { reason: "order_line_missing", message: "no order line number" } };
    const ctx = await this.context(orderNumber);
    // Out of scope reads as not there, as Purchase Orders does (0375).
    if (!ctx) return { refused: { reason: "order_not_found", message: `no purchase order ${orderNumber}` } };
    if (ctx.order.status === "closed")
      return { refused: { reason: "order_closed", message: `purchase order ${orderNumber} is closed` } };
    const po = ctx.lines.get(orderLine);
    if (!po) return { refused: { reason: "order_line_not_found", message: `purchase order ${orderNumber} has no line ${orderLine}` } };

    const quantity = quantityOf(input.quantity);
    if (quantity === null) return { refused: { reason: "quantity_invalid", message: "the quantity must be a number above nought" } };

    const rawMovement = typeof input.movement === "string" ? input.movement.trim().toLowerCase() : "";
    const movement: Movement | null = rawMovement === "" || rawMovement === "received" || rawMovement === "receipt" ? "received" : rawMovement === "returned" || rawMovement === "return" ? "returned" : null;
    if (!movement) return { refused: { reason: "movement_invalid", message: "the movement must be received or returned" } };

    const unitCode = text(input.unitCode);
    if (unitCode && po.unit_code && unitCode.toLowerCase() !== po.unit_code.toLowerCase())
      return { refused: { reason: "unit_mismatch", message: `the order line is in ${po.unit_code}, not ${unitCode}` } };

    let returnReasonId: string | null = null;
    const net = ctx.net.get(orderLine) ?? 0;
    if (movement === "returned") {
      const given = text(input.returnReason);
      if (!given) return { refused: { reason: "return_reason_missing", message: "a return needs a reason" } };
      returnReasonId = await this.reasonId(given);
      if (!returnReasonId) return { refused: { reason: "return_reason_unknown", message: `"${given}" is not a goods return reason` } };
      if (quantity > net + EPS)
        return { refused: { reason: "return_exceeds_received", message: `only ${round(Math.max(0, net))} is held on that line` } };
    }

    const netAfter = movement === "received" ? net + quantity : net - quantity;
    const over =
      movement === "received" && po.quantity !== null && netAfter > po.quantity + EPS
        ? { orderNumber, orderLine, ordered: po.quantity, netAfter: round(netAfter) }
        : null;
    return { line: { orderNumber, orderLine, movement, quantity, unitCode, returnReasonId, note: text(input.note) }, over };
  }

  /**
   * **Matching's check — decision 0652.** As `check`, but a line whose
   * order, order line, unit or held quantity is wrong is kept, saying
   * why (`attention`), for a person to fix at Matching. What cannot be
   * stored at all (no order number, no line number, no quantity, a
   * movement or return reason that is not one) is still refused.
   * Accepting moves no running net: call `commit` for a line with no
   * attention.
   */
  async checkLenient(input: LineInput): Promise<
    | { refused: Refusal }
    | {
        line: { orderNumber: string; orderLine: number; movement: Movement; quantity: number; unitCode: string | null; returnReasonId: string | null; note: string | null };
        over: OverReceipt | null;
        attention: Refusal | null;
      }
  > {
    const orderNumber = typeof input.orderNumber === "string" ? input.orderNumber.trim() : "";
    if (!orderNumber) return { refused: { reason: "order_missing", message: "no order number" } };
    const orderLine = Number(typeof input.orderLine === "string" ? input.orderLine.trim() : input.orderLine);
    if (!Number.isInteger(orderLine) || orderLine < 1) return { refused: { reason: "order_line_missing", message: "no order line number" } };
    const quantity = quantityOf(input.quantity);
    if (quantity === null) return { refused: { reason: "quantity_invalid", message: "the quantity must be a number above nought" } };
    const rawMovement = typeof input.movement === "string" ? input.movement.trim().toLowerCase() : "";
    const movement: Movement | null = rawMovement === "" || rawMovement === "received" || rawMovement === "receipt" ? "received" : rawMovement === "returned" || rawMovement === "return" ? "returned" : null;
    if (!movement) return { refused: { reason: "movement_invalid", message: "the movement must be received or returned" } };
    let returnReasonId: string | null = null;
    if (movement === "returned") {
      const given = text(input.returnReason);
      if (!given) return { refused: { reason: "return_reason_missing", message: "a return needs a reason" } };
      returnReasonId = await this.reasonId(given);
      if (!returnReasonId) return { refused: { reason: "return_reason_unknown", message: `"${given}" is not a goods return reason` } };
    }
    const unitCode = text(input.unitCode);
    const line = { orderNumber, orderLine, movement, quantity, unitCode, returnReasonId, note: text(input.note) };
    const attention = (reason: string, message: string) => ({ line, over: null, attention: { reason, message } });

    const ctx = await this.context(orderNumber);
    if (!ctx) {
      // 0654: not loaded at all waits for it; one outside the sender's units reads as not there (0375) and needs a person.
      const loaded = await this.db.prepare("SELECT 1 FROM purchase_orders WHERE order_number = ?").bind(orderNumber).first();
      return loaded ? attention("order_not_found", `no purchase order ${orderNumber}`) : attention("order_not_loaded", `purchase order ${orderNumber} is not loaded yet`);
    }
    if (ctx.order.status === "closed") return attention("order_closed", `purchase order ${orderNumber} is closed`);
    const po = ctx.lines.get(orderLine);
    if (!po) return attention("order_line_not_found", `purchase order ${orderNumber} has no line ${orderLine}`);
    if (unitCode && po.unit_code && unitCode.toLowerCase() !== po.unit_code.toLowerCase())
      return attention("unit_mismatch", `the order line is in ${po.unit_code}, not ${unitCode}`);
    const net = ctx.net.get(orderLine) ?? 0;
    if (movement === "returned" && quantity > net + EPS)
      return attention("return_exceeds_received", `only ${round(Math.max(0, net))} is held on that line`);
    const netAfter = movement === "received" ? net + quantity : net - quantity;
    const over =
      movement === "received" && po.quantity !== null && netAfter > po.quantity + EPS
        ? { orderNumber, orderLine, ordered: po.quantity, netAfter: round(netAfter) }
        : null;
    return { line, over, attention: null };
  }

  commit(orderNumber: string, orderLine: number, movement: Movement, quantity: number): void {
    const ctx = this.orders.get(orderNumber);
    if (!ctx) return;
    ctx.net.set(orderLine, (ctx.net.get(orderLine) ?? 0) + (movement === "received" ? quantity : -quantity));
  }
}

function lineInsert(
  db: D1Database,
  receiptId: string,
  lineNumber: number,
  l: { orderNumber: string; orderLine: number; movement: Movement; quantity: number; unitCode: string | null; returnReasonId: string | null; note: string | null },
  now: string,
  checkReason: string | null = null
) {
  return db
    .prepare(
      `INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, unit_code, return_reason_id, note, created_at, check_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(crypto.randomUUID(), receiptId, lineNumber, l.orderNumber, l.orderLine, l.movement, l.quantity, l.unitCode, l.returnReasonId, l.note, now, checkReason);
}

/**
 * Recording a receipt or a return on the screen — `POST /goods-receipts`.
 * All or nothing: a line that cannot be recorded refuses the receipt,
 * saying which line and why. Receiving more than is outstanding is
 * saved, with a warning (Dan: refusing it does not stop the goods being
 * in the warehouse).
 */
export async function handleCreateGoodsReceipt(db: D1Database, userId: string, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const receiptNumber = text(body.receiptNumber);
  if (!receiptNumber) return { status: 400, body: { error: "a receipt needs a number", reason: "number_missing" } };
  if (!isDate(body.receiptDate)) return { status: 400, body: { error: "a receipt needs a date (YYYY-MM-DD)", reason: "date_invalid" } };
  const lines = Array.isArray(body.lines) ? (body.lines as LineInput[]) : [];
  if (lines.length === 0) return { status: 400, body: { error: "a receipt needs at least one line", reason: "no_lines" } };
  if (lines.length > 500) return { status: 400, body: { error: "at most 500 lines in one receipt", reason: "too_many_lines" } };

  const exists = await db.prepare("SELECT id FROM goods_receipts WHERE receipt_number = ?").bind(receiptNumber).first();
  if (exists) return { status: 409, body: { error: `receipt ${receiptNumber} already exists`, reason: "receipt_exists" } };

  const checker = new Checker(db, await unitsWherePermitted(db, userId, "AP.Receive"));
  const accepted = [];
  const warnings: OverReceipt[] = [];
  for (let i = 0; i < lines.length; i++) {
    const result = await checker.check(lines[i] ?? {});
    if ("refused" in result) return { status: 422, body: { error: result.refused.message, reason: result.refused.reason, line: i + 1 } };
    checker.commit(result.line.orderNumber, result.line.orderLine, result.line.movement, result.line.quantity);
    accepted.push(result.line);
    if (result.over) warnings.push(result.over);
  }

  const id = crypto.randomUUID();
  const at = now.toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT INTO goods_receipts (id, receipt_number, receipt_date, delivery_note, note, source, created_by, created_at, status, registered_at)
         VALUES (?, ?, ?, ?, ?, 'screen', ?, ?, 'registered', ?)`
      )
      .bind(id, receiptNumber, body.receiptDate as string, text(body.deliveryNote), text(body.note), userId, at, at),
    ...accepted.map((l, i) => lineInsert(db, id, i + 1, l, at)),
  ]);
  // Decision 0648: the orders this touched, for the re-check of receipt-rule tasks.
  const touched = [...new Set(accepted.map((l) => l.orderNumber))].map((orderNumber) => ({ orderNumber, receiptNumber }));
  return { status: 201, body: { id, receiptNumber, status: "registered", lines: accepted.length, warnings, touched } };
}

/**
 * Cancelling a receipt entered by mistake — it stays, marked, with who,
 * when and why. Refused if it would leave a line having returned more
 * than it received: cancel that return first.
 */
export async function handleCancelGoodsReceipt(db: D1Database, userId: string, id: string, body: Record<string, unknown>, now = new Date()): Promise<RouteResult> {
  const receipt = await db
    .prepare("SELECT id, receipt_number, cancelled_at, status FROM goods_receipts WHERE id = ?")
    .bind(id)
    .first<{ id: string; receipt_number: string; cancelled_at: string | null; status: ReceiptStatus }>();
  const notFound = { status: 404, body: { error: "no such receipt", reason: "not_found" } };
  if (!receipt) return notFound;
  const lines = (
    await db
      .prepare("SELECT order_number, order_line_number, movement, quantity FROM goods_receipt_lines WHERE receipt_id = ?")
      .bind(id)
      .all<{ order_number: string; order_line_number: number; movement: Movement; quantity: number }>()
  ).results;
  const scope = await unitsWherePermitted(db, userId, "AP.Receive");
  for (const orderNumber of new Set(lines.map((l) => l.order_number))) {
    const o = await db.prepare("SELECT org_unit_id FROM purchase_orders WHERE order_number = ?").bind(orderNumber).first<{ org_unit_id: string | null }>();
    if (!isWithinScope({ units: scope }, o ? o.org_unit_id : null) && o) return notFound;
  }
  if (receipt.cancelled_at) return { status: 409, body: { error: "that receipt is already cancelled", reason: "already_cancelled" } };
  // 0651: only a registered receipt counts, so only one can be cancelled. A pending one is rejected instead.
  if (receipt.status === "pending") return { status: 409, body: { error: "that receipt is not registered yet: reject it instead", reason: "receipt_pending" } };
  if (receipt.status === "rejected") return { status: 409, body: { error: "that receipt was rejected", reason: "receipt_rejected" } };
  const reason = text(body.reason);
  if (!reason) return { status: 400, body: { error: "say why it is cancelled", reason: "cancel_reason_missing" } };

  for (const l of lines.filter((x) => x.movement === "received")) {
    const held = (await heldByLine(db, l.order_number)).get(l.order_line_number) ?? { received: 0, returned: 0 };
    const removing = lines.filter((x) => x.movement === "received" && x.order_number === l.order_number && x.order_line_number === l.order_line_number).reduce((s, x) => s + x.quantity, 0);
    const returning = lines.filter((x) => x.movement === "returned" && x.order_number === l.order_number && x.order_line_number === l.order_line_number).reduce((s, x) => s + x.quantity, 0);
    if (held.received - removing < held.returned - returning - EPS)
      return {
        status: 409,
        body: { error: `${l.order_number} line ${l.order_line_number} has returns against these goods: cancel the return first`, reason: "returns_depend_on_it", orderNumber: l.order_number, orderLine: l.order_line_number },
      };
  }

  await db
    .prepare("UPDATE goods_receipts SET cancelled_at = ?, cancelled_by = ?, cancel_reason = ? WHERE id = ? AND cancelled_at IS NULL")
    .bind(now.toISOString(), userId, reason, id)
    .run();
  const touched = [...new Set(lines.map((l) => l.order_number))].map((orderNumber) => ({ orderNumber, receiptNumber: receipt.receipt_number }));
  return { status: 200, body: { id, receiptNumber: receipt.receipt_number, cancelled: true, touched } };
}

// ── The CSV ────────────────────────────────────────────────────────────

export interface ReceiptCsvFieldSpec {
  key: string;
  columns: string[];
  required: "yes" | "no" | "for_returns";
  description: string;
}

/** The accepted columns, once: the parser's lookup and `GET /goods-receipts/csv-format` both come from this. */
export const RECEIPT_CSV_FIELDS: ReceiptCsvFieldSpec[] = [
  { key: "receipt_number", columns: ["receipt_number", "receipt number", "gr_number", "gr number", "grn"], required: "yes", description: "The warehouse's own receipt or return number." },
  { key: "receipt_line", columns: ["receipt_line", "receipt line", "gr_line", "gr line"], required: "yes", description: "The line within it, so loading the same file again changes nothing." },
  { key: "receipt_date", columns: ["receipt_date", "receipt date", "date received", "received_date"], required: "yes", description: "When the goods arrived or went back, as YYYY-MM-DD." },
  { key: "order_number", columns: ["order_number", "order number", "po_number", "po number"], required: "yes", description: "The purchase order." },
  { key: "order_line", columns: ["order_line", "order line", "po_line", "po line", "po_line_number"], required: "yes", description: "The purchase order's line number." },
  { key: "quantity", columns: ["quantity", "qty"], required: "yes", description: "How many, always above nought." },
  { key: "movement", columns: ["movement", "type"], required: "no", description: "received (the default) or returned." },
  { key: "return_reason", columns: ["return_reason", "return reason", "reason"], required: "for_returns", description: "A goods return reason, by its id or its words." },
  { key: "unit_code", columns: ["unit_code", "unit code", "unit", "uom"], required: "no", description: "Checked against the order line's unit, if given." },
  { key: "delivery_note", columns: ["delivery_note", "delivery note", "despatch_note", "despatch note"], required: "no", description: "The supplier's despatch or delivery note." },
  { key: "note", columns: ["note", "comment"], required: "no", description: "Free text." },
];

const CSV_COLUMNS: Record<string, string> = Object.fromEntries(RECEIPT_CSV_FIELDS.flatMap((f) => f.columns.map((c) => [c, f.key])));

export async function handleGetGoodsReceiptCsvFormat(): Promise<RouteResult> {
  return { status: 200, body: { fields: RECEIPT_CSV_FIELDS } };
}

/**
 * Loading receipts and returns from a warehouse export — one row per
 * receipt line. **Safe to load twice**: a receipt number and line already
 * loaded is skipped. A row that cannot be loaded is refused with its row
 * number and why; the rest still load. A new line for a receipt already
 * on file is added to it.
 *
 * **Through the Warehouse Receipts process — decision 0651.** With
 * `pending`, a new receipt is stored as pending and its id returned in
 * `pendingIds`, for the caller to send through the process; it counts
 * only once registered. Its orders are then not in `touched`: nothing
 * changed for an invoice yet. A line added to a receipt already on file
 * takes that receipt's status. Without the process set up, receipts
 * register at once, as before.
 */
/** One receipt in a load or its preview — decision 0653. */
export interface LoadedReceipt {
  receiptId: string;
  receiptNumber: string;
  receiptDate: string | null;
  /** On file before this load (lines are added to it). */
  existing: boolean;
  orders: string[];
  lines: number;
  /** Lines kept for Matching, with why (through the process only). */
  attention: { line: number; reason: string }[];
  /** Lines already on file, so skipped. */
  skipped: number;
  /** Rows of this receipt refused. */
  refused: number;
}

export async function handleLoadGoodsReceiptsCsv(
  db: D1Database,
  // 0655: null for a sender's system (Receipts in), which is nobody; then `scope` says what it may reach.
  userId: string | null,
  csv: string,
  now = new Date(),
  // 0653: `dryRun` checks everything as the load would and writes nothing — Create's preview.
  // 0655: `routeMessageId`, the message the receipts came in by; `scope`, in place of the person's units.
  options: { pending?: boolean; dryRun?: boolean; routeMessageId?: string | null; scope?: string[] | null } = {}
): Promise<RouteResult> {
  const rows = parseCsv(csv);
  if (rows.length < 2) return { status: 400, body: { error: "the file needs a header row and at least one line", reason: "empty" } };
  const cols = rows[0].map((h) => CSV_COLUMNS[h.trim().toLowerCase()] ?? null);
  const missing = RECEIPT_CSV_FIELDS.filter((f) => f.required === "yes" && !cols.includes(f.key)).map((f) => f.key);
  if (missing.length > 0) return { status: 400, body: { error: `the file needs these columns: ${missing.join(", ")}`, reason: "columns_missing", missing } };

  const scope = options.scope !== undefined ? options.scope : userId ? await unitsWherePermitted(db, userId, "AP.Receive") : null;
  const checker = new Checker(db, scope);
  const at = now.toISOString();
  const refused: { row: number; receiptNumber: string | null; reason: string; message: string }[] = [];
  const warnings: (OverReceipt & { row: number; receiptNumber: string })[] = [];
  const receipts = new Map<string, { id: string; cancelled: boolean; status: ReceiptStatus; lines: Set<number>; isNew: boolean }>();
  const newStatus: ReceiptStatus = options.pending ? "pending" : "registered";
  const pendingIds: string[] = [];
  let receiptsCreated = 0;
  let linesLoaded = 0;
  let linesSkipped = 0;
  const touched = new Map<string, string>();
  const summary = new Map<string, LoadedReceipt & { orderSet: Set<string> }>();
  const summaryOf = (receiptNumber: string, id: string, existing: boolean, date: string | null) => {
    let s = summary.get(receiptNumber);
    if (!s) {
      s = { receiptId: id, receiptNumber, receiptDate: date, existing, orders: [], orderSet: new Set(), lines: 0, attention: [], skipped: 0, refused: 0 };
      summary.set(receiptNumber, s);
    }
    return s;
  };

  for (let i = 1; i < rows.length; i++) {
    const v: Record<string, string> = {};
    cols.forEach((c, idx) => {
      if (c) v[c] = (rows[i][idx] ?? "").trim();
    });
    if (Object.values(v).every((x) => x === "")) continue;
    const rowNo = i + 1;
    const receiptNumber = v.receipt_number || null;
    const refuse = (reason: string, message: string) => refused.push({ row: rowNo, receiptNumber, reason, message });
    if (!receiptNumber) {
      refuse("number_missing", "no receipt number");
      continue;
    }
    const lineNumber = Number(v.receipt_line);
    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
      refuse("receipt_line_missing", "no receipt line number");
      continue;
    }

    let receipt = receipts.get(receiptNumber);
    if (!receipt) {
      const existing = await db
        .prepare("SELECT id, cancelled_at, status FROM goods_receipts WHERE receipt_number = ?")
        .bind(receiptNumber)
        .first<{ id: string; cancelled_at: string | null; status: ReceiptStatus }>();
      if (existing) {
        const have = (await db.prepare("SELECT line_number FROM goods_receipt_lines WHERE receipt_id = ?").bind(existing.id).all<{ line_number: number }>()).results;
        receipt = { id: existing.id, cancelled: existing.cancelled_at !== null, status: existing.status, lines: new Set(have.map((h) => h.line_number)), isNew: false };
      } else {
        receipt = { id: crypto.randomUUID(), cancelled: false, status: newStatus, lines: new Set(), isNew: true };
      }
      receipts.set(receiptNumber, receipt);
    }
    const sum = summaryOf(receiptNumber, receipt.id, !receipt.isNew, isDate(v.receipt_date) ? v.receipt_date : null);
    if (receipt.lines.has(lineNumber)) {
      linesSkipped++;
      sum.skipped++;
      continue;
    }
    if (receipt.cancelled) {
      refuse("receipt_cancelled", `receipt ${receiptNumber} was cancelled`);
      sum.refused++;
      continue;
    }
    if (receipt.status === "rejected") {
      refuse("receipt_rejected", `receipt ${receiptNumber} was rejected`);
      sum.refused++;
      continue;
    }
    if (receipt.isNew && !isDate(v.receipt_date)) {
      refuse("date_invalid", "the receipt date must be YYYY-MM-DD");
      sum.refused++;
      continue;
    }

    const input = {
      orderNumber: v.order_number,
      orderLine: v.order_line,
      quantity: v.quantity,
      movement: v.movement,
      returnReason: v.return_reason,
      unitCode: v.unit_code,
      note: v.note,
    };
    // 0652: through the process, a line whose order or held quantity is wrong is kept for Matching, not refused.
    const result = receipt.status === "pending" ? await checker.checkLenient(input) : await checker.check(input);
    if ("refused" in result) {
      refuse(result.refused.reason, result.refused.message);
      sum.refused++;
      continue;
    }
    const attention = "attention" in result ? (result as { attention: Refusal | null }).attention : null;

    const statements = [];
    if (receipt.isNew) {
      statements.push(
        db
          .prepare(
            `INSERT INTO goods_receipts (id, receipt_number, receipt_date, delivery_note, note, source, created_by, created_at, status, registered_at, route_message_id)
             VALUES (?, ?, ?, ?, NULL, 'csv', ?, ?, ?, ?, ?)`
          )
          .bind(receipt.id, receiptNumber, v.receipt_date, text(v.delivery_note), userId, at, receipt.status, receipt.status === "registered" ? at : null, options.routeMessageId ?? null)
      );
    }
    statements.push(lineInsert(db, receipt.id, lineNumber, result.line, at, attention?.reason ?? null));
    if (!options.dryRun) await db.batch(statements);
    sum.lines++;
    if (!sum.orderSet.has(result.line.orderNumber)) {
      sum.orderSet.add(result.line.orderNumber);
      sum.orders.push(result.line.orderNumber);
    }
    if (attention) sum.attention.push({ line: lineNumber, reason: attention.reason });
    if (receipt.isNew) {
      receipt.isNew = false;
      receiptsCreated++;
      if (receipt.status === "pending") pendingIds.push(receipt.id);
    }
    receipt.lines.add(lineNumber);
    if (!attention) checker.commit(result.line.orderNumber, result.line.orderLine, result.line.movement, result.line.quantity);
    linesLoaded++;
    if (receipt.status === "registered") touched.set(result.line.orderNumber, receiptNumber);
    if (result.over) warnings.push({ ...result.over, row: rowNo, receiptNumber });
  }

  return {
    status: 200,
    body: {
      receiptsCreated,
      linesLoaded,
      linesSkipped,
      refused,
      warnings,
      pendingIds: options.dryRun ? [] : pendingIds,
      receipts: [...summary.values()].map(({ orderSet: _orders, ...r }) => r),
      ...(options.dryRun ? { dryRun: true } : {}),
      touched: options.dryRun ? [] : [...touched].map(([orderNumber, receiptNumber]) => ({ orderNumber, receiptNumber })),
    },
  };
}

// ── Reading ────────────────────────────────────────────────────────────

const PAGE_SIZES = [25, 50, 100, 200];

/** The orders a receipt names, kept to those the scope allows (a null org is everyone's, as elsewhere). */
function receiptScopeClause(units: string[] | null): { sql: string; binds: unknown[] } {
  const inner = unitClause({ units }, "po.org_unit_id");
  if (!inner.sql) return { sql: "", binds: [] };
  return {
    sql: ` AND EXISTS (
      SELECT 1 FROM goods_receipt_lines sl JOIN purchase_orders po ON po.order_number = sl.order_number
      WHERE sl.receipt_id = r.id ${inner.sql})`,
    binds: inner.binds,
  };
}

/**
 * The register, newest first, searched and paged in the database: by
 * receipt number, order number, delivery note, item or supplier.
 */
export async function handleListGoodsReceipts(
  db: D1Database,
  userId: string,
  params: { org?: string | null; search?: string | null; page?: string | null; pageSize?: string | null; kind?: string | null }
): Promise<RouteResult> {
  const scope = await scopedToChosenOrg(db, await receiptViewScope(db, userId), params.org ?? null);
  const where = receiptScopeClause(scope);
  const binds: unknown[] = [...where.binds];
  let sql = where.sql;
  const term = params.search?.trim();
  if (term) {
    const p = `%${term.replace(/[\\%_]/g, "\\$&")}%`;
    sql += ` AND (r.receipt_number LIKE ? ESCAPE '\\' OR r.delivery_note LIKE ? ESCAPE '\\' OR EXISTS (
      SELECT 1 FROM goods_receipt_lines ql
      LEFT JOIN purchase_orders qpo ON qpo.order_number = ql.order_number
      LEFT JOIN purchase_order_lines qpl ON qpl.purchase_order_id = qpo.id AND qpl.line_number = ql.order_line_number
      LEFT JOIN suppliers qs ON qs.vat_id = qpo.seller_party_id
      WHERE ql.receipt_id = r.id AND (ql.order_number LIKE ? ESCAPE '\\' OR qpl.item_name LIKE ? ESCAPE '\\' OR qs.name LIKE ? ESCAPE '\\')))`;
    binds.push(p, p, p, p, p);
  }
  if (params.kind === "returned" || params.kind === "received") {
    sql += " AND EXISTS (SELECT 1 FROM goods_receipt_lines kl WHERE kl.receipt_id = r.id AND kl.movement = ?)";
    binds.push(params.kind);
  }
  if (params.kind === "cancelled") sql += " AND r.cancelled_at IS NOT NULL";
  // 0651: waiting in the Warehouse Receipts process, or rejected there.
  // 0654: any line waiting for its purchase order.
  if (params.kind === "waiting") sql += " AND EXISTS (SELECT 1 FROM goods_receipt_lines wl WHERE wl.receipt_id = r.id AND wl.waiting_since IS NOT NULL AND wl.line_status = 'active')";
  if (params.kind === "pending" || params.kind === "rejected") {
    sql += " AND r.status = ?";
    binds.push(params.kind);
  }

  const pageSize = PAGE_SIZES.includes(Number(params.pageSize)) ? Number(params.pageSize) : 50;
  const page = Math.max(1, Number.isInteger(Number(params.page)) ? Number(params.page) : 1);
  const total = (await db.prepare(`SELECT count(*) AS n FROM goods_receipts r WHERE 1 = 1 ${sql}`).bind(...binds).first<{ n: number }>())?.n ?? 0;
  const rows = (
    await db
      .prepare(
        `SELECT r.id, r.receipt_number, r.receipt_date, r.delivery_note, r.source, r.created_at, r.cancelled_at, r.cancel_reason,
                r.status, r.reject_reason, u.name AS created_by_name,
                (SELECT count(*) FROM goods_receipt_lines w WHERE w.receipt_id = r.id AND w.waiting_since IS NOT NULL AND w.line_status = 'active') AS waiting_lines,
                (SELECT min(w.waiting_since) FROM goods_receipt_lines w WHERE w.receipt_id = r.id AND w.waiting_since IS NOT NULL AND w.line_status = 'active') AS waiting_since,
                (SELECT count(*) FROM goods_receipt_lines c WHERE c.receipt_id = r.id) AS line_count,
                (SELECT group_concat(DISTINCT movement) FROM goods_receipt_lines m WHERE m.receipt_id = r.id) AS movements,
                (SELECT group_concat(DISTINCT order_number) FROM goods_receipt_lines o WHERE o.receipt_id = r.id) AS orders,
                (SELECT gr.label FROM goods_receipt_lines rl JOIN goods_return_reasons gr ON gr.id = rl.return_reason_id WHERE rl.receipt_id = r.id ORDER BY rl.line_number LIMIT 1) AS first_reason
         FROM goods_receipts r LEFT JOIN org_users u ON u.id = r.created_by
         WHERE 1 = 1 ${sql}
         ORDER BY r.receipt_date DESC, r.created_at DESC, r.rowid DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...binds, pageSize, (page - 1) * pageSize)
      .all<Record<string, unknown>>()
  ).results;

  // Each order's state now, once per order on the page.
  const orderNumbers = [...new Set(rows.flatMap((r) => String(r.orders ?? "").split(",").filter(Boolean)))];
  const states = new Map<string, { state: LineState; creditExpected: boolean; supplier: string | null }>();
  for (const n of orderNumbers) {
    const f = await orderFigures(db, n);
    if (f) states.set(n, { state: f.state, creditExpected: f.creditExpected, supplier: f.supplier?.name ?? null });
  }
  const receipts = rows.map((r) => {
    const orders = String(r.orders ?? "").split(",").filter(Boolean);
    return {
      id: r.id,
      receiptNumber: r.receipt_number,
      receiptDate: r.receipt_date,
      deliveryNote: r.delivery_note,
      source: r.source,
      createdBy: r.created_by_name ?? null,
      cancelled: r.cancelled_at !== null,
      cancelReason: r.cancel_reason ?? null,
      status: r.status,
      rejectReason: r.reject_reason ?? null,
      waitingLines: r.waiting_lines ?? 0,
      waitingSince: r.waiting_since ?? null,
      lineCount: r.line_count,
      movements: String(r.movements ?? "").split(",").filter(Boolean),
      returnReason: r.first_reason ?? null,
      orders: orders.map((n) => ({ orderNumber: n, ...(states.get(n) ?? { state: null, creditExpected: false, supplier: null }) })),
    };
  });
  return { status: 200, body: { receipts, total, page, pageSize } };
}

/**
 * How many orders stand where — the chart. The orders counted are those
 * whose supplier is Receipting required, or that have any receipt; not
 * closed ones. Credit expected is counted among orders with returns.
 */
/**
 * **Each order's receipt state, in SQL — decision 0646.** The same rule
 * as `lineState`/`orderState`, for a list that must filter and page in
 * the database: Purchase Orders' Receipt column and filter, and the
 * chart's counts. A derived table to `LEFT JOIN … rs ON rs.order_number
 * = po.order_number`: only orders that matter for receipting have a
 * row — those whose supplier is Receipting required, or that have any
 * receipt. `tolerancePct` is the organisation's, used where the
 * supplier has none; a number, so written in rather than bound.
 */
export function receiptStateJoin(tolerancePct: number, alias = "rs"): string {
  const tol = Number.isFinite(tolerancePct) ? Number(tolerancePct) : 0;
  const supplier = (col: string) =>
    `(SELECT s.${col} FROM suppliers s WHERE s.vat_id = o.seller_party_id ORDER BY s.status = 'active' DESC, s.name LIMIT 1)`;
  return `LEFT JOIN (
    SELECT x.order_number,
           CASE WHEN MAX(x.st) = 0 THEN 'not_received'
                WHEN MAX(x.st) = 3 THEN 'over_received'
                WHEN MIN(x.st) = 2 THEN 'fully_received'
                ELSE 'partially_received' END AS state
    FROM (
      SELECT o.order_number,
             CASE WHEN n.net IS NULL OR n.net <= 1e-9 THEN 0
                  WHEN l.quantity IS NULL OR l.quantity <= 0 THEN 2
                  WHEN n.net > l.quantity * (1 + COALESCE(${supplier("quantity_tolerance_pct")}, ${tol}) / 100.0) + 1e-9 THEN 3
                  WHEN n.net >= l.quantity * (1 - COALESCE(${supplier("quantity_tolerance_pct")}, ${tol}) / 100.0) - 1e-9 THEN 2
                  ELSE 1 END AS st
      FROM purchase_orders o
      JOIN purchase_order_lines l ON l.purchase_order_id = o.id
      LEFT JOIN (
        SELECT gl.order_number, gl.order_line_number,
               SUM(CASE gl.movement WHEN 'received' THEN gl.quantity ELSE -gl.quantity END) AS net
        FROM goods_receipt_lines gl JOIN goods_receipts gr ON gr.id = gl.receipt_id
        WHERE gr.cancelled_at IS NULL AND gr.status = 'registered' AND gl.line_status = 'active' AND gl.waiting_since IS NULL
        GROUP BY gl.order_number, gl.order_line_number
      ) n ON n.order_number = o.order_number AND n.order_line_number = l.line_number
      WHERE ${supplier("match_option")} = 'three_way'
         OR EXISTS (SELECT 1 FROM goods_receipt_lines e JOIN goods_receipts er ON er.id = e.receipt_id WHERE e.order_number = o.order_number AND er.status = 'registered' AND e.line_status = 'active' AND e.waiting_since IS NULL)
    ) x
    GROUP BY x.order_number
  ) ${alias} ON ${alias}.order_number = po.order_number`;
}

export const RECEIPT_STATES: LineState[] = ["not_received", "partially_received", "fully_received", "over_received"];

/**
 * How many orders stand where — the chart. The orders counted are those
 * whose supplier is Receipting required, or that have any receipt; not
 * closed ones. Credit expected is counted among orders with returns.
 */
export async function handleGoodsReceiptStatusCounts(db: D1Database, userId: string, org: string | null): Promise<RouteResult> {
  const scope = await scopedToChosenOrg(db, await receiptViewScope(db, userId), org);
  const inScope = unitClause({ units: scope }, "po.org_unit_id");
  const config = await getOrgMatchingConfig(db);
  const rows = (
    await db
      .prepare(
        `SELECT po.order_number, rs.state,
                EXISTS (SELECT 1 FROM goods_receipt_lines rl JOIN goods_receipts rr ON rr.id = rl.receipt_id
                        WHERE rr.cancelled_at IS NULL AND rr.status = 'registered' AND rl.line_status = 'active' AND rl.waiting_since IS NULL AND rl.order_number = po.order_number AND rl.movement = 'returned') AS has_returns
         FROM purchase_orders po
         ${receiptStateJoin(config.quantityTolerancePct ?? 0)}
         WHERE po.status <> 'closed' AND rs.state IS NOT NULL ${inScope.sql}`
      )
      .bind(...inScope.binds)
      .all<{ order_number: string; state: LineState; has_returns: number }>()
  ).results;
  const counts: Record<LineState, number> & { credit_expected: number } = { not_received: 0, partially_received: 0, fully_received: 0, over_received: 0, credit_expected: 0 };
  for (const r of rows) {
    counts[r.state]++;
    if (r.has_returns === 1 && (await orderFigures(db, r.order_number))?.creditExpected) counts.credit_expected++;
  }
  return { status: 200, body: { counts } };
}

/**
 * **The open task on a receipt, and who holds it — decision 0657**, so
 * the pop-out offers Claim and Release as the invoice viewer does, and
 * acts only for its holder. Null when nothing is open on it.
 */
async function receiptTaskFor(db: D1Database, userId: string, receiptId: string) {
  const task = await db
    .prepare(
      `SELECT t.id, t.owner_user_id, t.owner_team_id, t.claimed_by, cu.name AS claimed_by_name, t.claimed_at,
              (SELECT 1 FROM org_team_members m WHERE m.team_id = t.owner_team_id AND m.user_id = ?) AS member
       FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id
       JOIN process_instances pi ON pi.id = v.process_instance_id
       LEFT JOIN org_users cu ON cu.id = t.claimed_by
       WHERE pi.subject_type = 'goods_receipt' AND pi.subject_id = ? AND pi.status = 'in_progress' AND t.status = 'open'
       ORDER BY t.created_at LIMIT 1`
    )
    .bind(userId, receiptId)
    .first<{ id: string; owner_user_id: string | null; owner_team_id: string | null; claimed_by: string | null; claimed_by_name: string | null; claimed_at: string | null; member: number | null }>();
  if (!task) return null;
  const mine = task.owner_user_id ? task.owner_user_id === userId : task.claimed_by === userId;
  return {
    id: task.id,
    claimedBy: task.claimed_by_name ?? null,
    claimedAt: task.claimed_at ?? null,
    mine,
    canClaim: !task.owner_user_id && !task.claimed_by && task.member === 1,
    canRelease: !task.owner_user_id && task.claimed_by === userId,
  };
}

/** One receipt, its lines, and where each order it names stands now. 404 outside the person's scope. */
export async function handleGetGoodsReceipt(db: D1Database, userId: string, id: string): Promise<RouteResult> {
  const scope = await receiptViewScope(db, userId);
  const where = receiptScopeClause(scope);
  const receipt = await db
    .prepare(
      `SELECT r.*, u.name AS created_by_name, cu.name AS cancelled_by_name, ru.name AS rejected_by_name
       FROM goods_receipts r LEFT JOIN org_users u ON u.id = r.created_by LEFT JOIN org_users cu ON cu.id = r.cancelled_by
       LEFT JOIN org_users ru ON ru.id = r.rejected_by
       WHERE r.id = ? ${where.sql}`
    )
    .bind(id, ...where.binds)
    .first<Record<string, unknown>>();
  if (!receipt) return { status: 404, body: { error: "no such receipt", reason: "not_found" } };
  const lines = (
    await db
      .prepare(
        `SELECT l.line_number, l.order_number, l.order_line_number, l.movement, l.quantity, l.unit_code, l.note,
                l.return_reason_id, gr.label AS return_reason, l.check_reason, l.line_status, l.reject_reason, l.waiting_since,
                l.original_unit_code, l.original_quantity, l.corrected_at, cu.name AS corrected_by_name
         FROM goods_receipt_lines l LEFT JOIN goods_return_reasons gr ON gr.id = l.return_reason_id
         LEFT JOIN org_users cu ON cu.id = l.corrected_by
         WHERE l.receipt_id = ? ORDER BY l.line_number`
      )
      .bind(id)
      .all<Record<string, unknown>>()
  ).results;
  const orders = [];
  for (const n of [...new Set(lines.map((l) => String(l.order_number)))]) {
    const f = await orderFigures(db, n);
    if (f) orders.push(f);
  }
  return {
    status: 200,
    body: {
      receipt: {
        id: receipt.id,
        receiptNumber: receipt.receipt_number,
        receiptDate: receipt.receipt_date,
        deliveryNote: receipt.delivery_note,
        note: receipt.note,
        source: receipt.source,
        createdBy: receipt.created_by_name ?? null,
        createdAt: receipt.created_at,
        cancelled: receipt.cancelled_at !== null,
        cancelledBy: receipt.cancelled_by_name ?? null,
        cancelledAt: receipt.cancelled_at ?? null,
        cancelReason: receipt.cancel_reason ?? null,
        status: receipt.status,
        registeredAt: receipt.registered_at ?? null,
        rejectedBy: receipt.rejected_by_name ?? null,
        rejectedAt: receipt.rejected_at ?? null,
        rejectReason: receipt.reject_reason ?? null,
      },
      // 0651: where it is in the Warehouse Receipts process, when it went through one.
      process: await db
        .prepare(
          `SELECT pi.id AS instanceId, pi.status, p.name AS processName, st.name AS stageName
           FROM process_instances pi JOIN processes p ON p.id = pi.process_id
           LEFT JOIN process_stages st ON st.id = pi.current_stage_id
           WHERE pi.subject_type = 'goods_receipt' AND pi.subject_id = ?
           ORDER BY pi.created_at DESC LIMIT 1`
        )
        .bind(id)
        .first<{ instanceId: string; status: string; processName: string; stageName: string | null }>(),
      lines: lines.map((l) => ({
        lineNumber: l.line_number,
        orderNumber: l.order_number,
        orderLine: l.order_line_number,
        movement: l.movement,
        quantity: l.quantity,
        unitCode: l.unit_code,
        note: l.note,
        returnReasonId: l.return_reason_id,
        returnReason: l.return_reason,
        // 0652: what Matching found, and a line rejected on its own.
        checkReason: l.check_reason ?? null,
        lineStatus: l.line_status ?? "active",
        rejectReason: l.reject_reason ?? null,
        waitingSince: l.waiting_since ?? null,
        // 0657: what the warehouse sent, where the line was corrected.
        correction: l.corrected_at
          ? { unitCode: l.original_unit_code ?? null, quantity: l.original_quantity, by: l.corrected_by_name ?? null, at: l.corrected_at }
          : null,
      })),
      task: await receiptTaskFor(db, userId, id),
      orders,
    },
  };
}

/**
 * One order's receipt picture: each line's figures, and every receipt
 * and return behind them, oldest first. What the record form starts
 * from, and the PO's receipt view (slice 4). 404 outside the scope.
 */
export async function handleGetOrderReceipts(db: D1Database, userId: string, orderNumber: string): Promise<RouteResult> {
  const figures = await orderFigures(db, orderNumber);
  const scope = await receiptViewScope(db, userId);
  if (!figures || !isWithinScope({ units: scope }, figures.orgUnitId))
    return { status: 404, body: { error: `no purchase order ${orderNumber}`, reason: "not_found" } };
  const movements = (
    await db
      .prepare(
        `SELECT r.id AS receipt_id, r.receipt_number, r.receipt_date, r.source, r.cancelled_at, r.status, u.name AS created_by,
                l.order_line_number, l.movement, l.quantity, gr.label AS return_reason
         FROM goods_receipt_lines l JOIN goods_receipts r ON r.id = l.receipt_id
         LEFT JOIN org_users u ON u.id = r.created_by
         LEFT JOIN goods_return_reasons gr ON gr.id = l.return_reason_id
         WHERE l.order_number = ?
         ORDER BY r.receipt_date, r.created_at, l.line_number`
      )
      .bind(orderNumber)
      .all<Record<string, unknown>>()
  ).results.map((m) => ({
    receiptId: m.receipt_id,
    receiptNumber: m.receipt_number,
    receiptDate: m.receipt_date,
    source: m.source,
    cancelled: m.cancelled_at !== null,
    status: m.status,
    createdBy: m.created_by ?? null,
    orderLine: m.order_line_number,
    movement: m.movement,
    quantity: m.quantity,
    returnReason: m.return_reason ?? null,
  }));
  return { status: 200, body: { order: figures, movements } };
}
