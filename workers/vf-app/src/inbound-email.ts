import { handleCaptureFromSource } from "./source-capture-route.js";
import type { ExtractionModel } from "./extraction.js";
import {
  addRouteEvent,
  finishRouteMessage,
  linkRouteItem,
  openRouteMessage,
  routePartKey,
  setPartFormat,
  setPartOutcome,
  storeRoutePart,
  type StoredPart,
} from "./route-messages.js";

/**
 * Invoices arriving by email — decision 0146.
 *
 * A source has carried an address since decision 0126 and **nothing
 * delivered to one**. This is the handler a Cloudflare Email Routing
 * rule delivers to.
 *
 * **It runs in the customer's own Worker.** Decision 0125 settled that:
 * a shared receiver would put every customer's invoice through the same
 * code on its way in, which is exactly what decision 0091's split
 * exists to prevent. A routing rule names one address and one Worker,
 * so another customer's mail never touches this code path.
 */

/**
 * What a message may weigh, and how many parts are worth reading.
 *
 * **Cloudflare caps an inbound message at 25MB** and rejects larger
 * before it arrives, so this is not the guard against a huge message —
 * it is the guard against a message whose *attachments* are large
 * enough to be something other than an invoice.
 */
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

/** What an invoice arrives as. */
const CAPTURABLE = [
  "application/pdf",
  "application/xml",
  "text/xml",
  "image/jpeg",
  "image/png",
  "image/tiff",
];

export interface EmailMessage {
  readonly from: string;
  readonly to: string;
  readonly raw: ReadableStream;
  readonly rawSize: number;
  setReject(reason: string): void;
  forward(to: string, headers?: Headers): Promise<void>;
}

/**
 * The source an address belongs to.
 *
 * **The address is the routing.** Decision 0126 made it unique across
 * the fleet precisely so this lookup has one answer, and made it
 * derived from the customer so it survives the move to production.
 */
async function sourceFor(db: D1Database, address: string) {
  return db
    .prepare(
      `SELECT id, name, status, email_routing FROM sources
       WHERE email_address = ? AND mechanism = 'email'`
    )
    .bind(address.toLowerCase())
    .first<{ id: string; name: string; status: string; email_routing: string }>();
}

/**
 * Every part of a message that might be an invoice.
 *
 * **Attachments only, and that is a decision rather than a
 * simplification.** A supplier who pastes an invoice into the body has
 * sent something this system cannot store as a document — there is no
 * file to retain, and decision 0055's whole intake model rests on
 * keeping what arrived. Rejecting is honest; capturing the body as a
 * text file would produce a document nobody can audit against.
 *
 * Parsed from the raw message rather than from a library: `EmailMessage`
 * gives a stream and nothing else, and a MIME parser is a dependency
 * this needs one function from.
 */
export function attachmentsOf(raw: string): { filename: string; contentType: string; bytes: Uint8Array }[] {

  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);
  if (!boundaryMatch) return [];

  const parts = raw.split(`--${boundaryMatch[1]}`);
  const found: { filename: string; contentType: string; bytes: Uint8Array }[] = [];

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headers = part.slice(0, headerEnd).toLowerCase();
    const contentType = part.slice(0, headerEnd).match(/content-type:\s*([^;\r\n]+)/i)?.[1]?.trim();
    if (!contentType || !CAPTURABLE.includes(contentType.toLowerCase())) continue;

    // Base64 is what a mail system uses for anything that is not text,
    // and the only encoding worth handling: a PDF sent as anything else
    // did not survive the journey.
    if (!headers.includes("base64")) continue;

    const filename =
      part.slice(0, headerEnd).match(/filename="?([^"\r\n;]+)"?/i)?.[1]?.trim() ?? "attachment";

    /**
     * **Everything that is not base64 goes** — decision 0168.
     *
     * This stripped newlines and trailing dashes, which handles the
     * common case and not the others: a mail client that wraps with
     * tabs, or leaves a space after a soft break, puts a character in
     * the stream that `atob` either rejects or silently mis-aligns.
     *
     * **This is not demonstrably the fix** for the photograph that
     * reached detection as *"unrecognised"*: `atob` in this runtime
     * tolerates those characters, and a test with tabs in the stream
     * passes with the old decode too.
     *
     * Kept because a decoder that accepts only what it decodes is right
     * regardless, and recorded as speculation rather than a cure. The
     * diagnostic beside it is what will actually say.
     */
    const body = part.slice(headerEnd + 4).replace(/[^A-Za-z0-9+/=]/g, "");
    try {
      const binary = atob(body);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      if (bytes.length > 0 && bytes.length <= MAX_ATTACHMENT_BYTES) {
        found.push({ filename, contentType: contentType.toLowerCase(), bytes });
      }
    } catch {
      // A part that will not decode is a part that did not arrive
      // intact. Skipped rather than thrown: one bad attachment must not
      // lose the others.
    }
  }

  return found;
}

