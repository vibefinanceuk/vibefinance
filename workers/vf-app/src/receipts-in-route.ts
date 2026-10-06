import type { RouteResult } from "./org-route.js";
import { handleLoadGoodsReceiptsCsv, type LoadedReceipt } from "./goods-receipts.js";
import { sendReceiptsThroughProcess, warehouseProcess, WAREHOUSE_RECEIPTS_PROCESS_ID, type SentReceipt, type Touched } from "./warehouse-receipts.js";
import { addRouteEvent, finishRouteMessage, openRouteMessage, routePartKey, storeRoutePart } from "./route-messages.js";
import type { SourceKey } from "./https-in-route.js";

/**
 * **Receipts in — decision 0655**, slice 5 of the Warehouse Receipts
 * proposal (Goods Receipts level 3, agreed with Dan 6 October 2026).
 *
 * Receipts arrive by a route into the Warehouse Receipts process, as
 * invoices arrive by Sources into theirs:
 *
 * - **Receipts in** — a warehouse system posts to its source's address
 *   with that source's key (as HTTPS in, 0578): JSON, or our receipt
 *   CSV (0644's columns);
 * - **Receipts upload** — Create's receipt CSV (0653) is one message of
 *   it, from the person.
 *
 * **Every message is stored first** (`route_messages`, its body as part
 * 1), then read into receipts, each sent through the process. The
 * message ends delivered, partial (some rows refused) or failed, and
 * the Route monitor shows what it made. Each receipt names its message
 * (`goods_receipts.route_message_id`).
 */

export const RECEIPTS_IN_ROUTE = "receipts-in";
export const RECEIPTS_FILE_ROUTE = "receipts-file";
export const RECEIPTS_UPLOAD_SOURCE_ID = "upload-warehouse-receipts";

/** At most this many receipt lines in one message, as a CSV load allows in practice. */
const MAX_LINES = 5000;

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const COLUMNS = ["receipt_number", "receipt_line", "receipt_date", "order_number", "order_line", "quantity", "movement", "return_reason", "unit_code", "delivery_note", "note"];

/**
 * **JSON into our CSV** — what every Receipts in message is read into
 * before it is checked, so JSON and CSV are judged exactly alike:
 *
 *     { "receipts": [ { "receiptNumber", "receiptDate", "deliveryNote"?,
 *       "lines": [ { "line"?, "orderNumber", "orderLine", "quantity",
 *                    "unit"?, "movement"?, "reason"?, "note"? } ] } ] }
 *
 * `line` defaults to the line's place in the list. What is missing or
 * wrong is left for the load to refuse, row by row.
 */
export function receiptsJsonToCsv(body: unknown): { csv: string; lines: number } | { error: string } {
  const receipts = (body as { receipts?: unknown })?.receipts;
  if (!Array.isArray(receipts) || receipts.length === 0) return { error: "the body needs a receipts list" };
  const rows = [COLUMNS.join(",")];
  for (const r of receipts as Record<string, unknown>[]) {
    const lines = Array.isArray(r?.lines) ? (r.lines as Record<string, unknown>[]) : [];
    if (lines.length === 0) return { error: `receipt ${String(r?.receiptNumber ?? "?")} has no lines` };
    lines.forEach((l, i) => {
      rows.push(
        [r.receiptNumber, l.line ?? i + 1, r.receiptDate, l.orderNumber, l.orderLine, l.quantity, l.movement, l.reason ?? l.returnReason, l.unit ?? l.unitCode, r.deliveryNote, l.note]
          .map(csvCell)
          .join(",")
      );
    });
  }
  if (rows.length - 1 > MAX_LINES) return { error: `at most ${MAX_LINES} receipt lines in one message` };
  return { csv: rows.join("\n"), lines: rows.length - 1 };
}

export interface ReceivedReceipts {
  messageId: string;
  status: "delivered" | "partial" | "failed";
  /** The load's answer: receipts, refused rows, warnings (0653). */
  load: Record<string, unknown> & { receipts?: LoadedReceipt[]; refused?: unknown[] };
  sent: SentReceipt[];
  /** Orders whose goods now count, for the re-check of invoices (0648). */
  touched: Touched[];
  process: { id: string; name: string } | null;
}

/**
 * **One message of receipts, received** — the path both routes share.
 * Opens the message, stores the CSV, loads it (pending through the
 * process when it is set up), sends each new receipt through, and
 * finishes the message by what happened. A load refused outright (no
 * header, columns missing) fails the message at its format.
 */
