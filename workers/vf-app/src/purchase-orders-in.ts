import type { RouteResult } from "./org-route.js";
import { parseUblOrder, UblOrderParseError, type ParsedOrder, type ParsedOrderLine } from "@vibefinance/shared";
import { handleCreateProcessInstance, visitCurrentStage } from "./workflow-engine.js";
import { admitOrder, orderLineProblem, readOrdersCsv, storeOrder, type ReadEntry, type ReadOrders, type ReceiptWarning } from "./purchase-order-route.js";
import { addRouteEvent, finishRouteMessage, openRouteMessage, routePartKey, storeRoutePart } from "./route-messages.js";
import type { SourceKey } from "./https-in-route.js";

/**
 * **Purchase orders by Source Routes — decision 0749**, slice 1 of the
 * purchase orders proposal (Dan, 12 October 2026: *"a small process /
 * workflow, such as we created with the Warehouse Receipts flow"*, for a
 * customer whose procurement system is outside VibeFinance).
 *
 * Orders arrive by a route into the **Purchase Orders process**, as
 * invoices and goods receipts arrive into theirs:
 *
 * - **Orders in** — the procurement system posts to its source's address
 *   with that source's key: a Peppol BIS Order Only 3 document (UBL
 *   Order), JSON named after its elements, or our order CSV (0370);
 * - **Orders by email** — a mailbox the procurement system sends its
 *   export to, the file attached;
 * - **Orders upload** — Purchase Orders' own load is one message of it,
 *   from the person.
 *
 * **Every message is stored first**, then read into orders, each judged
 * exactly as a load always judged it (its lines, 0081; its company,
 * 0374; its status column, 0377). One that passes is **staged**
 * (`purchase_order_intake`) and sent through the process; reaching the
 * end **releases** it, writing it to `purchase_orders` as a load always
 * did. Until then nothing matches, receipts or shares against it, and a
 * change waiting leaves the order in force untouched.
 *
 * **Until the process is set up, nothing changes**: a load writes orders
 * at once, as before. This supersedes 0081's "an order never enters a
 * process instance" for a customer who sets the process up.
 */

export const PURCHASE_ORDERS_PROCESS_ID = "purchase-orders";
export const ORDERS_IN_ROUTE = "orders-in";
export const ORDERS_EMAIL_ROUTE = "orders-email";
export const ORDERS_FILE_ROUTE = "orders-file";
export const ORDERS_UPLOAD_SOURCE_ID = "upload-purchase-orders";

/** At most this many orders in one message. */
const MAX_ORDERS = 2000;

const STAGES = [
  { id: "purchase-orders-intake", name: "Intake", sequence: 1 },
  { id: "purchase-orders-checking", name: "Checking", sequence: 2 },
  { id: "purchase-orders-complete", name: "Complete", sequence: 3 },
] as const;

export interface OrdersProcess {
  id: string;
  name: string;
  stages: { id: string; name: string }[];
}

/** The process, when it is set up and moves purchase orders; otherwise `null`. */
export async function ordersProcess(db: D1Database): Promise<OrdersProcess | null> {
  const process = await db
    .prepare("SELECT id, name, version FROM processes WHERE id = ? AND subject_type = 'purchase_order'")
    .bind(PURCHASE_ORDERS_PROCESS_ID)
    .first<{ id: string; name: string; version: number }>();
  if (!process) return null;
  const stages = (
    await db
      .prepare(
        `SELECT s.id, s.name FROM process_stage_versions v JOIN process_stages s ON s.id = v.stage_id
         WHERE v.process_id = ? AND v.version = ? ORDER BY v.sequence`
      )
      .bind(process.id, process.version)
      .all<{ id: string; name: string }>()
  ).results;
  return { id: process.id, name: process.name, stages };
}

/** `GET /purchase-orders/process` — whether it is set up, for the screen. */
export async function handleGetOrdersProcess(db: D1Database): Promise<RouteResult> {
  return { status: 200, body: { process: await ordersProcess(db) } };
}

