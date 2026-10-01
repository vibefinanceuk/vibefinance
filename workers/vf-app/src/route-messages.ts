/**
 * **Route messages — decision 0555**, slice 1 of
 * `docs/design/routes-phase1-data-model.md`: store first.
 *
 * Every message that arrives on a Source is recorded, and its original
 * is stored **before anything reads it**. Until now a document was kept
 * only once an invoice existed to hang it from (decision 0068), so a
 * message that failed before that point left nothing behind: the
 * supplier got a bounce and the customer had nothing to look at.
 *
 * **D1 for what happened, R2 for the bytes.** Each store does the job it
 * is built for. D1 holds small rows: what the message was, from whom,
 * what became of it, and where its files are. R2 holds the files, once
 * each. No file, rendering or extracted text is written to D1, which
 * keeps the database small and fast however much mail arrives; R2 is
 * where the volume goes, and it is priced and sized for exactly that.
 *
 * **Once each, not twice.** An attachment that becomes an invoice is
 * not uploaded again for the invoice: its `invoice_documents` row points
 * at the message part's own R2 object (see `retainOriginal`). The only
 * new bytes this slice adds are the email itself.
 *
 * **Recording never stops receiving.** Every function here catches its
 * own failures, for the reason `record` in `inbound-email.ts` gives:
 * bouncing an invoice because a note about it could not be written
 * would lose the document to protect the note.
 */

export type RouteMessageStatus = "received" | "delivered" | "partial" | "failed" | "dismissed";
export type RoutePart = "gateway" | "format" | "translation" | "delivery";
export type PartRole = "original" | "attachment" | "translated" | "sent" | "reply";

/** Where a message part was stored, for the invoice it becomes to point at. */
export interface StoredPart {
  routeMessageId: string;
  partSeq: number;
  r2Key: string;
}

/**
 * A reference a person can read out: `MSG-7F3A-2291-0C4E`.
 *
 * The same value is the primary key, so the reference an IT team quotes
 * is the row itself, with nothing to look up in between.
 */
export function newMessageId(): string {
  const hex = crypto.randomUUID().replace(/-/g, "").toUpperCase();
  return `MSG-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}`;
}

/**
 * A file name safe inside an R2 key: letters, digits, dot, dash and
 * underscore, at most 100 characters. The name as sent is kept in D1.
 */
export function safeFilename(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_").slice(-100);
  return cleaned.length > 0 && !/^\.+$/.test(cleaned) ? cleaned : "file";
}

/**
 * `{customer}/routes/{source}/{yyyy}/{mm}/{message}/{seq}-{file}`.
 *
 * **Under the customer, beside the invoices**, so the jurisdiction and
 * retention rules that already apply to the bucket (decisions 0033,
 * 0077) apply here too. By month of arrival, because a message is dated
 * by when it came, not by the invoice date inside it that it may never
 * have yielded.
 */