export async function receiveReceipts(
  db: D1Database,
  params: {
    sourceId: string;
    sourceName: string;
    routeId: string;
    counterparty: string;
    subject: string;
    filename: string;
    csv: string;
    userId: string | null;
    scope?: string[] | null;
    event: string;
    eventDetail?: string;
    bucket?: R2Bucket | null;
    customerId?: string | null;
  },
  now = new Date()
): Promise<ReceivedReceipts | { error: string }> {
  const receivedAt = now.toISOString();
  const bytes = new TextEncoder().encode(params.csv);
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
      contentType: "text/csv",
      bytes,
      key: routePartKey(params.customerId, params.sourceId, messageId, receivedAt, 1, params.filename),
    });
    if ("reason" in part) await addRouteEvent(db, messageId, "attachment_not_stored", { partSeq: 1, detail: part.reason });
  }

  const process = await warehouseProcess(db);
  const loaded = await handleLoadGoodsReceiptsCsv(db, params.userId, params.csv, now, {
    pending: process !== null,
    routeMessageId: messageId,
    ...(params.scope !== undefined ? { scope: params.scope } : {}),
  });
  const body = loaded.body as ReceivedReceipts["load"] & { error?: string; pendingIds?: string[]; touched?: Touched[]; linesLoaded?: number };
  if (loaded.status >= 300) {
    await finishRouteMessage(db, messageId, { status: "failed", failedPart: "format", errorCode: String((loaded.body as { reason?: string }).reason ?? "unreadable"), errorText: body.error ?? "not a receipt file" });
    return { messageId, status: "failed", load: body, sent: [], touched: [], process: process ? { id: process.id, name: process.name } : null };
  }
  const through = process ? await sendReceiptsThroughProcess(db, body.pendingIds ?? [], now) : { sent: [], touched: [] };
  const refused = body.refused?.length ?? 0;
  const status: ReceivedReceipts["status"] = (body.linesLoaded ?? 0) === 0 && refused > 0 ? "failed" : refused > 0 ? "partial" : "delivered";
  if (status === "failed") {
    await finishRouteMessage(db, messageId, { status: "failed", failedPart: "translation", errorCode: "refused", errorText: "every row was refused" });
  } else {
    await finishRouteMessage(db, messageId, { status });
  }
  return {
    messageId,
    status,
    load: body,
    sent: through.sent,
    touched: [...(body.touched ?? []), ...through.touched],
    process: process ? { id: process.id, name: process.name } : null,
  };
}

/** The Warehouse Receipts process's upload source, when it is set up — Create's CSV goes in by it. */
export async function receiptsUploadSource(db: D1Database): Promise<{ id: string; name: string } | null> {
  return db
    .prepare(
      `SELECT s.id, s.name FROM sources s JOIN processes p ON p.id = s.process_id
       WHERE p.subject_type = 'goods_receipt' AND s.mechanism = 'file_import' AND s.status = 'active'
       ORDER BY s.id = ? DESC, s.created_at LIMIT 1`
    )
    .bind(RECEIPTS_UPLOAD_SOURCE_ID)
    .first<{ id: string; name: string }>();
}