/**
 * `POST /purchase-orders/process` — sets it up: the process, Intake,
 * Checking and Complete in version 1, Intake its entry and Complete its
 * exit, and its upload source. Asking again changes nothing. `name` and
 * `stageNames` in the person's words, as Warehouse Receipts' (0651).
 * Checking has no checks of its own yet (slice 2), so an order passes
 * straight through unless a rule there stops it.
 */
export async function handleSetUpOrdersProcess(db: D1Database, body: Record<string, unknown>): Promise<RouteResult> {
  const existing = await ordersProcess(db);
  if (existing) return { status: 200, body: { process: existing, created: false } };
  const taken = await db.prepare("SELECT subject_type FROM processes WHERE id = ?").bind(PURCHASE_ORDERS_PROCESS_ID).first();
  if (taken) return { status: 409, body: { error: `a process with id ${PURCHASE_ORDERS_PROCESS_ID} already moves something else`, reason: "process_id_taken" } };
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 80) : "Purchase Orders";
  const stageNames = (body.stageNames ?? {}) as Record<string, unknown>;
  const stageName = (s: (typeof STAGES)[number]) => {
    const given = stageNames[s.name.toLowerCase()];
    return typeof given === "string" && given.trim() ? given.trim().slice(0, 60) : s.name;
  };
  const p = PURCHASE_ORDERS_PROCESS_ID;
  await db.batch([
    db.prepare("INSERT INTO processes (id, name, subject_type) VALUES (?, ?, 'purchase_order')").bind(p, name),
    ...STAGES.map((s) =>
      db
        .prepare("INSERT INTO process_stages (id, process_id, name, sequence, rule_set_id, evaluation_scope, required_permission, builtin_check) VALUES (?, ?, ?, ?, NULL, 'header', NULL, NULL)")
        .bind(s.id, p, stageName(s), s.sequence)
    ),
    ...STAGES.map((s) => db.prepare("INSERT INTO process_stage_versions (process_id, version, stage_id, sequence) VALUES (?, 1, ?, ?)").bind(p, s.id, s.sequence)),
    db.prepare("UPDATE processes SET entry_stage_id = ?, exit_stage_id = ? WHERE id = ?").bind(STAGES[0].id, STAGES[2].id, p),
  ]);
  await ensureOrdersUploadSource(db);
  return { status: 201, body: { process: await ordersProcess(db), created: true } };
}

