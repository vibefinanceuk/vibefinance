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
/**
 * The content type a captured document should be stored under, given
 * everything detection concluded — decision 0069.
 *
 * Takes the **whole detection result**, not just the structure. The
 * structure answers "which handler reads this", and a document can fail
 * that question while detection still knows perfectly well what the file
 * is: a PDF carrying no embedded invoice has no structure this system
 * can extract from, and is unambiguously still a PDF.
 *
 * Deriving the type from the structure alone stored exactly that
 * document as `application/octet-stream` under a `.bin` key — bytes
 * retained correctly and typed wrongly, so nothing downstream could know
 * to render it. Found by checking the stored row rather than trusting
 * the `retained: true` the capture reported.
 *
 * Never from a caller's declared content type or a filename, both of
 * which can be wrong — and under decision 0060 a mailbox attachment
 * carries whatever content type the sender's mail client decided to put
 * on it.
 */
export function contentTypeForDetection(detection: {
  structure: string | null;
  attempted: readonly { test: string; outcome: string }[];
}): string {
  if (detection.structure === "structured_pdfa") return "application/pdf";
  if (detection.structure === "structured_xml") return "application/xml";

  const outcomeOf = (test: string) => detection.attempted.find((a) => a.test === test)?.outcome;

  if (detection.structure === "image") {
    // The sniffed type, which is more specific than "an image".
    const sniffed = outcomeOf("image_magic_bytes");
    return sniffed && sniffed.startsWith("image/") ? sniffed : "image/jpeg";
  }

  // No structure. Detection may still know what the file is.
  if (outcomeOf("pdf_header") === "found") return "application/pdf";

  // Genuinely unrecognised. Honest rather than lazy: the bytes are kept
  // exactly as they arrived and nothing claims to know what they are.
  return "application/octet-stream";
}

export function extForContentType(contentType: string): string {
  if (contentType.includes("pdf")) return "pdf";
  if (contentType.includes("xml")) return "xml";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  return "bin";
}

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