export function routePartKey(
  customerId: string,
  instanceId: string,
  messageId: string,
  receivedAt: string,
  seq: number,
  filename: string
): string {
  const year = receivedAt.slice(0, 4);
  const month = receivedAt.slice(5, 7);
  return `${customerId}/routes/${instanceId}/${year}/${month}/${messageId}/${seq}-${safeFilename(filename)}`;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Opens a message. Returns its id, or null when even that could not be written. */
export async function openRouteMessage(
  db: D1Database,
  params: {
    id?: string;
    instanceId: string | null;
    direction: "in" | "out";
    counterparty: string | null;
    recipient: string | null;
    subject: string | null;
    bytes: number;
    receivedAt: string;
  }
): Promise<string | null> {
  const id = params.id ?? newMessageId();
  try {
    await db
      .prepare(
        `INSERT INTO route_messages
           (id, instance_id, direction, status, counterparty, recipient, subject, bytes, received_at)
         VALUES (?, ?, ?, 'received', ?, ?, ?, ?, ?)`
      )
      .bind(
        id,
        params.instanceId,
        params.direction,
        params.counterparty,
        params.recipient,
        params.subject,
        params.bytes,
        params.receivedAt
      )
      .run();
    await addRouteEvent(db, id, "received", { detail: `${params.bytes} bytes` });
    return id;
  } catch {
    return null;
  }
}

/**
 * **Opens an outbound message — decision 0558.** On a Destination
 * instance (`destination_id`), never a source, as 0108's invariant
 * holds. Returns its id, or null when it could not be written.
 */
export async function openOutboundMessage(
  db: D1Database,
  params: {
    destinationId: string;
    erpExportId?: string | null;
    recipient: string | null;
    subject: string | null;
    bytes: number;
    receivedAt: string;
    actor?: string;
    /** Decision 0585: what opened it — an export ("exported", the default) or a delivery ("sending"). */
    event?: string;
  }
): Promise<string | null> {
  const id = newMessageId();
  try {
    await db
      .prepare(
        `INSERT INTO route_messages
           (id, destination_id, erp_export_id, direction, status, recipient, subject, bytes, received_at)
         VALUES (?, ?, ?, 'out', 'received', ?, ?, ?, ?)`
      )
      .bind(id, params.destinationId, params.erpExportId ?? null, params.recipient, params.subject, params.bytes, params.receivedAt)
      .run();
    await addRouteEvent(db, id, params.event ?? "exported", params.actor ? { actor: params.actor } : {});
    return id;
  } catch {
    return null;
  }
}

/**
 * Stores one part: R2 first, then the D1 row — decision 0035's order.
 *
 * A reference written before its object would point at nothing if the
 * upload failed; an object whose row failed is wasted space, not a
 * false promise. Returns where it went, or the reason it did not.
 */
export async function storeRoutePart(
  bucket: R2Bucket,
  db: D1Database,
  params: {
    messageId: string;
    seq: number;
    role: PartRole;
    filename: string;
    contentType: string;
    bytes: Uint8Array;
    key: string;
  }
): Promise<{ stored: StoredPart } | { reason: string }> {
  try {
    const sha = await sha256Hex(params.bytes);
    // A fresh buffer: the caller's view may be a slice of a larger one,
    // and R2 would otherwise store all of it.
    await bucket.put(params.key, params.bytes.slice().buffer as ArrayBuffer, {
      httpMetadata: { contentType: params.contentType },
      customMetadata: { routeMessageId: params.messageId, partSeq: String(params.seq) },
    });
    await db
      .prepare(
        `INSERT INTO route_message_parts
           (message_id, seq, role, filename, content_type, bytes, sha256, r2_key, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        params.messageId,
        params.seq,
        params.role,
        params.filename.slice(0, 255),
        params.contentType,
        params.bytes.length,
        sha,
        params.key,
        new Date().toISOString()
      )
      .run();
    return { stored: { routeMessageId: params.messageId, partSeq: params.seq, r2Key: params.key } };
  } catch (err) {
    return { reason: (err as Error).message || "the part could not be stored" };
  }
}

/** Appends to a message's history. Never throws. */
export async function addRouteEvent(
  db: D1Database,
  messageId: string,
  event: string,
  extra: { partSeq?: number; detail?: string; actor?: string } = {}
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT INTO route_message_events (message_id, seq, at, event, part_seq, detail, actor)
         SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?
         FROM route_message_events WHERE message_id = ?`
      )
      .bind(
        messageId,
        new Date().toISOString(),
        event,
        extra.partSeq ?? null,
        extra.detail?.slice(0, 1000) ?? null,
        extra.actor ?? null,
        messageId
      )
      .run();
  } catch {
    // Deliberately silent: see the module comment.
  }
}

/** What became of one attachment. Never throws. */
export async function setPartOutcome(
  db: D1Database,
  messageId: string,
  seq: number,
  outcome: "captured" | "failed" | "skipped",
  reason: string | null
): Promise<void> {
  try {
    await db
      .prepare("UPDATE route_message_parts SET outcome = ?, reason = ? WHERE message_id = ? AND seq = ?")
      .bind(outcome, reason?.slice(0, 500) ?? null, messageId, seq)
      .run();
  } catch {
    // Deliberately silent.
  }
}

/**
 * **Which format an attachment was, and what the checks found** —
 * decision 0560. Never throws: like the part's outcome, it describes
 * what happened and must not become a reason for it not to.
 */
export async function setPartFormat(
  db: D1Database,
  messageId: string,
  seq: number,
  read: {
    format: string;
    syntax: string | null;
    failed: ReadonlyArray<{ rule: string; detail?: string }> | null;
    /** Decision 0561: a supplier's own XML — its root, and the mapping that read it or tried to. */
    xmlRoot?: string | null;
    mappingId?: string | null;
    mappingVersion?: number | null;
    /** Decision 0563: why no mapping read it, where one came close. */
    mappingMiss?: "not_for_sender" | "not_published" | null;
  }
): Promise<void> {
  try {
    await db
      .prepare(
        `UPDATE route_message_parts SET format = ?, syntax = ?, en16931_failed = ?, xml_root = ?, mapping_id = ?, mapping_version = ?, mapping_miss = ?
         WHERE message_id = ? AND seq = ?`
      )
      .bind(
        read.format,
        read.syntax,
        read.failed === null ? null : JSON.stringify(read.failed),
        read.xmlRoot ?? null,
        read.mappingId ?? null,
        read.mappingVersion ?? null,
        read.mappingMiss ?? null,
        messageId,
        seq
      )
      .run();
  } catch {
    // Deliberately silent.
  }
}

/** Records the item a message made. Never throws. */
export async function linkRouteItem(
  db: D1Database,
  messageId: string,
  itemId: string,
  partSeq: number | null
): Promise<void> {
  try {
    await db
      .prepare(
        `INSERT OR IGNORE INTO route_message_items (message_id, item_type, item_id, part_seq)
         VALUES (?, 'invoice', ?, ?)`
      )
      .bind(messageId, itemId, partSeq)
      .run();
  } catch {
    // Deliberately silent.
  }
}

/**
 * Closes a message with its outcome. **A failure names the part that
 * failed**, so the monitor (slice 2) can say where to look: the
 * gateway (nothing claimed the address), the format (nothing an invoice
 * arrives as) or the translation (a file that could not be read).
 */
export async function finishRouteMessage(
  db: D1Database,
  messageId: string,
  outcome:
    | { status: "delivered" | "partial" }
    | { status: "failed"; failedPart: RoutePart; errorCode: string; errorText: string }
): Promise<void> {
  const failed = outcome.status === "failed" ? outcome : null;
  try {
    await db
      .prepare(
        `UPDATE route_messages
         SET status = ?, failed_part = ?, error_code = ?, error_text = ?, completed_at = ?
         WHERE id = ?`
      )
      .bind(
        outcome.status,
        failed?.failedPart ?? null,
        failed?.errorCode ?? null,
        failed?.errorText.slice(0, 1000) ?? null,
        new Date().toISOString(),
        messageId
      )
      .run();
    await addRouteEvent(db, messageId, outcome.status, failed ? { detail: failed.errorCode } : {});
  } catch {
    // Deliberately silent.
  }
}