/** The upload source, made with the process when missing. */
export async function ensureOrdersUploadSource(db: D1Database): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO sources (id, process_id, name, mechanism)
         SELECT ?, ?, 'Orders upload', 'file_import'
         WHERE EXISTS (SELECT 1 FROM processes WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM sources WHERE id = ?)`
      )
      .bind(ORDERS_UPLOAD_SOURCE_ID, PURCHASE_ORDERS_PROCESS_ID, PURCHASE_ORDERS_PROCESS_ID, ORDERS_UPLOAD_SOURCE_ID),
    db
      .prepare(
        `INSERT INTO route_instances (id, route_id, process_id, source_id)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sources WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM route_instances WHERE id = ?)`
      )
      .bind(ORDERS_UPLOAD_SOURCE_ID, ORDERS_FILE_ROUTE, PURCHASE_ORDERS_PROCESS_ID, ORDERS_UPLOAD_SOURCE_ID, ORDERS_UPLOAD_SOURCE_ID, ORDERS_UPLOAD_SOURCE_ID),
  ]);
}

/** The process's upload source, when it is set up — Purchase Orders' load goes in by it. */
export async function ordersUploadSource(db: D1Database): Promise<{ id: string; name: string } | null> {
  return db
    .prepare(
      `SELECT s.id, s.name FROM sources s JOIN processes p ON p.id = s.process_id
       WHERE p.subject_type = 'purchase_order' AND s.mechanism = 'file_import' AND s.status = 'active'
       ORDER BY s.id = ? DESC, s.created_at LIMIT 1`
    )
    .bind(ORDERS_UPLOAD_SOURCE_ID)
    .first<{ id: string; name: string }>();
}

// ── Reading ────────────────────────────────────────────────────────────

/** A Peppol BIS Order Only 3 document (UBL Order), as 0081 reads it, held to the line rules. */
export function readOrderXml(xml: string): ReadOrders {
  if (!xml.trim()) return { error: "an order document is required", reason: "empty" };
  let parsed: ParsedOrder;
  try {
    parsed = parseUblOrder(xml);
  } catch (err) {
    if (err instanceof UblOrderParseError) return { error: err.message, reason: "not_an_order" };
    throw err;
  }
  const problem = orderLineProblem(parsed);
  return { entries: [problem ? { refused: { orderNumber: parsed.orderNumber, reason: problem } } : { order: { parsed } }] };
}

const text = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : undefined);
const number = (v: unknown): number | undefined => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
};
const partyId = (v: unknown): string | undefined => (v && typeof v === "object" ? text((v as Record<string, unknown>).id) : text(v));

/**
 * **JSON, named after the Peppol BIS order's own elements**, so a sender
 * who knows the standard knows the shape:
 *
 *     { "orders": [ { "id", "issueDate"?, "orderTypeCode"?, "documentCurrencyCode"?,
 *       "buyerCustomerParty": { "id" }, "sellerSupplierParty": { "id" }?,
 *       "originatorDocumentReference"?, "anticipatedMonetaryTotal"?: {
 *         "lineExtensionAmount", "taxExclusiveAmount", "taxInclusiveAmount", "payableAmount" },
 *       "status"?, "holdReason"?,
 *       "orderLines": [ { "id", "quantity"?, "unitCode"?, "lineExtensionAmount"?,
 *         "price"?: { "priceAmount", "baseQuantity"? },
 *         "item": { "name"?, "description"?, "sellersItemId"?, "standardItemId"? } } ] } ] }
 *
 * A line's `id` defaults to its place in the list. Each order is then
 * held to the same rules as any other.
 */
export function readOrdersJson(body: unknown): ReadOrders {
  const orders = (body as { orders?: unknown })?.orders;
  if (!Array.isArray(orders) || orders.length === 0) return { error: "the body needs an orders list", reason: "not_orders" };
  if (orders.length > MAX_ORDERS) return { error: `at most ${MAX_ORDERS} orders in one message`, reason: "too_many" };
  const entries: ReadEntry[] = [];
  for (const o of orders as Record<string, unknown>[]) {
    const orderNumber = text(o?.id) ?? text(o?.orderNumber);
    if (!orderNumber) {
      entries.push({ refused: { orderNumber: "", reason: "an order has no id" } });
      continue;
    }
    const rawLines = Array.isArray(o.orderLines) ? o.orderLines : Array.isArray(o.lines) ? o.lines : [];
    if (rawLines.length === 0) {
      entries.push({ refused: { orderNumber, reason: "the order has no lines" } });
      continue;
    }
    const totals = (o.anticipatedMonetaryTotal ?? {}) as Record<string, unknown>;
    const lines: ParsedOrderLine[] = (rawLines as Record<string, unknown>[]).map((l, i) => {
      const item = (l?.item ?? {}) as Record<string, unknown>;
      const price = (l?.price ?? {}) as Record<string, unknown>;
      return {
        lineNumber: number(l?.id) ?? i + 1,
        quantity: number(l?.quantity),
        unitCode: text(l?.unitCode),
        lineExtensionAmount: number(l?.lineExtensionAmount),
        itemName: text(item.name),
        itemDescription: text(item.description),
        sellersItemId: text(item.sellersItemId),
        standardItemId: text(item.standardItemId),
        priceAmount: number(price.priceAmount),
        baseQuantity: number(price.baseQuantity),
      };
    });
    const parsed: ParsedOrder = {
      orderNumber,
      issueDate: text(o.issueDate),
      orderTypeCode: text(o.orderTypeCode),
      currency: text(o.documentCurrencyCode) ?? text(o.currency),
      sellerPartyId: partyId(o.sellerSupplierParty),
      buyerPartyId: partyId(o.buyerCustomerParty),
      lineExtensionAmount: number(totals.lineExtensionAmount),
      taxExclusiveAmount: number(totals.taxExclusiveAmount),
      taxInclusiveAmount: number(totals.taxInclusiveAmount),
      payableAmount: number(totals.payableAmount),
      originatorReference: text(o.originatorDocumentReference),
      lines,
    };
    const problem = orderLineProblem(parsed);
    entries.push(problem ? { refused: { orderNumber, reason: problem } } : { order: { parsed, status: text(o.status), holdReason: text(o.holdReason) } });
  }
  return { entries };
}

/** Which reader a file is for: XML (a UBL Order) by its first element, JSON, else our CSV. */
export function readOrdersFile(body: string, hint: "xml" | "json" | "csv" | null = null): ReadOrders {
  const kind = hint ?? (body.trimStart().startsWith("<") ? "xml" : body.trimStart().startsWith("{") ? "json" : "csv");
  if (kind === "xml") return readOrderXml(body);
  if (kind === "json") {
    let json: unknown;
    try {
      json = JSON.parse(body);
    } catch {
      return { error: "the body is not JSON", reason: "not_json" };
    }
    return readOrdersJson(json);
  }
  const read = readOrdersCsv(body);
  if (!("error" in read) && read.entries.length > MAX_ORDERS) return { error: `at most ${MAX_ORDERS} orders in one message`, reason: "too_many" };
  return read;
}

// ── Staging, the process, releasing ───────────────────────────────────

export type IntakeStatus = "pending" | "released" | "rejected";

export interface SentOrder {
  intakeId: string;
  orderNumber: string;
  status: IntakeStatus;
  /** The stage it waits at, while pending. */
  stage: string | null;
  change: boolean;
}

export interface ReleasedOrder {
  orderNumber: string;
  replaced: boolean;
  lines: number;
  receiptWarnings: ReceiptWarning[];
}

/**
 * **Admitted orders, staged** — each held to its company and status
 * column, then kept as read until the process releases it.
 */
async function stageOrders(
  db: D1Database,
  entries: ReadEntry[],
  params: { routeMessageId: string | null; userId: string | null },
  now: Date
): Promise<{ intakeIds: string[]; refused: { orderNumber: string; reason: string }[] }> {
  const intakeIds: string[] = [];
  const refused: { orderNumber: string; reason: string }[] = [];
  for (const entry of entries) {
    if ("refused" in entry) {
      refused.push(entry.refused);
      continue;
    }
    const admitted = await admitOrder(db, entry.order);
    if ("refusalReason" in admitted) {
      refused.push({ orderNumber: entry.order.parsed.orderNumber, reason: admitted.refusalReason });
      continue;
    }
    const id = crypto.randomUUID();
    const inForce = await db.prepare("SELECT 1 FROM purchase_orders WHERE order_number = ?").bind(entry.order.parsed.orderNumber).first();
    await db
      .prepare(
        `INSERT INTO purchase_order_intake (id, order_number, order_json, status_json, org_unit_id, route_message_id, is_change, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        entry.order.parsed.orderNumber,
        JSON.stringify(entry.order.parsed),
        admitted.statusOverride ? JSON.stringify(admitted.statusOverride) : null,
        admitted.orgUnitId,
        params.routeMessageId,
        inForce ? 1 : 0,
        params.userId,
        now.toISOString()
      )
      .run();
    intakeIds.push(id);
  }
  return { intakeIds, refused };
}