/** The upload source, made with the process (0651's set-up) when missing. */
export async function ensureReceiptsUploadSource(db: D1Database): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO sources (id, process_id, name, mechanism)
         SELECT ?, ?, 'Receipts upload', 'file_import'
         WHERE EXISTS (SELECT 1 FROM processes WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM sources WHERE id = ?)`
      )
      .bind(RECEIPTS_UPLOAD_SOURCE_ID, WAREHOUSE_RECEIPTS_PROCESS_ID, WAREHOUSE_RECEIPTS_PROCESS_ID, RECEIPTS_UPLOAD_SOURCE_ID),
    db
      .prepare(
        `INSERT INTO route_instances (id, route_id, process_id, source_id)
         SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sources WHERE id = ?) AND NOT EXISTS (SELECT 1 FROM route_instances WHERE id = ?)`
      )
      .bind(RECEIPTS_UPLOAD_SOURCE_ID, RECEIPTS_FILE_ROUTE, WAREHOUSE_RECEIPTS_PROCESS_ID, RECEIPTS_UPLOAD_SOURCE_ID, RECEIPTS_UPLOAD_SOURCE_ID, RECEIPTS_UPLOAD_SOURCE_ID),
  ]);
}

/** What one message of receipts made, as the sender is told it: now, and when they ask again. */
export async function receiptsReport(db: D1Database, messageId: string, checkUrl: string) {
  const m = await db
    .prepare("SELECT id, status, error_text, received_at, completed_at, subject FROM route_messages WHERE id = ?")
    .bind(messageId)
    .first<{ id: string; status: string; error_text: string | null; received_at: string; completed_at: string | null; subject: string | null }>();
  const receipts = (
    await db
      .prepare(
        `SELECT r.receipt_number, r.status,
                (SELECT st.name FROM process_instances pi JOIN process_stages st ON st.id = pi.current_stage_id
                 WHERE pi.subject_type = 'goods_receipt' AND pi.subject_id = r.id AND pi.status = 'in_progress' LIMIT 1) AS stage,
                (SELECT count(*) FROM goods_receipt_lines w WHERE w.receipt_id = r.id AND w.waiting_since IS NOT NULL AND w.line_status = 'active') AS waiting
         FROM goods_receipts r WHERE r.route_message_id = ? ORDER BY r.receipt_number`
      )
      .bind(messageId)
      .all<{ receipt_number: string; status: string; stage: string | null; waiting: number }>()
  ).results;
  return {
    message: m?.id ?? messageId,
    status: m?.status ?? "received",
    reference: m?.subject ?? null,
    receivedAt: m?.received_at ?? null,
    completedAt: m?.completed_at ?? null,
    ...(m?.error_text ? { error: m.error_text } : {}),
    receipts: receipts.map((r) => ({
      receiptNumber: r.receipt_number,
      status: r.status,
      ...(r.stage ? { stage: r.stage } : {}),
      ...(r.waiting > 0 ? { linesWaitingForOrder: r.waiting } : {}),
    })),
    check: checkUrl,
  };
}

/** The HTTPS source receipts are posted to: Receipts in, on a process that moves goods receipts. */
export async function receiptsSource(db: D1Database, sourceId: string) {
  return db
    .prepare(
      `SELECT s.id, s.name, s.status FROM sources s JOIN processes p ON p.id = s.process_id
       WHERE s.id = ? AND s.mechanism = 'https' AND p.subject_type = 'goods_receipt'`
    )
    .bind(sourceId)
    .first<{ id: string; name: string; status: string }>();
}

/**
 * `POST /v1/sources/:id/receipts` — a warehouse system's receipts, with
 * the source's key. `application/json` as in `receiptsJsonToCsv`, or
 * `text/csv` with our columns (`GET /goods-receipts/csv-format`).
 * `X-Reference` names the message for the sender. Answers 202 with what
 * each receipt became (registered, or waiting at a stage), and a `check`
 * address to ask again; 422 when nothing could be loaded.
 *
 * A sender is not a person: its receipts are checked against every
 * order, and recorded by nobody, the source naming who sent them.
 */
export async function handleHttpsReceipts(
  db: D1Database,
  key: SourceKey,
  request: Request,
  origin: string,
  deps: { bucket?: R2Bucket | null; customerId?: string | null }
): Promise<RouteResult & { touched?: Touched[] }> {
  const source = await receiptsSource(db, key.source_id);
  if (!source) return { status: 404, body: { error: "this source does not receive goods receipts" } };
  if (source.status !== "active") return { status: 410, body: { error: `${source.name} is retired and no longer receives receipts` } };
  const type = (request.headers.get("Content-Type") ?? "").toLowerCase();
  let csv: string;
  if (type.startsWith("application/json")) {
    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return { status: 400, body: { error: "the body is not JSON", reason: "not_json" } };
    }
    const converted = receiptsJsonToCsv(json);
    if ("error" in converted) return { status: 400, body: { error: converted.error, reason: "not_receipts" } };
    csv = converted.csv;
  } else if (type.startsWith("text/csv") || type.startsWith("text/plain")) {
    csv = await request.text();
    if (!csv.trim()) return { status: 400, body: { error: "the body is empty", reason: "empty" } };
  } else {
    return { status: 415, body: { error: "send application/json or text/csv", reason: "type" } };
  }
  const reference = request.headers.get("X-Reference");
  const received = await receiveReceipts(db, {
    sourceId: source.id,
    sourceName: source.name,
    routeId: RECEIPTS_IN_ROUTE,
    counterparty: key.name,
    subject: reference ?? "Goods receipts",
    filename: "receipts.csv",
    csv,
    userId: null,
    scope: null,
    event: "https_received",
    eventDetail: `key ${key.key_prefix}… (${key.name})`,
    bucket: deps.bucket,
    customerId: deps.customerId,
  });
  if ("error" in received) return { status: 500, body: { error: received.error } };
  const check = `${origin}/v1/sources/${encodeURIComponent(source.id)}/messages/${encodeURIComponent(received.messageId)}`;
  const report = await receiptsReport(db, received.messageId, check);
  return {
    status: received.status === "failed" ? 422 : 202,
    body: {
      ...report,
      ...(received.load.refused?.length ? { refused: received.load.refused } : {}),
      ...(Array.isArray((received.load as { warnings?: unknown[] }).warnings) && (received.load as { warnings: unknown[] }).warnings.length ? { warnings: (received.load as { warnings: unknown[] }).warnings } : {}),
    },
    touched: received.touched,
  };
}
