/**
 * R2 document retention — see docs/decisions/0013-r2-document-
 * retention.md and docs/decisions/0035-r2-document-storage.md.
 * D1 (invoice_documents) holds a reference; the object's own bytes
 * live only in R2, accessed through the DOCUMENTS binding.
 *
 * Genuinely tested against a real, local R2 simulation (Miniflare),
 * not mocked — R2 has the same kind of local-simulation equivalent
 * D1 has always had in this project; unlike the `ai` binding, no
 * live Cloudflare credentials are needed just to exercise this.
 */

export type DocumentType = "original" | "generated_rendering";

/**
 * The real key structure decision 0013 specified:
 * {customer}/{year}/{invoice_id}.{ext} — never keyed by invoice_run_id
 * (decision 0013's own Correction 1: an invoice can have more than
 * one run against it; the document is a property of the invoice, not
 * of any individual evaluation attempt). year is derived from the
 * caller-supplied issue date when available, falling back to the
 * current date only when it genuinely isn't — an invoice's own
 * retention year should reflect when it was issued, not when this
 * function happened to run.
 */
export function computeDocumentKey(customerId: string, invoiceId: string, ext: string, issueDate?: string): string {
  const year = issueDate && /^\d{4}-\d{2}-\d{2}/.test(issueDate) ? issueDate.slice(0, 4) : new Date().getUTCFullYear().toString();
  return `${customerId}/${year}/${invoiceId}.${ext}`;
}

export interface StoreDocumentParams {
  invoiceId: string;
  documentType: DocumentType;
  contentType: string;
  key: string;
  bytes: ArrayBuffer | ReadableStream;
}

export interface StoreDocumentResult {
  id: string;
  invoiceId: string;
  documentType: DocumentType;
  r2Key: string;
}

/**
 * Uploads to R2 first, then records the D1 reference — deliberately
 * in that order. D1 and R2 are separate systems with no real
 * cross-system transaction; if the ordering were reversed and the R2
 * upload failed after the D1 row was written, the reference would
 * point at an object that was never actually stored — a broken
 * reference. This ordering's own failure mode is strictly safer: an
 * orphaned R2 object with no D1 reference is wasted storage, not a
 * false promise that a document exists.
 *
 * UNIQUE(invoice_id, document_type) in the schema means a second call
 * for the same invoice and document type is a real, structural
 * refusal (SQLITE_CONSTRAINT), not silently overwritten — replacing
 * an already-retained document is a real decision this function
 * deliberately doesn't make on the caller's behalf.
 */
export async function storeInvoiceDocument(
  bucket: R2Bucket,
  db: D1Database,
  params: StoreDocumentParams
): Promise<StoreDocumentResult> {
  await bucket.put(params.key, params.bytes, {
    httpMetadata: { contentType: params.contentType },
  });

  const id = crypto.randomUUID();
  await db
    .prepare("INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES (?, ?, ?, ?, ?)")
    .bind(id, params.invoiceId, params.key, params.documentType, params.contentType)
    .run();

  return { id, invoiceId: params.invoiceId, documentType: params.documentType, r2Key: params.key };
}

export interface RetrievedDocument {
  bytes: ArrayBuffer;
  contentType: string;
  r2Key: string;
}

/**
 * Looks up the real D1 reference first, then fetches from R2 — the
 * reverse order from storing, and deliberately so: a caller asking
 * for a document that was never recorded should get a clean "not
 * found" from the reference lookup, not an R2 round trip for a key
 * that was never real in the first place.
 *
 * Returns null, not a thrown error, when either the D1 reference or
 * the R2 object itself is missing — a genuinely absent document is an
 * expected, ordinary outcome for a caller to handle, not a crash. The
 * two absence cases are distinguished only by which layer reported
 * it; a caller doesn't need to know which, since both mean "there is
 * no retrievable document right now."
 */
export async function retrieveInvoiceDocument(
  bucket: R2Bucket,
  db: D1Database,
  invoiceId: string,
  documentType: DocumentType
): Promise<RetrievedDocument | null> {
  const row = await db
    .prepare("SELECT r2_key, content_type FROM invoice_documents WHERE invoice_id = ? AND document_type = ?")
    .bind(invoiceId, documentType)
    .first<{ r2_key: string; content_type: string }>();
  if (!row) return null;

  const object = await bucket.get(row.r2_key);
  if (!object) return null;

  return { bytes: await object.arrayBuffer(), contentType: row.content_type, r2Key: row.r2_key };
}