interface IntakeRow {
  id: string;
  order_number: string;
  order_json: string;
  status_json: string | null;
  org_unit_id: string;
  status: IntakeStatus;
  is_change: number;
}

/**
 * **Releasing** — the process has completed. Only a pending order moves:
 * it is written as a load always wrote it, replacing the order of its
 * number (0081), and the intake names the order it became.
 */
export async function releaseOrder(db: D1Database, intakeId: string, now = new Date()): Promise<ReleasedOrder | null> {
  const row = await db.prepare("SELECT * FROM purchase_order_intake WHERE id = ? AND status = 'pending'").bind(intakeId).first<IntakeRow>();
  if (!row) return null;
  const parsed = JSON.parse(row.order_json) as ParsedOrder;
  const statusOverride = row.status_json ? (JSON.parse(row.status_json) as { status: "active" | "on_hold" | "closed"; holdReason: string | null }) : undefined;
  const stored = await storeOrder(db, parsed, row.org_unit_id, statusOverride);
  await db
    .prepare("UPDATE purchase_order_intake SET status = 'released', released_at = ?, purchase_order_id = ? WHERE id = ? AND status = 'pending'")
    .bind(now.toISOString(), stored.id, intakeId)
    .run();
  return { orderNumber: stored.orderNumber, replaced: stored.replaced, lines: stored.lines, receiptWarnings: stored.receiptWarnings };
}