/**
 * Record what arrived — decision 0147.
 *
 * **Never throws.** A failure to record must not become a failure to
 * receive: bouncing an invoice because an audit insert failed would
 * lose the document to protect the note about it.
 */
async function record(
  db: D1Database,
  message: EmailMessage,
  outcome: "captured" | "rejected",
  reason: string | null,
  sourceId: string | null,
  attachments = 0,
  captured = 0
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO inbound_email_events
           (id, sender, recipient, source_id, outcome, reason, attachments, captured)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        crypto.randomUUID(),
        message.from,
        message.to.toLowerCase(),
        sourceId,
        outcome,
        reason,
        attachments,
        captured
      )
      .run();
  } catch {
    // Deliberately silent. See above.
  }
}

/**
 * Mark a source as actually receiving — decision 0147.
 *
 * `email_routing` has read `not_configured` since decision 0126 and
 * **nothing ever set it**, so a screen would say *"Not receiving yet"*
 * about an address that receives — a lie, and worse than the
 * placeholder it replaced.
 *
 * Set by the **first message that arrives**, rather than by somebody
 * remembering. A routing rule is created in Cloudflare's dashboard and
 * this database cannot see it, so **a message arriving is the only
 * honest evidence that routing works.**
 */
async function markReceiving(db: D1Database, sourceId: string): Promise<void> {
  try {
    await db
      .prepare("UPDATE sources SET email_routing = 'active' WHERE id = ? AND email_routing != 'active'")
      .bind(sourceId)
      .run();
  } catch {
    // The message still arrived, which is the part that matters.
  }
}

/**
 * Receive a message.
 *
 * **Nothing is silently dropped.** Decision 0125 named this: *"a
 * supplier who sent an invoice believes they sent it."* Every refusal
 * calls `setReject`, which returns a bounce the sender actually sees —
 * the difference between a supplier learning today and a customer
 * learning in a month that invoices went nowhere.
 */
/**
 * Receive a message, then — **decision 0559** — tell whoever asked to be
 * told if it failed. `onFinished` is given the message's id once it is
 * recorded; the alerts decide from its status whether to say anything.
 * A failure to alert never affects what was received.
 */
export async function handleInboundEmail(
  message: EmailMessage,
  db: D1Database,
  model: ExtractionModel,
  bucket?: R2Bucket,
  customerId?: string,
  onFinished?: (messageId: string) => Promise<void>
): Promise<void> {
  const messageId = await receiveInboundEmail(message, db, model, bucket, customerId);
  if (messageId && onFinished) {
    try {
      await onFinished(messageId);
    } catch {
      // Deliberately silent: see above.
    }
  }
}

/**
 * **One attachment through capture — decisions 0555 and 0559.** Shared by
 * receiving and by reprocessing, so a message fixed and run again goes
 * through exactly the path it first took: the invoice points at the
 * stored part, the part records its outcome, and the history says so.
 */
