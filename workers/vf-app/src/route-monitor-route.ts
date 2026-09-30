import type { RouteResult } from "./org-route.js";
import { whyNotReprocess } from "./route-reprocess.js";
import { rereadState } from "./mapping-reread.js";

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
  // Decision 0558: a route is a source or a Destination; unclaimed mail
  // is inbound with neither.
  if (source === "none") where.push("m.direction = 'in' AND m.instance_id IS NULL");
  else if (source) {
    where.push("(m.instance_id = ? OR m.destination_id = ?)");
    binds.push(source, source);
  }
  if (failedOnly) where.push("m.status IN ('failed', 'partial')");

  const rows = await db
    .prepare(
      `SELECT m.id, COALESCE(m.instance_id, m.destination_id) AS instance_id, COALESCE(s.name, d.name) AS source_name, m.direction, m.status, m.failed_part,
              m.error_code, m.counterparty, m.recipient, m.subject, m.received_at,
              (SELECT count(*) FROM route_message_parts p WHERE p.message_id = m.id AND p.role = 'attachment') AS attachments,
              (SELECT count(*) FROM route_message_parts p WHERE p.message_id = m.id AND p.outcome = 'captured') AS captured,
              (SELECT COALESCE(h.invoice_number, i.item_id) FROM route_message_items i
                 LEFT JOIN invoice_headers h ON h.id = i.item_id
                 WHERE i.message_id = m.id ORDER BY i.part_seq LIMIT 1) AS first_invoice,
              (SELECT count(*) FROM route_message_items i WHERE i.message_id = m.id) AS invoices
       FROM route_messages m
       LEFT JOIN sources s ON s.id = m.instance_id
       LEFT JOIN route_instances d ON d.id = m.destination_id
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
  // Decision 0558: the Destinations messages go out on, to filter by too.
  const destinations = await db
    .prepare(
      `SELECT i.id, i.name, i.status, p.name AS process_name FROM route_instances i
       JOIN processes p ON p.id = i.process_id
       WHERE i.source_id IS NULL ORDER BY p.name, i.name`
    )
    .all<{ id: string; name: string; status: string; process_name: string }>();

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
      destinations: destinations.results.map((d) => ({
        id: d.id,
        // Named with its process where there is more than one ERP.
        name: destinations.results.filter((o) => o.name === d.name).length > 1 ? `${d.name} · ${d.process_name}` : d.name,
        status: d.status,
      })),
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
      `SELECT m.*, COALESCE(s.name, d.name) AS source_name, COALESCE(m.instance_id, m.destination_id) AS route_instance
       FROM route_messages m
       LEFT JOIN sources s ON s.id = m.instance_id
       LEFT JOIN route_instances d ON d.id = m.destination_id
       WHERE m.id = ?`
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!m) return { status: 404, body: { error: `message ${id} does not exist` } };

  const parts = await db
    .prepare(
      `SELECT p.seq, p.role, p.filename, p.content_type, p.bytes, p.sha256, p.outcome, p.reason, p.stored_at, p.format, p.syntax,
              p.en16931_failed, p.xml_root, p.mapping_id, p.mapping_version, p.mapping_miss, sm.name AS mapping_name
       FROM route_message_parts p LEFT JOIN supplier_mappings sm ON sm.id = p.mapping_id
       WHERE p.message_id = ? ORDER BY p.seq`
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
      format: string | null;
      syntax: string | null;
      en16931_failed: string | null;
      xml_root: string | null;
      mapping_id: string | null;
      mapping_version: number | null;
      mapping_miss: string | null;
      mapping_name: string | null;
    }>();
  const events = await db
    .prepare(
      `SELECT e.seq, e.at, e.event, e.part_seq, e.detail, u.name AS actor_name
       FROM route_message_events e LEFT JOIN org_users u ON u.id = e.actor
       WHERE e.message_id = ? ORDER BY e.seq`
    )
    .bind(id)
    .all<{ seq: number; at: string; event: string; part_seq: number | null; detail: string | null; actor_name: string | null }>();
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

  /**
   * **What can be done with it — decision 0559.** Whether it can be run
   * again (and if not, why: a code), and the other open failures on the
   * same route with the same problem, which one fix usually fixes too.
   */
  const cannotReprocess = await whyNotReprocess(db, {
    id: String(m.id),
    instance_id: (m.instance_id as string | null) ?? null,
    direction: String(m.direction),
    status: String(m.status),
    received_at: String(m.received_at),
    attempts: Number(m.attempts ?? 1),
  });
  const similar =
    m.instance_id && m.error_code && (m.status === "failed" || m.status === "partial")
      ? (
          await db
            .prepare(
              `SELECT id FROM route_messages WHERE instance_id = ? AND error_code = ? AND status IN ('failed', 'partial') AND id != ?
               ORDER BY received_at DESC LIMIT 50`
            )
            .bind(m.instance_id, m.error_code, m.id)
            .all<{ id: string }>()
        ).results.map((r) => r.id)
      : [];

  return {
    status: 200,
    body: {
      canReprocess: cannotReprocess === null,
      cannotReprocess,
      similar,
      canDismiss: m.status === "failed" || m.status === "partial" || m.status === "received",
      message: {
        id: m.id,
        sourceId: m.route_instance,
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
      parts: (await Promise.all(parts.results.map(async (p) => ({ p, reread: p.outcome === "captured" && p.mapping_id ? await rereadState(db, id, p.seq) : null })))).map(({ p, reread }) => ({
        seq: p.seq,
        role: p.role,
        filename: p.filename,
        contentType: p.content_type,
        bytes: p.bytes,
        sha256: p.sha256,
        outcome: p.outcome,
        reason: p.reason,
        storedAt: p.stored_at,
        // Decision 0560: the e-invoice format, and the EN 16931 rules it
        // broke — `null` where it was not checked, `[]` where it passed.
        format: p.format,
        syntax: p.syntax,
        en16931Failed: parseFailed(p.en16931_failed),
        // Decision 0561: a supplier's own XML — its root, and the mapping
        // that read it or tried to (null where none exists yet).
        xmlRoot: p.xml_root,
        mapping: p.mapping_id ? { id: p.mapping_id, version: p.mapping_version, name: p.mapping_name, miss: p.mapping_miss } : null,
        // Decision 0566: a captured supplier file whose mapping has a newer
        // live version — whether it can be read again with it, or why not.
        reread,
      })),
      // Who did it, for what a person did (an export made or undone, 0558).
      events: events.results.map((e) => ({ seq: e.seq, at: e.at, event: e.event, partSeq: e.part_seq, detail: e.detail, actorName: e.actor_name })),
      invoices: items.results.map((i) => ({
        invoiceId: i.item_id,
        partSeq: i.part_seq,
        number: i.invoice_number,
        supplierName: i.supplier_name,
      })),
    },
  };
}

function parseFailed(raw: string | null): Array<{ rule: string; detail?: string }> | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as Array<{ rule: string; detail?: string }>) : null;
  } catch {
    return null;
  }
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