function orderFacts(row: IntakeRow): Record<string, unknown> {
  const parsed = JSON.parse(row.order_json) as ParsedOrder;
  return {
    id: row.id,
    order_number: row.order_number,
    org_unit_id: row.org_unit_id,
    issue_date: parsed.issueDate ?? null,
    currency: parsed.currency ?? null,
    seller_party_id: parsed.sellerPartyId ?? null,
    payable_amount: parsed.payableAmount ?? null,
    lines: parsed.lines.length,
    change: row.is_change === 1,
  };
}

/**
 * **Where an order's instance has got to**, after any visit: completed
 * means released. Called after sending, and (slice 2) after a task on it.
 */
export async function settleOrderInstance(db: D1Database, instanceId: string, now = new Date()): Promise<{ status: IntakeStatus; stage: string | null; released: ReleasedOrder | null }> {
  const row = await db
    .prepare(
      `SELECT pi.subject_id, pi.status, st.name AS stage, i.status AS intake_status
       FROM process_instances pi LEFT JOIN process_stages st ON st.id = pi.current_stage_id
       JOIN purchase_order_intake i ON i.id = pi.subject_id
       WHERE pi.id = ? AND pi.subject_type = 'purchase_order'`
    )
    .bind(instanceId)
    .first<{ subject_id: string; status: string; stage: string | null; intake_status: IntakeStatus }>();
  if (!row) return { status: "pending", stage: null, released: null };
  if (row.status === "completed" && row.intake_status === "pending") {
    const released = await releaseOrder(db, row.subject_id, now);
    return { status: "released", stage: null, released };
  }
  return { status: row.intake_status, stage: row.status === "in_progress" ? row.stage : null, released: null };
}

/**
 * **Staged orders through the process.** Each gets its own instance and
 * visits Intake, then on; one that reaches the end is released there and
 * then, one stopped on the way stays pending at that stage.
 */
export async function sendOrdersThroughProcess(db: D1Database, intakeIds: string[], now = new Date()): Promise<{ sent: SentOrder[]; released: ReleasedOrder[] }> {
  const sent: SentOrder[] = [];
  const released: ReleasedOrder[] = [];
  const process = await ordersProcess(db);
  for (const intakeId of intakeIds) {
    const row = await db.prepare("SELECT * FROM purchase_order_intake WHERE id = ?").bind(intakeId).first<IntakeRow>();
    if (!row) continue;
    const pending: SentOrder = { intakeId, orderNumber: row.order_number, status: "pending", stage: null, change: row.is_change === 1 };
    if (!process) {
      sent.push(pending);
      continue;
    }
    const created = await handleCreateProcessInstance(db, process.id, { subjectType: "purchase_order", subjectId: intakeId });
    if (created.status >= 400) {
      sent.push(pending);
      continue;
    }
    const instanceId = (created.body as { id: string }).id;
    const visit = await visitCurrentStage(db, instanceId, orderFacts(row));
    const outcome = await settleOrderInstance(db, instanceId, now);
    if (outcome.released) released.push(outcome.released);
    sent.push({ ...pending, status: outcome.status, stage: visit.status >= 400 ? null : outcome.stage });
  }
  return { sent, released };
}

// ── Receiving ──────────────────────────────────────────────────────────

export interface ReceivedOrders {
  messageId: string;
  status: "delivered" | "partial" | "failed";
  sent: SentOrder[];
  released: ReleasedOrder[];
  refused: { orderNumber: string; reason: string }[];
  process: { id: string; name: string } | null;
}

/**
 * **What was read, through the process, and the message finished** — the
 * part every route shares once its message is open and stored. A file
 * that could not be read at all fails the message at its format; one
 * whose every order was refused fails it at translation; one with some
 * refused is partial.
 */
