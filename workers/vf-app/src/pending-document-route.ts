import type { RouteResult } from "./org-route.js";
import {
  extractInvoiceFromImage,
  extractInvoiceFromImages,
  sniffImageType,
  ExtractionRefusal,
  type ExtractionModel,
  type ExtractionResult,
} from "./extraction.js";
import type { VocabularyInput } from "@vibefinance/shared";
import { loadExtractionSettings } from "./extraction-settings.js";
import { looksLikePdf } from "./pdf-attachment.js";

/**
 * Multi-page invoice capture.
 *
 * Pages arrive separately, accumulate against a pending document, and
 * are extracted together only when the operator says the document is
 * complete. That pairing is deliberate: a scanner feeding pages one
 * at a time, or a mail integration receiving attachments separately,
 * cannot hand over a complete document in one request — but a model
 * asked to read half an invoice will report exactly what it can see
 * and nothing about what it cannot.
 *
 * The freight invoice that prompted this has its charge lines on page
 * one and its totals on page two. Submitted alone, page one produced
 * a correct extraction of everything printed there and an honest "no
 * total stated" — correct, and useless, because the totals existed.
 *
 * Extraction happens in ONE model call across all pages, in order.
 * See extractInvoiceFromImages for why merging per-page results would
 * be worse.
 */

export interface PendingDocumentStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

interface PendingDocumentRow {
  id: string;
  channel_id: string;
  status: string;
  invoice_id: string | null;
}

export async function handleCreatePendingDocument(
  db: D1Database,
  channelId: string
): Promise<RouteResult> {
  const channel = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(channelId).first();
  if (!channel) {
    return { status: 404, body: { error: `intake channel ${channelId} does not exist` } };
  }
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO pending_documents (id, channel_id) VALUES (?, ?)").bind(id, channelId).run();
  return {
    status: 201,
    body: {
      id,
      channelId,
      status: "open",
      message: "Upload each page with PUT /pending-documents/:id/pages/:pageNumber, then POST .../finalise.",
    },
  };
}

/**
 * Uploads one page. Idempotent by page number: re-uploading page 1
 * replaces it rather than adding a second copy, so a retry after a
 * network failure cannot make the model read the same page twice.
 */
