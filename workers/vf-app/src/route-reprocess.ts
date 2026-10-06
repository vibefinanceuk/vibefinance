import type { RouteResult } from "./org-route.js";
import type { ExtractionModel } from "./extraction.js";
import { attachmentsOf, captureAttachmentPart } from "./inbound-email.js";
import { addRouteEvent, routePartKey, storeRoutePart, type StoredPart } from "./route-messages.js";

/**
 * **Fix and run again — decision 0559**, slice 5 of the Routes design.
 *
 * *Reprocess* runs a failed inbound message through capture again, from
 * the original kept in R2 (0555), with the route as it is now: the fix a
 * customer's IT team made (a supplier corrected, an org set, a process
 * given its stages) applies without asking the supplier to send anything.
 * *Dismiss* closes a failure that needs no fixing, with the reason.
 *
 * **Never an invoice twice.** Only attachments that did not become an
 * invoice are run again; one that did is left as it is. And a message
 * whose email is kept but whose attachments were never cut from it (it
 * failed before that, say, because nothing was attached) has them read
 * from the kept email afresh.
 *
 * **Only what can be run again.** An outbound message is re-sent by
 * exporting again, not from here; mail to an address nothing claims was
 * never kept (0555); a retired source receives nothing.
 */

export interface ReprocessDeps {
  model: ExtractionModel;
  bucket?: R2Bucket;
  customerId?: string;
}

interface MessageRow {
  id: string;
  instance_id: string | null;
  direction: string;
  status: string;
  received_at: string;
  attempts: number;
}

/** Why a message cannot be reprocessed, or null when it can. A code: the words are the interface's (0132). */
export async function whyNotReprocess(db: D1Database, m: MessageRow): Promise<string | null> {
  if (m.direction !== "in") return "outbound";
  if (m.status !== "failed" && m.status !== "partial" && m.status !== "received") return "not_failed";
  if (!m.instance_id) return "no_original";
  const source = await db
    .prepare("SELECT s.status, p.subject_type FROM sources s JOIN processes p ON p.id = s.process_id WHERE s.id = ?")
    .bind(m.instance_id)
    .first<{ status: string; subject_type: string }>();
  if (!source) return "no_original";
  if (source.status === "retired") return "source_retired";
  // Decision 0655: running again reads invoices. Goods receipts are sent again instead, and what loaded is skipped.
  if (source.subject_type === "goods_receipt") return "receipts_resend";
  const original = await db
    .prepare("SELECT count(*) AS n FROM route_message_parts WHERE message_id = ?")
    .bind(m.id)
    .first<{ n: number }>();
  return (original?.n ?? 0) === 0 ? "no_original" : null;
}

export async function handleReprocessMessage(
  db: D1Database,
  id: string,
  actor: string,
  deps: ReprocessDeps
): Promise<RouteResult> {
  const m = await db
    .prepare("SELECT id, instance_id, direction, status, received_at, attempts, counterparty FROM route_messages WHERE id = ?")
    .bind(id)
    .first<MessageRow>();
  if (!m) return { status: 404, body: { error: `message ${id} does not exist` } };
  const refusal = await whyNotReprocess(db, m);
  if (refusal) return { status: 409, body: { error: `message ${id} cannot be reprocessed`, reason: refusal } };
  if (!deps.bucket) return { status: 503, body: { error: "no R2 bucket is bound", reason: "no_bucket" } };
  const sourceId = m.instance_id as string;

  await db.prepare("UPDATE route_messages SET attempts = attempts + 1 WHERE id = ?").bind(id).run();
  await addRouteEvent(db, id, "reprocessed", { actor });

  const parts = (
    await db
      .prepare(
        "SELECT seq, role, filename, content_type, r2_key, outcome FROM route_message_parts WHERE message_id = ? ORDER BY seq"
      )
      .bind(id)
      .all<{ seq: number; role: string; filename: string; content_type: string; r2_key: string; outcome: string | null }>()
  ).results;
  const attachments = parts.filter((p) => p.role === "attachment");

  /**
   * **No attachment was ever cut from it** — it failed before that
   * point. Read them from the kept email now, and keep each, as receiving
   * would have: a supplier who has since been told what to send does not
   * re-send this one, but an email whose parser has since learnt more
   * (0168) may yield what it did not then.
   */
  if (attachments.length === 0) {
    const original = parts.find((p) => p.role === "original");
    const object = original ? await deps.bucket.get(original.r2_key) : null;
    if (object && deps.customerId) {
      const raw = new TextDecoder().decode(await object.arrayBuffer());
      let seq = Math.max(0, ...parts.map((p) => p.seq));
      for (const a of attachmentsOf(raw)) {
        seq += 1;
        const stored = await storeRoutePart(deps.bucket, db, {
          messageId: id,
          seq,
          role: "attachment",
          filename: a.filename,
          contentType: a.contentType,
          bytes: a.bytes,
          key: routePartKey(deps.customerId, sourceId, id, m.received_at, seq, a.filename),
        });
        if ("stored" in stored) {
          attachments.push({ seq, role: "attachment", filename: a.filename, content_type: a.contentType, r2_key: stored.stored.r2Key, outcome: null });
        }
      }
    }
  }

  // Never an invoice twice: an attachment that became one is left alone.
  const alreadyMade = new Set(
    (
      await db
        .prepare("SELECT part_seq FROM route_message_items WHERE message_id = ? AND part_seq IS NOT NULL")
        .bind(id)
        .all<{ part_seq: number }>()
    ).results.map((r) => r.part_seq)
  );
  const toRun = attachments.filter((a) => a.outcome !== "captured" && !alreadyMade.has(a.seq));
  const reasons: string[] = [];
  for (const a of toRun) {
    const object = await deps.bucket.get(a.r2_key);
    if (!object) {
      reasons.push(`${a.filename}: the stored file is missing`);
      continue;
    }
    const stored: StoredPart = { routeMessageId: id, partSeq: a.seq, r2Key: a.r2_key };
    const outcome = await captureAttachmentPart(db, {
      messageId: id,
      sourceId,
      seq: a.seq,
      filename: a.filename,
      bytes: new Uint8Array(await object.arrayBuffer()),
      stored,
      model: deps.model,
      bucket: deps.bucket,
      customerId: deps.customerId,
      actor,
      sender: (m as { counterparty?: string | null }).counterparty ?? undefined,
    });
    if (!outcome.captured) reasons.push(outcome.why ? `${a.filename}: ${outcome.why}` : a.filename);
  }

  const status = await settleInbound(db, id, attachments.length, reasons);
  return { status: 200, body: { id, status, ran: toRun.length, failed: reasons.length } };
}