export async function ordersIntoProcess(
  db: D1Database,
  messageId: string,
  reads: ReadOrders[],
  userId: string | null,
  now = new Date()
): Promise<ReceivedOrders> {
  const process = await ordersProcess(db);
  const processRef = process ? { id: process.id, name: process.name } : null;
  const unreadable = reads.filter((r): r is { error: string; reason: string } => "error" in r);
  const entries = reads.flatMap((r) => ("entries" in r ? r.entries : []));
  if (entries.length === 0) {
    const first = unreadable[0];
    await finishRouteMessage(db, messageId, { status: "failed", failedPart: "format", errorCode: first?.reason ?? "no_orders", errorText: first?.error ?? "no orders were found" });
    return { messageId, status: "failed", sent: [], released: [], refused: [], process: processRef };
  }
  const staged = await stageOrders(db, entries, { routeMessageId: messageId, userId }, now);
  const through = await sendOrdersThroughProcess(db, staged.intakeIds, now);
  const refused = [...staged.refused, ...unreadable.map((u) => ({ orderNumber: "", reason: u.error }))];
  const status: ReceivedOrders["status"] = staged.intakeIds.length === 0 ? "failed" : refused.length > 0 ? "partial" : "delivered";
  if (status === "failed") {
    await finishRouteMessage(db, messageId, { status: "failed", failedPart: "translation", errorCode: "refused", errorText: refused.map((r) => (r.orderNumber ? `${r.orderNumber}: ${r.reason}` : r.reason)).join(" · ").slice(0, 1000) || "every order was refused" });
  } else {
    await finishRouteMessage(db, messageId, { status });
  }
  return { messageId, status, sent: through.sent, released: through.released, refused, process: processRef };
}

/**
 * **One message of orders, received** — HTTPS and upload. Opens the
 * message, stores what was sent as part 1, reads it, and sends it
 * through (`ordersIntoProcess`).
 */
export async function receiveOrders(
  db: D1Database,
  params: {
    sourceId: string;
    sourceName: string;
    routeId: string;
    counterparty: string;
    subject: string;
    filename: string;
    contentType: string;
    body: string;
    read: ReadOrders;
    userId: string | null;
    event: string;
    eventDetail?: string;
    bucket?: R2Bucket | null;
    customerId?: string | null;
  },
  now = new Date()
): Promise<ReceivedOrders | { error: string }> {
  const receivedAt = now.toISOString();
  const bytes = new TextEncoder().encode(params.body);
  const messageId = await openRouteMessage(db, {
    instanceId: params.sourceId,
    direction: "in",
    counterparty: params.counterparty,
    recipient: params.sourceName,
    subject: params.subject.slice(0, 300),
    bytes: bytes.length,
    receivedAt,
  });
  if (!messageId) return { error: "the message could not be recorded; send it again" };
  await db.prepare("UPDATE route_messages SET route_id = ?, route_version = 1 WHERE id = ?").bind(params.routeId, messageId).run();
  await addRouteEvent(db, messageId, params.event, params.eventDetail ? { detail: params.eventDetail } : {});
  if (params.bucket && params.customerId) {
    const part = await storeRoutePart(params.bucket, db, {
      messageId,
      seq: 1,
      role: "attachment",
      filename: params.filename,
      contentType: params.contentType,
      bytes,
      key: routePartKey(params.customerId, params.sourceId, messageId, receivedAt, 1, params.filename),
    });
    if ("reason" in part) await addRouteEvent(db, messageId, "attachment_not_stored", { partSeq: 1, detail: part.reason });
  }
  return ordersIntoProcess(db, messageId, [params.read], params.userId, now);
}