export async function handleUploadPage(
  db: D1Database,
  storage: PendingDocumentStorage,
  documentId: string,
  pageNumber: number,
  bytes: Uint8Array,
  // Optional so every existing caller and test keeps working. When
  // supplied, the page is extracted HERE, in its own request —
  // decision 0047.
  model?: ExtractionModel,
  vocabulary?: VocabularyInput
): Promise<RouteResult> {
  if (!Number.isInteger(pageNumber) || pageNumber < 1) {
    return { status: 400, body: { error: "page number must be a whole number of 1 or more" } };
  }

  const doc = await db
    .prepare("SELECT id, channel_id, status, invoice_id FROM pending_documents WHERE id = ?")
    .bind(documentId)
    .first<PendingDocumentRow>();
  if (!doc) {
    return { status: 404, body: { error: `pending document ${documentId} does not exist` } };
  }
  if (doc.status !== "open") {
    // Adding a page to an already-extracted document would leave the
    // stored invoice describing a page set that no longer matches.
    return {
      status: 409,
      body: { error: `this document was already finalised as invoice ${doc.invoice_id}; start a new one` },
    };
  }

  if (looksLikePdf(bytes)) {
    return {
      status: 422,
      body: {
        error:
          "this is a PDF, not an image — submit it to /capture-pdf, which checks for an embedded invoice before reading anything as a picture",
      },
    };
  }
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return { status: 422, body: { error: "unsupported image format — expected JPEG, PNG or WebP" } };
  }

  const key = `pending/${documentId}/page-${pageNumber}`;
  await storage.put(key, bytes, contentType);
  // Uploaded to storage BEFORE the row is written, matching decision
  // 0035: a row pointing at an object that failed to store would be a
  // page the finaliser cannot read.
  await db
    .prepare(
      `INSERT INTO pending_document_pages (id, pending_document_id, page_number, r2_key, content_type)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (pending_document_id, page_number)
       DO UPDATE SET r2_key = excluded.r2_key, content_type = excluded.content_type, uploaded_at = datetime('now')`
    )
    .bind(crypto.randomUUID(), documentId, pageNumber, key, contentType)
    .run();

  // Extraction happens here, in this page's own request — decision
  // 0047. Established by a controlled test: page 1 alone through this
  // path extracts perfectly, while page 1 followed by page 2 times
  // out on page 1, which runs first. A single Worker request cannot
  // reliably make two large inference calls, so it no longer tries.
  //
  // A failed extraction does NOT fail the upload. The page is stored
  // either way, the reason is recorded, and the document can still be
  // finalised from whatever else was read — a page that could not be
  // extracted is a gap to explain, not a reason to reject bytes that
  // arrived intact.
  let extractionStatus: Record<string, unknown> = {};
  if (model) {
    try {
      // Settings come from the document's OWN channel rather than
      // from the caller (decision 0056). handleUploadPage already
      // loaded the row to check status, so the channel is in hand —
      // asking the caller to supply them would mean every caller
      // querying for a channel this function already knows.
      const settings = await loadExtractionSettings(db, doc.channel_id);
      const result = await extractInvoiceFromImage(model, bytes, vocabulary ?? "invoice", settings);
      await db
        .prepare(
          "UPDATE pending_document_pages SET extraction_json = ?, extraction_error = NULL, extracted_at = datetime('now') WHERE pending_document_id = ? AND page_number = ?"
        )
        .bind(JSON.stringify(result), documentId, pageNumber)
        .run();
      extractionStatus = { extracted: true, lineCount: result.lines.length, confidence: result.confidence };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      await db
        .prepare(
          "UPDATE pending_document_pages SET extraction_json = NULL, extraction_error = ?, extracted_at = datetime('now') WHERE pending_document_id = ? AND page_number = ?"
        )
        .bind(reason, documentId, pageNumber)
        .run();
      // Reported on the upload that caused it, where it is
      // attributable, rather than surfacing later at finalise
      // detached from the page that produced it.
      extractionStatus = { extracted: false, extractionError: reason };
    }
  }

  const count = await db
    .prepare("SELECT count(*) AS n FROM pending_document_pages WHERE pending_document_id = ?")
    .bind(documentId)
    .first<{ n: number }>();

  return { status: 200, body: { documentId, pageNumber, pageCount: count?.n ?? 0, ...extractionStatus } };
}

export async function handleListPendingDocument(db: D1Database, documentId: string): Promise<RouteResult> {
  const doc = await db
    .prepare("SELECT id, channel_id, status, invoice_id, created_at, finalised_at FROM pending_documents WHERE id = ?")
    .bind(documentId)
    .first<PendingDocumentRow & { created_at: string; finalised_at: string | null }>();
  if (!doc) {
    return { status: 404, body: { error: `pending document ${documentId} does not exist` } };
  }
  const pages = await db
    .prepare("SELECT page_number, content_type, uploaded_at FROM pending_document_pages WHERE pending_document_id = ? ORDER BY page_number")
    .bind(documentId)
    .all<{ page_number: number; content_type: string; uploaded_at: string }>();

  return {
    status: 200,
    body: {
      id: doc.id,
      channelId: doc.channel_id,
      status: doc.status,
      invoiceId: doc.invoice_id,
      createdAt: doc.created_at,
      finalisedAt: doc.finalised_at,
      pages: pages.results.map((p) => ({
        pageNumber: p.page_number,
        contentType: p.content_type,
        uploadedAt: p.uploaded_at,
      })),
    },
  };
}

export interface FinaliseResult {
  pages: Uint8Array[];
  channelId: string;
}

/**
 * Loads every page in document order, ready for extraction.
 *
 * Refuses on a gap in the page numbers. A document with pages 1 and 3
 * is missing page 2, and extracting it would silently produce an
 * invoice from an incomplete document — which is precisely the
 * failure multi-page support exists to fix, reintroduced in a form
 * that is harder to notice.
 */
