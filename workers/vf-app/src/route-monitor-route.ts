import type { RouteResult } from "./org-route.js";

/**
 * **The Route monitor — decision 0556**, slice 2 of
 * `docs/design/routes-phase1-data-model.md`.
 *
 * Every message a Source has received (0555), for a customer's own IT
 * team: what arrived, from whom, what became of it, where it failed and
 * why, and the original as it arrived. Read-only in this slice:
 * reprocessing and dismissing are slice 5.
 *
 * **D1 answers the list; R2 only the file asked for.** The list, the
 * counts and a message's detail are all read from D1's small rows. A
 * part's bytes are fetched from R2 only when someone opens that one
 * file, and streamed straight through rather than read into memory.
 *
 * **Not scoped by unit.** `Integration.Monitor` is for the people who
 * look after the connections themselves, which serve the whole
 * customer: a mailbox is not one org's. Invoices a message made are
 * named by number only, never opened from here: opening one is
 * `AP.*` work, scoped as it always has been.
 */

const PERIODS: Record<string, number> = { today: 0, "7d": 7, "30d": 30 };

interface ListRow {
  id: string;
  instance_id: string | null;
  source_name: string | null;
  direction: string;
  status: string;
  failed_part: string | null;
  error_code: string | null;
  counterparty: string | null;
  recipient: string | null;
  subject: string | null;
  received_at: string;
  attachments: number;
  captured: number;
  first_invoice: string | null;
  invoices: number;
}

/** The start of the period, as an ISO string: midnight UTC today, less `days`. */
function periodStart(period: string, now: Date): string {
  const days = PERIODS[period] ?? 0;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  start.setUTCDate(start.getUTCDate() - days);
  return start.toISOString();
}

/**
 * `GET /route-messages` — the list, the four counts, and the sources to
 * filter by, in one answer so the screen draws from one request.
 *
 * Filters: `source` (an id, or `none` for mail nothing claimed),
 * `status=failed` (failed or partial), `period` (`today`, `7d`, `30d`).
 */
export async function handleListRouteMessages(
  db: D1Database,
  params: URLSearchParams,
  now: Date = new Date()
): Promise<RouteResult> {
  const period = PERIODS[params.get("period") ?? ""] === undefined ? "today" : (params.get("period") as string);
  const since = periodStart(period, now);
  const source = params.get("source");
  const failedOnly = params.get("status") === "failed";

  const where = ["m.received_at >= ?"];
  const binds: unknown[] = [since];
  if (source === "none") where.push("m.instance_id IS NULL");
  else if (source) {
    where.push("m.instance_id = ?");
    binds.push(source);
  }
  if (failedOnly) where.push("m.status IN ('failed', 'partial')");

  const rows = await db
    .prepare(
      `SELECT m.id, m.instance_id, s.name AS source_name, m.direction, m.status, m.failed_part,
              m.error_code, m.counterparty, m.recipient, m.subject, m.received_at,
              (SELECT count(*) FROM route_message_parts p WHERE p.message_id = m.id AND p.role = 'attachment') AS attachments,
              (SELECT count(*) FROM route_message_parts p WHERE p.message_id = m.id AND p.outcome = 'captured') AS captured,
              (SELECT COALESCE(h.invoice_number, i.item_id) FROM route_message_items i
                 LEFT JOIN invoice_headers h ON h.id = i.item_id
                 WHERE i.message_id = m.id ORDER BY i.part_seq LIMIT 1) AS first_invoice,
              (SELECT count(*) FROM route_message_items i WHERE i.message_id = m.id) AS invoices
       FROM route_messages m
       LEFT JOIN sources s ON s.id = m.instance_id
       WHERE ${where.join(" AND ")}
       ORDER BY m.received_at DESC, m.id DESC
       LIMIT 200`
    )
    .bind(...binds)
    .all<ListRow>();

  /**
   * **The four counts, always for today and every source**, whatever
   * the list is filtered to: they answer "is anything wrong right now",
   * which a filter should not hide.
   *
   * *Failed, not yet fixed* is every failed or partial message not
   * dismissed, from any day: a failure from yesterday is still waiting.
   * *Waiting over an hour* is a message still `received` an hour after
   * it arrived, which means something stopped half-way.
   */
  const today = periodStart("today", now);
  const hourAgo = new Date(now.getTime() - 3600_000).toISOString();
  const summary = await db
    .prepare(
      `SELECT
         (SELECT count(*) FROM route_messages WHERE direction = 'in' AND received_at >= ?) AS received_today,
         (SELECT count(*) FROM route_messages WHERE status IN ('delivered', 'partial') AND received_at >= ?) AS delivered_today,
         (SELECT count(*) FROM route_messages WHERE status IN ('failed', 'partial')) AS failed_open,
         (SELECT count(*) FROM route_messages WHERE status = 'received' AND received_at < ?) AS waiting`
    )
    .bind(today, today, hourAgo)
    .first<{ received_today: number; delivered_today: number; failed_open: number; waiting: number }>();

  const sources = await db
    .prepare("SELECT id, name, status FROM sources WHERE mechanism = 'email' ORDER BY name")
    .all<{ id: string; name: string; status: string }>();

  return {
    status: 200,
    body: {
      period,
      summary: {
        receivedToday: summary?.received_today ?? 0,
        deliveredToday: summary?.delivered_today ?? 0,
        failedOpen: summary?.failed_open ?? 0,
        waitingOverHour: summary?.waiting ?? 0,
      },
      sources: sources.results.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      messages: rows.results.map((r) => ({
        id: r.id,
        sourceId: r.instance_id,
        sourceName: r.source_name,
        direction: r.direction,
        status: r.status,
        failedPart: r.failed_part,
        errorCode: r.error_code,
        counterparty: r.counterparty,
        recipient: r.recipient,
        subject: r.subject,
        receivedAt: r.received_at,
        attachments: r.attachments,
        captured: r.captured,
        invoices: r.invoices,
        firstInvoice: r.first_invoice,
      })),
    },
  };
}