/** What one message of orders made, as the sender is told it: now, and when they ask again. */
export async function ordersReport(db: D1Database, messageId: string, checkUrl: string) {
  const m = await db
    .prepare("SELECT id, status, error_text, received_at, completed_at, subject FROM route_messages WHERE id = ?")
    .bind(messageId)
    .first<{ id: string; status: string; error_text: string | null; received_at: string; completed_at: string | null; subject: string | null }>();
  const orders = (
    await db
      .prepare(
        `SELECT i.order_number, i.status, i.is_change,
                (SELECT st.name FROM process_instances pi JOIN process_stages st ON st.id = pi.current_stage_id
                 WHERE pi.subject_type = 'purchase_order' AND pi.subject_id = i.id AND pi.status = 'in_progress' LIMIT 1) AS stage
         FROM purchase_order_intake i WHERE i.route_message_id = ? ORDER BY i.created_at, i.rowid`
      )
      .bind(messageId)
      .all<{ order_number: string; status: IntakeStatus; is_change: number; stage: string | null }>()
  ).results;
  return {
    message: m?.id ?? messageId,
    status: m?.status ?? "received",
    reference: m?.subject ?? null,
    receivedAt: m?.received_at ?? null,
    completedAt: m?.completed_at ?? null,
    ...(m?.error_text ? { error: m.error_text } : {}),
    orders: orders.map((o) => ({ orderNumber: o.order_number, status: o.status, change: o.is_change === 1, ...(o.stage ? { stage: o.stage } : {}) })),
    check: checkUrl,
  };
}

/** A source on the Purchase Orders process, by its mechanism. */
export async function ordersSource(db: D1Database, sourceId: string, mechanism: "https" | "email" | null = "https") {
  return db
    .prepare(
      `SELECT s.id, s.name, s.status FROM sources s JOIN processes p ON p.id = s.process_id
       WHERE s.id = ? AND p.subject_type = 'purchase_order' ${mechanism ? "AND s.mechanism = ?" : ""}`
    )
    .bind(...[sourceId, ...(mechanism ? [mechanism] : [])])
    .first<{ id: string; name: string; status: string }>();
}

/**
 * `POST /v1/sources/:id/orders` — a procurement system's orders, with
 * the source's key: `application/xml` (a Peppol BIS Order Only 3
 * document), `application/json` (`readOrdersJson`) or `text/csv` (our
 * columns, `GET /purchase-orders/csv-format`). `X-Reference` names the
 * message. Answers 202 with what each order became (released, or waiting
 * at a stage), and a `check` address to ask again; 422 when nothing could
 * be taken. A body that is not one of these is refused before anything is
 * stored.
 */
export async function handleHttpsOrders(
  db: D1Database,
  key: SourceKey,
  request: Request,
  origin: string,
  deps: { bucket?: R2Bucket | null; customerId?: string | null }
): Promise<RouteResult & { released?: ReleasedOrder[] }> {
  const source = await ordersSource(db, key.source_id);
  if (!source) return { status: 404, body: { error: "this source does not receive purchase orders" } };
  if (source.status !== "active") return { status: 410, body: { error: `${source.name} is retired and no longer receives orders` } };
  const type = (request.headers.get("Content-Type") ?? "").toLowerCase();
  const hint = type.includes("xml") ? "xml" : type.startsWith("application/json") ? "json" : type.startsWith("text/csv") || type.startsWith("text/plain") ? "csv" : null;
  if (!hint) return { status: 415, body: { error: "send application/xml (a Peppol BIS order), application/json or text/csv", reason: "type" } };
  const body = await request.text();
  if (!body.trim()) return { status: 400, body: { error: "the body is empty", reason: "empty" } };
  const read = readOrdersFile(body, hint);
  if ("error" in read && (read.reason === "not_json" || read.reason === "not_orders" || read.reason === "too_many")) {
    return { status: 400, body: { error: read.error, reason: read.reason } };
  }
  const reference = request.headers.get("X-Reference");
  const filename = hint === "xml" ? "order.xml" : hint === "json" ? "orders.json" : "orders.csv";
  const contentType = hint === "xml" ? "application/xml" : hint === "json" ? "application/json" : "text/csv";
  const received = await receiveOrders(db, {
    sourceId: source.id,
    sourceName: source.name,
    routeId: ORDERS_IN_ROUTE,
    counterparty: key.name,
    subject: reference ?? "Purchase orders",
    filename,
    contentType,
    body,
    read,
    userId: null,
    event: "https_received",
    eventDetail: `key ${key.key_prefix}… (${key.name})`,
    bucket: deps.bucket,
    customerId: deps.customerId,
  });
  if ("error" in received) return { status: 500, body: { error: received.error } };
  const check = `${origin}/v1/sources/${encodeURIComponent(source.id)}/messages/${encodeURIComponent(received.messageId)}`;
  const report = await ordersReport(db, received.messageId, check);
  return {
    status: received.status === "failed" ? 422 : 202,
    body: { ...report, ...(received.refused.length ? { refused: received.refused } : {}) },
    released: received.released,
  };
}

