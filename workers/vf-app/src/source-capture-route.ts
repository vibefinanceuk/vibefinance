import type { RouteResult } from "./org-route.js";
import { detectStructure, summariseAttempts, type DetectedStructure } from "./detect-structure.js";
import { handleCaptureIntake, handleCaptureImage, handleCaptureUblXml } from "./intake-capture-route.js";
import type { ExtractionModel } from "./extraction.js";
import { parseUblInvoice, UblParseError } from "@vibefinance/shared";
import {
  storeInvoiceDocument,
  computeDocumentKey,
  contentTypeForDetection,
  extForContentType,
} from "./document-storage.js";

/**
 * Capture addressed to a SOURCE — decision 0063.
 *
 * The caller knows where a document arrived, not what it is. A mailbox
 * cannot choose between `capture-xml` and `capture-image`; it has an
 * attachment and nothing more. So one endpoint takes the bytes,
 * detection decides the structure (decision 0062), and the structural
 * channel for that structure handles it (decision 0061).
 *
 * The older channel-addressed endpoints still work. They bypass
 * detection entirely, which is the thing detection exists to prevent,
 * so they are transitional rather than an alternative — see the closing
 * section of decision 0063.
 */

interface SourceRow {
  id: string;
  process_id: string;
  name: string;
  /** The part of the enterprise this transport belongs to (0111). */
  default_org_unit_id: string | null;
}

interface ChannelRow {
  id: string;
}

async function channelFor(
  db: D1Database,
  processId: string,
  structure: DetectedStructure
): Promise<ChannelRow | null> {
  return db
    .prepare("SELECT id FROM intake_channels WHERE process_id = ? AND structure = ?")
    .bind(processId, structure)
    .first<ChannelRow>();
}

export interface RetentionOutcome {
  retained: boolean;
  /** Present when retained: what the document was stored as. */
  contentType?: string;
  /** Present when retained: where, so a caller can fetch it. */
  key?: string;
  /** Present when not: which of the failure modes this was. */
  reason?: string;
}

/**
 * Retains the document exactly as it arrived — decision 0068.
 *
 * Runs after capture rather than before, because
 * invoice_documents.invoice_id is a real foreign key and the invoice
 * does not exist until extraction has produced something to store it
 * against.
 *
 * A failure here does NOT fail the capture. Refusing would discard facts
 * that were successfully extracted, in exchange for bytes that are
 * already lost — the request body cannot be replayed. So the capture
 * stands and the failure becomes visible instead, as a fact a rule can
 * test.
 */
async function retainOriginal(
  bucket: R2Bucket | undefined,
  db: D1Database,
  customerId: string | undefined,
  invoiceId: string,
  bytes: Uint8Array,
  // The whole detection result, not just the structure — a PDF carrying
  // no embedded invoice has no structure and is still a PDF (0069).
  detection: { structure: DetectedStructure | null; attempted: readonly { test: string; outcome: string }[] },
  issueDate?: string
): Promise<RetentionOutcome> {
  if (!bucket) return { retained: false, reason: "no R2 bucket is bound" };
  if (!customerId) return { retained: false, reason: "CUSTOMER_ID is not configured" };

  const contentType = contentTypeForDetection(detection);
  const key = computeDocumentKey(customerId, invoiceId, extForContentType(contentType), issueDate);
  try {
    // Copied into a fresh buffer: the caller's view may be a subarray of
    // a larger allocation, and R2 would otherwise store the whole thing.
    const body = bytes.slice().buffer as ArrayBuffer;
    await storeInvoiceDocument(bucket, db, {
      invoiceId,
      documentType: "original",
      contentType,
      key,
      bytes: body,
    });
    // What was stored, not just that something was. Decision 0069 was a
    // mis-typed document that reported `retained: true` and could only
    // be caught by querying the stored row — the response said nothing
    // that would have given it away. Reporting the type makes the next
    // one visible where the caller is already looking.
    return { retained: true, contentType, key };
  } catch (err) {
    // UNIQUE(invoice_id, document_type) makes a second attempt for the
    // same invoice a real refusal rather than a silent overwrite
    // (decision 0035). Reported rather than swallowed.
    return { retained: false, reason: (err as Error).message };
  }
}

