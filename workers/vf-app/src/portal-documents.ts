import type { PortalAccessClaims } from "@vibefinance/shared";
import { extForContentType, renderXmlForDisplay, retrieveInvoiceDocument, type DocumentType } from "./document-storage.js";
import { loadReceiptSharingConfig } from "./receipt-sharing.js";
import { portalMayReadInvoice } from "./portal-route.js";

/**
 * **An invoice's or credit note's own document, in the supplier network —
 * decision 0770.** Dan, 13 October 2026, asked whether suppliers could see
 * the Document and Attachments of their invoices and credit notes, and
 * approved a mock-up: the file the customer received (the supplier's own
 * PDF, or the page drawn from their e-invoice), and that file to download.
 *
 * **Only the invoice's stored documents** (`invoice_documents`: the
 * original, the XML embedded in a PDF, and the page drawn from a plain
 * XML invoice). Never the email it came in nor the other files sent with
 * it: those are route message parts, and are the customer's — a
 * colleague's forwarding note, internal addresses, another supplier's
 * invoice in the same email.
 *
 * AP Setup › Supplier Network can turn it off (`shareDocuments`), for a
 * customer whose scanned invoices carry its own stamps and notes.
 */

export interface PortalDocumentFile {
  /** Which stored document: `original`, `embedded_xml` or `generated_rendering`. */
  key: DocumentType;
  name: string;
  contentType: string;
}

const ORDER: DocumentType[] = ["generated_rendering", "original", "embedded_xml"];

const fileExt = (contentType: string) => (contentType.includes("html") ? "html" : extForContentType(contentType));
const safeName = (s: string) => s.replace(/[^\w.-]+/g, "_").slice(0, 80) || "document";

/** The invoice's documents a supplier may have, in the order they are listed. Empty where AP Setup shares none. */
export async function portalDocumentFiles(db: D1Database, invoiceId: string, number: string | null): Promise<PortalDocumentFile[]> {
  if (!(await loadReceiptSharingConfig(db)).shareDocuments) return [];
  const rows = (
    await db.prepare("SELECT document_type, content_type FROM invoice_documents WHERE invoice_id = ?").bind(invoiceId).all<{ document_type: DocumentType; content_type: string }>()
  ).results;
  const base = safeName(number ?? "document");
  return rows
    .filter((r) => ORDER.includes(r.document_type))
    .sort((a, b) => ORDER.indexOf(a.document_type) - ORDER.indexOf(b.document_type))
    .map((r) => ({
      key: r.document_type,
      name: `${base}${r.document_type === "embedded_xml" ? "-embedded" : ""}.${fileExt(r.content_type)}`,
      contentType: r.content_type,
    }));
}

/**
 * A page drawn from XML is HTML served to the supplier network: it may run
 * nothing, fetch nothing and frame nothing, whatever the XML held.
 */
const PAGE_POLICY = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

/**
 * `GET /portal/invoices/:id/document?file=&download=1` — one of the
 * invoice's documents for the supplier it belongs to. Without `file`, the
 * one to look at (the drawn page where there is one, else the original).
 * Inline to look at; `download=1` as the file itself. 404 for an invoice
 * not theirs, a file it does not have, or when AP Setup shares none.
 */
export async function portalInvoiceDocument(
  db: D1Database,
  bucket: R2Bucket | null | undefined,
  claims: PortalAccessClaims,
  invoiceId: string,
  params: URLSearchParams
): Promise<Response> {
  const notFound = () => new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
  const invoice = await portalMayReadInvoice(db, claims, invoiceId);
  if (!invoice || !bucket) return notFound();
  const files = await portalDocumentFiles(db, invoiceId, invoice.number);
  const asked = params.get("file");
  const file = asked ? files.find((f) => f.key === asked) : files[0];
  if (!file) return notFound();
  const doc = await retrieveInvoiceDocument(bucket, db, invoiceId, file.key);
  if (!doc) return notFound();
  const headers: Record<string, string> = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  if (params.get("download") === "1") {
    return new Response(doc.bytes, { status: 200, headers: { ...headers, "Content-Type": doc.contentType, "Content-Disposition": `attachment; filename="${file.name}"` } });
  }
  // XML to look at is drawn as a page (0279), as in the invoice viewer.
  if (doc.contentType.includes("xml")) {
    return new Response(renderXmlForDisplay(doc.bytes), { status: 200, headers: { ...headers, "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline", "Content-Security-Policy": PAGE_POLICY } });
  }
  return new Response(doc.bytes, {
    status: 200,
    headers: { ...headers, "Content-Type": doc.contentType, "Content-Disposition": "inline", ...(doc.contentType.includes("html") ? { "Content-Security-Policy": PAGE_POLICY } : {}) },
  });
}