export async function captureAttachmentPart(
  db: D1Database,
  args: {
    messageId: string | null;
    sourceId: string;
    seq: number;
    filename: string;
    bytes: Uint8Array;
    stored?: StoredPart;
    model: ExtractionModel;
    bucket?: R2Bucket;
    customerId?: string;
    actor?: string;
    /** Who sent it, which a supplier mapping may name (0561). */
    sender?: string;
  }
): Promise<{ captured: boolean; invoiceId?: string; why?: string }> {
  const { messageId, seq, stored } = args;
  const result = await handleCaptureFromSource(
    db,
    args.sourceId,
    args.bytes,
    args.model,
    undefined,
    args.bucket,
    args.customerId,
    stored,
    args.sender
  );
  const read = result.body as
    | {
        id?: string;
        error?: string;
        format?: string;
        syntax?: string | null;
        xmlRoot?: string;
        mappingId?: string | null;
        mappingVersion?: number;
        mappingMiss?: "not_for_sender" | "not_published" | null;
        en16931?: { failed: Array<{ rule: string; detail?: string }> } | null;
      }
    | undefined;
  /**
   * **What it was, and what read it — decisions 0560 and 0561** — recorded
   * whether it was captured or not: a supplier's own XML that failed keeps
   * its root element and the mapping that tried, for the monitor.
   */
  const recordFormat = async () => {
    if (!messageId || !stored || !read?.format) return;
    await setPartFormat(db, messageId, seq, {
      format: read.format,
      syntax: read.syntax ?? null,
      failed: result.status < 400 && read.en16931 ? read.en16931.failed : null,
      xmlRoot: read.xmlRoot ?? null,
      mappingId: read.mappingId ?? null,
      mappingVersion: read.mappingVersion ?? null,
      mappingMiss: read.mappingMiss ?? null,
    });
  };
  if (result.status >= 400) {
    await recordFormat();
    /**
     * **Why, not just that** — decision 0162.
     *
     * Decision 0146 collected failed attachments by filename and
     * discarded `result.body`, which holds the actual reason. So a
     * supplier got *"the attached file could not be read as an
     * invoice"*, the customer got `unreadable`, and **the one thing
     * that would explain it was thrown away** — the same fault
     * decision 0161 fixed for a document that could not be detected.
     *
     * `wrangler tail` shows nothing either, because capture returns a
     * 422 rather than throwing.
     */
    const why = (result.body as { error?: string } | undefined)?.error;
    if (messageId) {
      if (stored) await setPartOutcome(db, messageId, seq, "failed", why ?? null);
      await addRouteEvent(db, messageId, "capture_failed", { partSeq: seq, detail: why ?? args.filename });
    }
    return { captured: false, ...(why ? { why } : {}) };
  }
  const body = read;
  const invoiceId = body?.id;
  if (messageId) {
    if (stored) await setPartOutcome(db, messageId, seq, "captured", null);
    // Decision 0560: what it was, and what the EN 16931 checks found.
    if (stored && body?.format) {
      await recordFormat();
      if (body.en16931 && body.en16931.failed.length > 0) {
        await addRouteEvent(db, messageId, "en16931_failed", {
          partSeq: seq,
          detail: body.en16931.failed.map((f) => f.rule).join(", "),
        });
      }
    }
    if (invoiceId) await linkRouteItem(db, messageId, invoiceId, seq);
    await addRouteEvent(db, messageId, "captured", { partSeq: seq, ...(invoiceId ? { detail: invoiceId } : {}) });
  }
  return { captured: true, ...(invoiceId ? { invoiceId } : {}) };
}