export async function handleCaptureFromSource(
  db: D1Database,
  sourceId: string,
  bytes: Uint8Array,
  model: ExtractionModel,
  idOverride?: string,
  bucket?: R2Bucket,
  customerId?: string
): Promise<RouteResult> {
  const source = await db
    .prepare("SELECT id, process_id, name, default_org_unit_id FROM sources WHERE id = ?")
    .bind(sourceId)
    .first<SourceRow>();
  if (!source) {
    return { status: 404, body: { error: `source ${sourceId} does not exist` } };
  }
  if (bytes.length === 0) {
    return { status: 400, body: { error: "a document body is required" } };
  }

  const detection = await detectStructure(bytes);
  const attempted = summariseAttempts(detection.attempted);

  if (detection.structure === null) {
    // Not an error. An undetectable document is an invoice with no
    // facts, which reaches Validation and waits for a person to key it
    // or reject it (decision 0055 section 7).
    return captureWithoutFacts(db, source, attempted, detection.attempted, bytes, idOverride, bucket, customerId);
  }

  const channel = await channelFor(db, source.process_id, detection.structure);
  if (!channel) {
    // The structure was recognised and this process has no channel for
    // it. A configuration gap rather than a document problem, and said
    // so plainly: silently falling back to another channel would read
    // the document under rules nobody configured for it.
    return {
      status: 422,
      body: {
        error: `process ${source.process_id} has no ${detection.structure} intake channel`,
        detail: "detection recognised the document; no channel is configured to handle it",
        intake: { structure: detection.structure, attempted },
      },
    };
  }

  // Dispatch. Each branch delegates to the handler that already exists
  // and is already proven — this route decides WHICH, and adds no
  // extraction logic of its own.
  let result: RouteResult;
  if (detection.structure === "structured_pdfa") {
    // The embedded XML is already in hand from detection, so it is
    // parsed here rather than extracted a second time.
    result = await capturePreExtractedXml(db, channel.id, detection.embeddedXml as string, attempted, idOverride);
  } else if (detection.structure === "structured_xml") {
    result = await handleCaptureUblXml(db, channel.id, new TextDecoder().decode(bytes), idOverride);
  } else {
    result = await handleCaptureImage(db, channel.id, bytes, model, idOverride);
  }

  if (result.status >= 400) return result;

  // Every successful branch converges here, so no structure can acquire
  // a retention gap later without also bypassing the response shape.
  const invoiceId = (result.body as { id?: string }).id;

  /**
   * The source's default org — decision 0111.
   *
   * The deterministic answer for a customer running one mailbox per
   * part of the enterprise, and the fallback when a document says
   * nothing readable. **A rule that fires later overwrites it**, being
   * the customer's own more specific decision.
   *
   * Applied here rather than in the invoice writer because a source is
   * a transport concern: the writer serves every path, and most have no
   * source at all.
   */
  if (invoiceId && source.default_org_unit_id) {
    await db
      .prepare(
        "UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'source' WHERE id = ? AND org_unit_id IS NULL"
      )
      .bind(source.default_org_unit_id, invoiceId)
      .run();
  }

  const retention = invoiceId
    ? await retainOriginal(bucket, db, customerId, invoiceId, bytes, detection)
    : { retained: false, reason: "the handler returned no invoice id" };

  return withIntakeFacts(result, detection.structure, attempted, retention);
}

/**
 * Reports what detection concluded alongside whatever the handler
 * returned, so a caller can see which path a document took without
 * inferring it from the shape of the response.
 */
function withIntakeFacts(
  result: RouteResult,
  structure: string,
  attempted: string,
  retention?: RetentionOutcome
): RouteResult {
  if (result.status >= 400) return result;
  return {
    status: result.status,
    body: {
      ...(result.body as Record<string, unknown>),
      intake: { structure, attempted },
      ...(retention === undefined ? {} : { document: retention }),
    },
  };
}