export async function loadPendingPages(
  db: D1Database,
  storage: PendingDocumentStorage,
  documentId: string
): Promise<{ ok: true; result: FinaliseResult } | { ok: false; response: RouteResult }> {
  const doc = await db
    .prepare("SELECT id, channel_id, status, invoice_id FROM pending_documents WHERE id = ?")
    .bind(documentId)
    .first<PendingDocumentRow>();
  if (!doc) {
    return { ok: false, response: { status: 404, body: { error: `pending document ${documentId} does not exist` } } };
  }
  if (doc.status !== "open") {
    return {
      ok: false,
      response: {
        status: 409,
        body: { error: `this document was already finalised as invoice ${doc.invoice_id}` },
      },
    };
  }

  const rows = await db
    .prepare("SELECT page_number, r2_key FROM pending_document_pages WHERE pending_document_id = ? ORDER BY page_number")
    .bind(documentId)
    .all<{ page_number: number; r2_key: string }>();
  if (rows.results.length === 0) {
    return { ok: false, response: { status: 422, body: { error: "this document has no pages yet" } } };
  }

  const numbers = rows.results.map((r) => r.page_number);
  const expected = numbers.map((_, i) => i + 1);
  if (JSON.stringify(numbers) !== JSON.stringify(expected)) {
    return {
      ok: false,
      response: {
        status: 422,
        body: {
          error: `pages must run 1..n with no gaps; got ${numbers.join(", ")}`,
          detail:
            "extracting a document with a missing page would silently produce an invoice from an incomplete document",
        },
      },
    };
  }

  const pages: Uint8Array[] = [];
  for (const row of rows.results) {
    const bytes = await storage.get(row.r2_key);
    if (!bytes) {
      return {
        ok: false,
        response: { status: 500, body: { error: `page ${row.page_number} could not be read back from storage` } },
      };
    }
    pages.push(bytes);
  }

  return { ok: true, result: { pages, channelId: doc.channel_id } };
}

export async function markFinalised(db: D1Database, documentId: string, invoiceId: string): Promise<void> {
  await db
    .prepare("UPDATE pending_documents SET status = 'finalised', invoice_id = ?, finalised_at = datetime('now') WHERE id = ?")
    .bind(invoiceId, documentId)
    .run();
}

export { extractInvoiceFromImages, ExtractionRefusal };
export type { ExtractionModel };


/**
 * Loads the extraction results already stored against each page —
 * decision 0047.
 *
 * Finalise makes no model call at all now. Every page was extracted
 * in its own request at upload time, so this is a database read and a
 * merge: fast, deterministic, and repeatable without re-running
 * inference over a document that has not changed.
 */
export async function loadPageExtractions(
  db: D1Database,
  documentId: string
): Promise<{
  perPage: { page: number; result: ExtractionResult }[];
  failedPages: { page: number; reason: string }[];
  unextracted: number[];
}> {
  const rows = await db
    .prepare(
      `SELECT page_number, extraction_json, extraction_error
       FROM pending_document_pages
       WHERE pending_document_id = ?
       ORDER BY page_number`
    )
    .bind(documentId)
    .all<{ page_number: number; extraction_json: string | null; extraction_error: string | null }>();

  const perPage: { page: number; result: ExtractionResult }[] = [];
  const failedPages: { page: number; reason: string }[] = [];
  // Pages uploaded before this behaviour existed, or uploaded with no
  // model available. Tracked separately from failures: "never
  // attempted" and "attempted and failed" are different states, and
  // reporting the first as the second would misattribute a
  // configuration gap to the model.
  const unextracted: number[] = [];

  for (const row of rows.results) {
    if (row.extraction_error !== null) {
      failedPages.push({ page: row.page_number, reason: row.extraction_error });
    } else if (row.extraction_json !== null) {
      perPage.push({ page: row.page_number, result: JSON.parse(row.extraction_json) as ExtractionResult });
    } else {
      unextracted.push(row.page_number);
    }
  }

  return { perPage, failedPages, unextracted };
}