async function receiveInboundEmail(
  message: EmailMessage,
  db: D1Database,
  model: ExtractionModel,
  bucket?: R2Bucket,
  customerId?: string
): Promise<string | null> {
  /**
   * **Read once, as bytes — decision 0555.** The raw stream can be read
   * only once, and the email itself is now kept, so it is read as the
   * bytes that arrived (at most 25MB, Cloudflare's own cap) and the
   * attachments are cut from that same copy.
   */
  const rawBytes = new Uint8Array(await new Response(message.raw).arrayBuffer());
  const raw = new TextDecoder().decode(rawBytes);
  const receivedAt = new Date().toISOString();
  const source = await sourceFor(db, message.to);

  /**
   * **The message is recorded before anything is decided about it**,
   * and — where a source claims the address — stored in R2 before
   * anything reads it. Everything below adds to this record.
   *
   * **Not stored for an address nothing claims.** Such mail belongs to
   * no process, so no retention rule covers it, and keeping every
   * message sent to any address would make the bucket a sink for
   * whatever anyone mails. The row is still written: that it arrived,
   * from whom, and that it was refused.
   */
  const messageId = await openRouteMessage(db, {
    instanceId: source?.id ?? null,
    direction: "in",
    counterparty: message.from,
    recipient: message.to.toLowerCase(),
    subject: subjectOf(raw),
    bytes: rawBytes.length,
    receivedAt,
  });
  const canStore = !!(messageId && source && bucket && customerId);
  if (messageId && source) {
    if (canStore) {
      const original = await storeRoutePart(bucket!, db, {
        messageId,
        seq: 0,
        role: "original",
        filename: "message.eml",
        contentType: "message/rfc822",
        bytes: rawBytes,
        key: routePartKey(customerId!, source.id, messageId, receivedAt, 0, "message.eml"),
      });
      await addRouteEvent(
        db,
        messageId,
        "stored" in original ? "original_stored" : "original_not_stored",
        { partSeq: 0, ...("reason" in original ? { detail: original.reason } : {}) }
      );
    } else {
      await addRouteEvent(db, messageId, "original_not_stored", {
        detail: !bucket ? "no R2 bucket is bound" : "CUSTOMER_ID is not configured",
      });
    }
  }

  if (!source) {
    // An address a routing rule delivers to and no source claims. The
    // rule outliving its source is the shape decision 0130 warned of.
    //
    // **The case that has nowhere else to be recorded**: no source
    // means no `intake_capture_events` row either (decision 0055), so
    // without this the message leaves no trace on the customer's side
    // at all.
    await record(db, message, "rejected", "no_such_address", null);
    if (messageId) {
      await finishRouteMessage(db, messageId, {
        status: "failed",
        failedPart: "gateway",
        errorCode: "no_such_address",
        errorText: `No source receives mail for ${message.to.toLowerCase()}.`,
      });
    }
    message.setReject("That address does not accept invoices.");
    return messageId;
  }

  if (source.status === "retired") {
    await record(db, message, "rejected", "source_retired", source.id);
    if (messageId) {
      await finishRouteMessage(db, messageId, {
        status: "failed",
        failedPart: "gateway",
        errorCode: "source_retired",
        errorText: `${source.name} is retired and no longer receives invoices.`,
      });
    }
    // **Retiring a source must remove its routing rule** (decision
    // 0130). Until it does, this is the guard that makes the status
    // true rather than decorative.
    message.setReject("That address is no longer in use.");
    return messageId;
  }

  const attachments = attachmentsOf(raw);

  if (attachments.length === 0) {
    await record(db, message, "rejected", "no_attachment", source.id);
    if (messageId) {
      await finishRouteMessage(db, messageId, {
        status: "failed",
        failedPart: "format",
        errorCode: "no_attachment",
        errorText: "The message carried no PDF, XML or image attachment.",
      });
    }
    message.setReject(
      "No invoice was attached. Please attach the invoice as a PDF, XML or image."
    );
    return messageId;
  }

  /**
   * **Every attachment, not the first.** A supplier sending three
   * invoices in one message has sent three invoices, and picking one
   * would lose two silently.
   */
  const failures: string[] = [];
  for (const [index, attachment] of attachments.entries()) {
    const seq = index + 1;

    /**
     * **Stored before it is read — decision 0555.** Each attachment is
     * its own R2 object, so the invoice it becomes can point at it
     * (`referenceStoredDocument`) and the viewer can serve it directly.
     * If storing fails, capture keeps the old path and stores the
     * invoice's own copy, as it did before this slice.
     */
    let stored: StoredPart | undefined;
    if (canStore) {
      const part = await storeRoutePart(bucket!, db, {
        messageId: messageId!,
        seq,
        role: "attachment",
        filename: attachment.filename,
        contentType: attachment.contentType,
        bytes: attachment.bytes,
        key: routePartKey(customerId!, source.id, messageId!, receivedAt, seq, attachment.filename),
      });
      if ("stored" in part) stored = part.stored;
      else await addRouteEvent(db, messageId!, "attachment_not_stored", { partSeq: seq, detail: part.reason });
    }

    const outcome = await captureAttachmentPart(db, {
      messageId,
      sourceId: source.id,
      seq,
      filename: attachment.filename,
      bytes: attachment.bytes,
      stored,
      model,
      bucket,
      customerId,
      sender: message.from,
    });
    if (!outcome.captured) failures.push(outcome.why ? `${attachment.filename}: ${outcome.why}` : attachment.filename);
  }

  // **Rejected only if nothing got through.** A message with one good
  // invoice and one broken attachment has delivered an invoice, and
  // bouncing it would ask the supplier to send the good one again.
  const captured = attachments.length - failures.length;

  if (captured === 0) {
    await record(
      db,
      message,
      "rejected",
      // **The reason a route gave, not the word this one chose.**
      // `unreadable` is true of everything here and explains nothing.
      failures.join(" · ").slice(0, 500) || "unreadable",
      source.id,
      attachments.length,
      0
    );
    if (messageId) {
      await finishRouteMessage(db, messageId, {
        status: "failed",
        failedPart: "translation",
        errorCode: "unreadable",
        errorText: failures.join(" · ") || "No attachment could be read as an invoice.",
      });
    }
    message.setReject("The attached file could not be read as an invoice.");
    return messageId;
  }

  await record(db, message, "captured", null, source.id, attachments.length, captured);
  if (messageId) await finishRouteMessage(db, messageId, { status: failures.length > 0 ? "partial" : "delivered" });
  await markReceiving(db, source.id);
  return messageId;
}

