import type { RouteResult } from "./org-route.js";
import { computeDocumentKey, storeInvoiceDocument, retrieveInvoiceDocument, type DocumentType } from "./document-storage.js";

function isDocumentType(value: string | null): value is DocumentType {
  return value === "original" || value === "generated_rendering";
}

function extFromContentType(contentType: string): string {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("xml")) return "xml";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  return "bin"; // an honest, generic fallback rather than guessing wrong
}

/**
 * Real document upload — decision 0035. Deliberately requires the
 * invoice to already exist (invoice_documents.invoice_id is a real
 * foreign key) rather than accepting an upload for an invoice id that
 * was never captured; matches the same discipline as every other
 * real foreign key in this project — a document is retained *for* a
 * real invoice, never a standalone blob with nothing to anchor it.
 */
export async function handleUploadDocument(
  db: D1Database,
  bucket: R2Bucket | undefined,
  customerId: string | undefined,
  invoiceId: string,
  documentTypeParam: string | null,
  contentType: string | null,
  bytes: ArrayBuffer
): Promise<RouteResult> {
  if (!bucket) {
    return { status: 500, body: { error: "No DOCUMENTS binding configured for this customer" } };
  }
  if (!customerId) {
    return { status: 500, body: { error: "CUSTOMER_ID not configured" } };
  }
  const documentType = documentTypeParam ?? "original";
  if (!isDocumentType(documentType)) {
    return { status: 400, body: { error: `documentType must be 'original' or 'generated_rendering', got '${documentType}'` } };
  }
  if (!contentType) {
    return { status: 400, body: { error: "content-type header is required" } };
  }

  const invoice = await db
    .prepare("SELECT id, issue_date FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ id: string; issue_date: string | null }>();
  if (!invoice) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }

  const key = computeDocumentKey(customerId, invoiceId, extFromContentType(contentType), invoice.issue_date ?? undefined);

  try {
    const result = await storeInvoiceDocument(bucket, db, { invoiceId, documentType, contentType, key, bytes });
    return { status: 201, body: { id: result.id, invoiceId: result.invoiceId, documentType: result.documentType, r2Key: result.r2Key } };
  } catch (err) {
    // The real UNIQUE(invoice_id, document_type) constraint firing —
    // a document of this type already exists for this invoice.
    // Reported as a clean 409, not an unhandled 500 — the same
    // discipline as every other real constraint in this project.
    return {
      status: 409,
      body: { error: `a ${documentType} document already exists for invoice ${invoiceId}`, detail: String(err) },
    };
  }
}

/**
 * Real document retrieval — returns the raw bytes and content type,
 * or a clean 404 for either genuine absence case (never captured, or
 * a real reference with no matching R2 object) — retrieveInvoiceDocument
 * itself doesn't distinguish the two, and neither does this route;
 * both mean "nothing retrievable right now."
 */
export async function handleRetrieveDocument(
  db: D1Database,
  bucket: R2Bucket | undefined,
  invoiceId: string,
  documentTypeParam: string | null
): Promise<{ status: number; bytes?: ArrayBuffer; contentType?: string; errorBody?: unknown }> {
  if (!bucket) {
    return { status: 500, errorBody: { error: "No DOCUMENTS binding configured for this customer" } };
  }
  const documentType = documentTypeParam ?? "original";
  if (!isDocumentType(documentType)) {
    return { status: 400, errorBody: { error: `documentType must be 'original' or 'generated_rendering', got '${documentType}'` } };
  }

  const doc = await retrieveInvoiceDocument(bucket, db, invoiceId, documentType);
  if (!doc) {
    return { status: 404, errorBody: { error: `no ${documentType} document found for invoice ${invoiceId}` } };
  }
  return { status: 200, bytes: doc.bytes, contentType: doc.contentType };
}
