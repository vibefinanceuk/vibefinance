import { handleCaptureFromSource } from "./source-capture-route.js";
import type { ExtractionModel } from "./extraction.js";

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
async function attachmentsOf(
  message: EmailMessage
): Promise<{ filename: string; contentType: string; bytes: Uint8Array }[]> {
  const raw = await new Response(message.raw).text();

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

    const body = part.slice(headerEnd + 4).replace(/[\r\n]/g, "").replace(/-+$/, "");
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
export async function handleInboundEmail(
  message: EmailMessage,
  db: D1Database,
  model: ExtractionModel,
  bucket?: R2Bucket,
  customerId?: string
): Promise<void> {
  const source = await sourceFor(db, message.to);

  if (!source) {
    // An address a routing rule delivers to and no source claims. The
    // rule outliving its source is the shape decision 0130 warned of.
    //
    // **The case that has nowhere else to be recorded**: no source
    // means no `intake_capture_events` row either (decision 0055), so
    // without this the message leaves no trace on the customer's side
    // at all.
    await record(db, message, "rejected", "no_such_address", null);
    message.setReject("That address does not accept invoices.");
    return;
  }

  if (source.status === "retired") {
    await record(db, message, "rejected", "source_retired", source.id);
    // **Retiring a source must remove its routing rule** (decision
    // 0130). Until it does, this is the guard that makes the status
    // true rather than decorative.
    message.setReject("That address is no longer in use.");
    return;
  }

  const attachments = await attachmentsOf(message);

  if (attachments.length === 0) {
    await record(db, message, "rejected", "no_attachment", source.id);
    message.setReject(
      "No invoice was attached. Please attach the invoice as a PDF, XML or image."
    );
    return;
  }

  /**
   * **Every attachment, not the first.** A supplier sending three
   * invoices in one message has sent three invoices, and picking one
   * would lose two silently.
   */
  const failures: string[] = [];
  for (const attachment of attachments) {
    const result = await handleCaptureFromSource(
      db,
      source.id,
      attachment.bytes,
      model,
      undefined,
      bucket,
      customerId
    );
    if (result.status >= 400) {
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
      failures.push(why ? `${attachment.filename}: ${why}` : attachment.filename);
    }
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
    message.setReject("The attached file could not be read as an invoice.");
    return;
  }

  await record(db, message, "captured", null, source.id, attachments.length, captured);
  await markReceiving(db, source.id);
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