/**
 * **The message's outcome from its attachments, after a run.** Every
 * attachment made an invoice: delivered. Some: partly delivered. None:
 * failed at translation, with each file's reason. No attachment at all:
 * failed at the format, as receiving decides.
 */
async function settleInbound(db: D1Database, id: string, attachmentCount: number, reasons: string[]): Promise<string> {
  const captured = await db
    .prepare("SELECT count(*) AS n FROM route_message_parts WHERE message_id = ? AND role = 'attachment' AND outcome = 'captured'")
    .bind(id)
    .first<{ n: number }>();
  const made = captured?.n ?? 0;
  let status: string;
  let failedPart: string | null = null;
  let code: string | null = null;
  let text: string | null = null;
  if (attachmentCount === 0) {
    status = "failed";
    failedPart = "format";
    code = "no_attachment";
    text = "The message carried no PDF, XML or image attachment.";
  } else if (made === attachmentCount) {
    status = "delivered";
  } else if (made > 0) {
    status = "partial";
  } else {
    status = "failed";
    failedPart = "translation";
    code = "unreadable";
    text = reasons.join(" · ") || "No attachment could be read as an invoice.";
  }
  await db
    .prepare(
      "UPDATE route_messages SET status = ?, failed_part = ?, error_code = ?, error_text = ?, completed_at = ? WHERE id = ?"
    )
    .bind(status, failedPart, code, text?.slice(0, 1000) ?? null, new Date().toISOString(), id)
    .run();
  await addRouteEvent(db, id, status, code ? { detail: code } : {});
  return status;
}

/**
 * `POST /route-messages/:id/dismiss` — **close a failure that needs no
 * fixing**, with the reason: a spam message, a duplicate the supplier
 * already re-sent, a test. The failure stays on the record (what failed,
 * where and why); it simply stops counting as waiting to be fixed.
 */
export async function handleDismissMessage(
  db: D1Database,
  id: string,
  actor: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!reason) return { status: 400, body: { error: "Say why it is being dismissed.", reason: "reason_required" } };
  const m = await db.prepare("SELECT status FROM route_messages WHERE id = ?").bind(id).first<{ status: string }>();
  if (!m) return { status: 404, body: { error: `message ${id} does not exist` } };
  if (m.status !== "failed" && m.status !== "partial" && m.status !== "received") {
    return { status: 409, body: { error: `message ${id} has nothing to dismiss`, reason: "not_failed" } };
  }
  await db.prepare("UPDATE route_messages SET status = 'dismissed' WHERE id = ?").bind(id).run();
  await addRouteEvent(db, id, "dismissed", { detail: reason.slice(0, 1000), actor });
  return { status: 200, body: { id, status: "dismissed" } };
}