/**
 * The message's subject, for the monitor to list it by. Headers only:
 * the first blank line ends them. Folded lines are joined, and an
 * encoded subject is shown as sent rather than decoded here.
 */
function subjectOf(raw: string): string | null {
  const headerEnd = raw.search(/\r?\n\r?\n/);
  const headers = (headerEnd === -1 ? raw : raw.slice(0, headerEnd)).replace(/\r?\n[ \t]+/g, " ");
  const subject = headers.match(/^subject:[ \t]*(.*)$/im)?.[1]?.trim();
  return subject ? subject.slice(0, 300) : null;
}

/**
 * What has arrived by email, most recent first — decision 0147.
 *
 * **The customer's own answer to "did our invoice arrive".** Today that
 * question can only be answered from Cloudflare's activity log, which
 * is the operator's and not theirs.
 */
export async function handleListInboundEmail(
  db: D1Database,
  limit: number
): Promise<{ status: number; body: Record<string, unknown> }> {
  const rows = await db
    .prepare(
      `SELECT e.id, e.sender, e.recipient, e.outcome, e.reason,
              e.attachments, e.captured, e.occurred_at, s.name AS source_name
       FROM inbound_email_events e
       LEFT JOIN sources s ON s.id = e.source_id
       ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`
    )
    .bind(Math.min(Math.max(limit, 1), 200))
    .all<{
      id: string;
      sender: string;
      recipient: string;
      outcome: string;
      reason: string | null;
      attachments: number;
      captured: number;
      occurred_at: string;
      source_name: string | null;
    }>();

  return {
    status: 200,
    body: {
      arrivals: rows.results.map((r) => ({
        id: r.id,
        sender: r.sender,
        recipient: r.recipient,
        // Null where no source claimed the address, which is the entry
        // worth noticing rather than hiding.
        sourceName: r.source_name,
        outcome: r.outcome,
        // A code, not a sentence — the words are the interface's
        // (decision 0132).
        reason: r.reason,
        attachments: r.attachments,
        captured: r.captured,
        occurredAt: r.occurred_at,
      })),
    },
  };
}