async function capturePreExtractedXml(
  db: D1Database,
  channelId: string,
  xml: string,
  attempted: string,
  idOverride?: string
): Promise<RouteResult> {
  let parsed;
  try {
    parsed = parseUblInvoice(xml);
  } catch (err) {
    if (err instanceof UblParseError) {
      // The PDF declared an embedded invoice, detection extracted it,
      // and it is not a UBL invoice. Distinct from an unreadable
      // attachment, and worth saying which.
      return {
        status: 422,
        body: {
          error: `the embedded invoice could not be parsed: ${err.message}`,
          intake: { structure: "structured_pdfa", attempted },
        },
      };
    }
    throw err;
  }

  const result = await handleCaptureIntake(db, channelId, {
    id: idOverride ?? crypto.randomUUID(),
    facts: {
      ...parsed.facts,
      "intake.structure": "structured_pdfa",
      "intake.attempted": attempted,
    },
    lines: parsed.lines,
  } as Parameters<typeof handleCaptureIntake>[2]);
  return withIntakeFacts(result, "structured_pdfa", attempted);
}

/**
 * An undetectable document, captured with provenance and nothing else.
 *
 * The invoice row carries no Business Terms at all — there was nothing
 * to read — but it does carry which detection tests were tried. That is
 * what lets it enter a process instance, reach Validation, and have a
 * rule raise a task: a refusal that produces no facts has nowhere to go,
 * because no instance means no rule can fire.
 */
async function captureWithoutFacts(
  db: D1Database,
  source: SourceRow,
  attempted: string,
  detail: readonly { test: string; outcome: string }[],
  bytes: Uint8Array,
  idOverride?: string,
  bucket?: R2Bucket,
  customerId?: string
): Promise<RouteResult> {
  // Any structural channel of this process will do as the row's home:
  // the document has no structure, and the alternative is inventing a
  // fourth channel meaning "none", which would exist only to hold
  // failures. Preferring the image channel is deliberate — it is where
  // a keyed-from-image document would end up once keying exists.
  const channel =
    (await channelFor(db, source.process_id, "image")) ??
    (await db
      .prepare("SELECT id FROM intake_channels WHERE process_id = ? ORDER BY structure IS NULL, id LIMIT 1")
      .bind(source.process_id)
      .first<ChannelRow>());
  if (!channel) {
    return {
      status: 422,
      body: { error: `process ${source.process_id} has no intake channel at all` },
    };
  }

  const result = await handleCaptureIntake(db, channel.id, {
    id: idOverride ?? crypto.randomUUID(),
    mandateChannel: source.name,
    facts: {
      // Empty rather than absent: a rule testing `intake.structure is ""`
      // is how an undetectable document reaches somebody, and an absent
      // field cannot be tested for.
      "intake.structure": "",
      "intake.attempted": attempted,
    },
  } as Parameters<typeof handleCaptureIntake>[2]);

  if (result.status >= 400) return result;

  // Retention matters MOST here. A document nothing could read is one
  // where the original is the only record of what arrived — there are no
  // facts standing in for it.
  const invoiceId = (result.body as { id?: string }).id;

  /**
   * The source's default org — decision 0111.
   *
   * The deterministic answer for a customer running one mailbox per
   * part of the enterprise, and the fallback when a document says
   * nothing readable. **A rule that fires later overwrites it**, being
   * the customer's own more specific decision.
   *
   * Applied here rather than in the invoice writer because a source is
   * a transport concern: the writer serves every path, and most have no
   * source at all.
   */
  if (invoiceId && source.default_org_unit_id) {
    await db
      .prepare(
        "UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'source' WHERE id = ? AND org_unit_id IS NULL"
      )
      .bind(source.default_org_unit_id, invoiceId)
      .run();
  }

  const retention = invoiceId
    ? await retainOriginal(bucket, db, customerId, invoiceId, bytes, { structure: null, attempted: detail })
    : { retained: false, reason: "the handler returned no invoice id" };

  return {
    status: result.status,
    body: {
      ...(result.body as Record<string, unknown>),
      document: retention,
      intake: {
        structure: null,
        attempted,
        // The full outcomes, not just the test names: "a PDF with no
        // embedded invoice" and "a PDF declaring one that could not be
        // read" are opposite conversations.
        detail,
      },
    },
  };
}
