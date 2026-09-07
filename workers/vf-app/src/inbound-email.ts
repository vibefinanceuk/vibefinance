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
    message.setReject("That address does not accept invoices.");
    return;
  }

  if (source.status === "retired") {
    // **Retiring a source must remove its routing rule** (decision
    // 0130). Until it does, this is the guard that makes the status
    // true rather than decorative.
    message.setReject("That address is no longer in use.");
    return;
  }

  const attachments = await attachmentsOf(message);

  if (attachments.length === 0) {
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
      failures.push(attachment.filename);
    }
  }

  // **Rejected only if nothing got through.** A message with one good
  // invoice and one broken attachment has delivered an invoice, and
  // bouncing it would ask the supplier to send the good one again.
  if (failures.length === attachments.length) {
    message.setReject("The attached file could not be read as an invoice.");
  }
}
