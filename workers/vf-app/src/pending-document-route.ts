import type { RouteResult } from "./org-route.js";
import { extractInvoiceFromImages, sniffImageType, ExtractionRefusal, type ExtractionModel } from "./extraction.js";
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
  bytes: Uint8Array
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

  const count = await db
    .prepare("SELECT count(*) AS n FROM pending_document_pages WHERE pending_document_id = ?")
    .bind(documentId)
    .first<{ n: number }>();

  return { status: 200, body: { documentId, pageNumber, pageCount: count?.n ?? 0 } };
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