/**
 * **Orders by email** — an email source on the Purchase Orders process.
 * Its message is already open and its attachments stored (inbound-email);
 * each XML, JSON or CSV attachment is read as orders and sent through.
 * Anything else attached is passed over, and said so.
 */
export async function emailOrders(
  db: D1Database,
  messageId: string,
  attachments: { filename: string; contentType: string; bytes: Uint8Array }[],
  now = new Date()
): Promise<ReceivedOrders> {
  await db.prepare("UPDATE route_messages SET route_id = ?, route_version = 1 WHERE id = ?").bind(ORDERS_EMAIL_ROUTE, messageId).run();
  const reads: ReadOrders[] = [];
  for (const [index, a] of attachments.entries()) {
    const name = a.filename.toLowerCase();
    const type = a.contentType.toLowerCase();
    const hint = type.includes("xml") || name.endsWith(".xml") ? "xml" : type.includes("json") || name.endsWith(".json") ? "json" : type.includes("csv") || name.endsWith(".csv") ? "csv" : null;
    if (!hint) {
      await addRouteEvent(db, messageId, "attachment_passed_over", { partSeq: index + 1, detail: `${a.filename}: not an order file (XML, JSON or CSV)` });
      continue;
    }
    reads.push(readOrdersFile(new TextDecoder().decode(a.bytes), hint));
  }
  if (reads.length === 0) reads.push({ error: "no order file (XML, JSON or CSV) was attached", reason: "no_order_file" });
  return ordersIntoProcess(db, messageId, reads, null, now);
}

/**
 * **Purchase Orders' own load, as one message of Orders upload** — once
 * the process is set up. From the person, the file stored first; the
 * answer keeps the load's own shape (0370) so the screen reads it as
 * before, with what the process did: released, or waiting at a stage.
 * 400 when the file could not be read as orders at all, as before.
 */
export async function uploadOrders(
  db: D1Database,
  source: { id: string; name: string },
  person: { id: string; name?: string | null; email?: string | null },
  body: string,
  filename: string,
  hint: "xml" | "csv",
  deps: { bucket?: R2Bucket | null; customerId?: string | null }
): Promise<RouteResult & { released: ReleasedOrder[] }> {
  const read = readOrdersFile(body, hint);
  const received = await receiveOrders(db, {
    sourceId: source.id,
    sourceName: source.name,
    routeId: ORDERS_FILE_ROUTE,
    counterparty: person.email ? `${person.name ?? person.email} <${person.email}>` : (person.name ?? person.id),
    subject: `Upload of ${filename}`,
    filename,
    contentType: hint === "xml" ? "application/xml" : "text/csv",
    body,
    read,
    userId: person.id,
    event: "upload_opened",
    bucket: deps.bucket,
    customerId: deps.customerId,
  });
  if ("error" in received) return { status: 500, body: { error: received.error }, released: [] };
  if ("error" in read) {
    return { status: hint === "xml" ? 422 : 400, body: { error: read.error, ...(read.reason !== "no_rows" ? { reason: read.reason } : {}), messageId: received.messageId }, released: [] };
  }
  const waiting = received.sent.filter((s) => s.status === "pending");
  return {
    status: 200,
    body: {
      loadId: received.messageId,
      messageId: received.messageId,
      ordersLoaded: received.released.length,
      orderNumbers: received.released.map((r) => r.orderNumber),
      ordersReplaced: received.released.filter((r) => r.replaced).length,
      linesLoaded: received.released.reduce((n, r) => n + r.lines, 0),
      refused: received.refused,
      receiptWarnings: received.released.flatMap((r) => r.receiptWarnings),
      process: received.process ? { ...received.process, sent: received.sent, waiting: waiting.length } : null,
    },
    released: received.released,
  };
}