/** `GET /route-messages/:id` — one message: its parts, history and invoices. */
export async function handleGetRouteMessage(db: D1Database, id: string): Promise<RouteResult> {
  const m = await db
    .prepare(
      `SELECT m.*, s.name AS source_name FROM route_messages m
       LEFT JOIN sources s ON s.id = m.instance_id WHERE m.id = ?`
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!m) return { status: 404, body: { error: `message ${id} does not exist` } };

  const parts = await db
    .prepare(
      `SELECT seq, role, filename, content_type, bytes, sha256, outcome, reason, stored_at
       FROM route_message_parts WHERE message_id = ? ORDER BY seq`
    )
    .bind(id)
    .all<{
      seq: number;
      role: string;
      filename: string;
      content_type: string;
      bytes: number;
      sha256: string;
      outcome: string | null;
      reason: string | null;
      stored_at: string;
    }>();
  const events = await db
    .prepare("SELECT seq, at, event, part_seq, detail FROM route_message_events WHERE message_id = ? ORDER BY seq")
    .bind(id)
    .all<{ seq: number; at: string; event: string; part_seq: number | null; detail: string | null }>();
  const items = await db
    .prepare(
      `SELECT i.item_id, i.part_seq, h.invoice_number,
              COALESCE(s.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name
       FROM route_message_items i
       LEFT JOIN invoice_headers h ON h.id = i.item_id
       LEFT JOIN suppliers s ON s.id = h.supplier_id
       WHERE i.message_id = ? ORDER BY i.part_seq`
    )
    .bind(id)
    .all<{ item_id: string; part_seq: number | null; invoice_number: string | null; supplier_name: string | null }>();

  return {
    status: 200,
    body: {
      message: {
        id: m.id,
        sourceId: m.instance_id,
        sourceName: m.source_name,
        direction: m.direction,
        status: m.status,
        failedPart: m.failed_part,
        errorCode: m.error_code,
        errorText: m.error_text,
        counterparty: m.counterparty,
        recipient: m.recipient,
        subject: m.subject,
        bytes: m.bytes,
        receivedAt: m.received_at,
        completedAt: m.completed_at,
        attempts: m.attempts,
      },
      // The R2 key stays on the server: a part is fetched by its number.
      parts: parts.results.map((p) => ({
        seq: p.seq,
        role: p.role,
        filename: p.filename,
        contentType: p.content_type,
        bytes: p.bytes,
        sha256: p.sha256,
        outcome: p.outcome,
        reason: p.reason,
        storedAt: p.stored_at,
      })),
      events: events.results.map((e) => ({ seq: e.seq, at: e.at, event: e.event, partSeq: e.part_seq, detail: e.detail })),
      invoices: items.results.map((i) => ({
        invoiceId: i.item_id,
        partSeq: i.part_seq,
        number: i.invoice_number,
        supplierName: i.supplier_name,
      })),
    },
  };
}

/**
 * `GET /route-messages/:id/parts/:seq` — one stored file, as it arrived.
 *
 * Looked up in D1 first, so a part that was never recorded is a clean
 * 404 without an R2 round trip (0035's order), then streamed from R2.
 * Always a download, never shown inline: this is somebody else's file,
 * and an HTML attachment rendered on this origin would run as this app.
 */
export async function routeMessagePart(
  db: D1Database,
  bucket: R2Bucket | undefined,
  id: string,
  seq: number
): Promise<Response | RouteResult> {
  const part = await db
    .prepare("SELECT r2_key, filename, content_type FROM route_message_parts WHERE message_id = ? AND seq = ?")
    .bind(id, seq)
    .first<{ r2_key: string; filename: string; content_type: string }>();
  if (!part) return { status: 404, body: { error: `message ${id} has no part ${seq}` } };
  if (!bucket) return { status: 503, body: { error: "no R2 bucket is bound" } };

  const object = await bucket.get(part.r2_key);
  if (!object) return { status: 404, body: { error: `the stored file for part ${seq} is missing` } };

  const filename = part.filename.replace(/["\\\r\n]/g, "_");
  return new Response(object.body, {
    status: 200,
    headers: {
      "Content-Type": part.content_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
