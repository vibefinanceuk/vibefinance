import { looksLikePdf, extractEmbeddedInvoiceXml, PdfExtractionError } from "./pdf-attachment.js";
import { sniffImageType } from "./extraction.js";

/**
 * Detecting what a document actually is — decision 0062.
 *
 * Until now the CALLER chose the path: `capture-xml`, `capture-pdf`
 * and `capture-image` are separate endpoints, and the sender declares
 * what it is sending. That works for an API integration and does not
 * survive a mailbox, where an attachment arrives and nothing has yet
 * decided what kind of document it is.
 *
 * The order is the substance of this module, not an implementation
 * detail. A Factur-X *is* a PDF. Asking "is this a PDF?" before "does
 * this PDF carry an embedded invoice?" would send every hybrid document
 * to inference and never open the structured data inside it — a silent
 * failure producing plausible facts, which is the worst shape a failure
 * can take.
 *
 * Most specific first, therefore:
 *
 *   1. a PDF carrying embedded XML  -> structured_pdfa
 *   2. XML in its own right         -> structured_xml
 *   3. a recognised image           -> image
 *   4. anything else                -> undetected
 *
 * Detection never refuses. An undetected document is not an error; it
 * is an invoice with no facts, which reaches Validation and waits for a
 * person (decision 0055 section 7). What it must not do is guess.
 */

export const DETECTED_STRUCTURES = ["structured_xml", "structured_pdfa", "image"] as const;
export type DetectedStructure = (typeof DETECTED_STRUCTURES)[number];

export interface DetectionResult {
  /** Null when nothing matched. Not a failure — a document for a human. */
  structure: DetectedStructure | null;
  /**
   * Every test tried, in order, with what it found. Recorded because a
   * refusal that names only "not recognised" is far less useful than
   * one that can say a PDF was present and carried no embedded
   * invoice — the first is a supplier who has not adopted
   * e-invoicing, the second is one whose implementation is broken, and
   * they are opposite conversations (decision 0055 section 9).
   */
  attempted: { test: string; outcome: string }[];
  /** The embedded attachment, when the PDF branch found one — so the
   *  caller need not extract it a second time. */
  embeddedXml?: string;
}

/**
 * Whether a document is XML in its own right.
 *
 * Deliberately shallow: a declaration or an opening element, not a
 * parse. Detection decides which handler to use, and the handler is
 * where real parsing and real refusal live — `parseUblInvoice` already
 * rejects a document that is not well-formed, and duplicating that
 * judgement here would mean two places deciding what counts as XML.
 */
export function looksLikeXml(bytes: Uint8Array): boolean {
  // Only the opening bytes matter, and decoding a whole document to
  // answer a question about its first character would be wasteful on a
  // large one.
  const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 512)).trimStart();
  // A UTF-8 BOM survives the decode as U+FEFF and would otherwise make
  // an ordinary XML document look like it starts with something else.
  const withoutBom = head.startsWith("\uFEFF") ? head.slice(1) : head;
  return withoutBom.startsWith("<?xml") || withoutBom.startsWith("<");
}

export async function detectStructure(bytes: Uint8Array): Promise<DetectionResult> {
  const attempted: { test: string; outcome: string }[] = [];

  if (bytes.length === 0) {
    attempted.push({ test: "empty", outcome: "the document has no content" });
    return { structure: null, attempted };
  }

  // 1. Hybrid PDF first, because a Factur-X is also a PDF and also, at
  //    a stretch, an image of a page. This is the only ordering that
  //    reaches its embedded invoice.
  if (looksLikePdf(bytes)) {
    attempted.push({ test: "pdf_header", outcome: "found" });
    try {
      const attachment = await extractEmbeddedInvoiceXml(bytes);
      if (attachment !== null) {
        attempted.push({ test: "embedded_invoice_xml", outcome: `found: ${attachment.filename}` });
        return { structure: "structured_pdfa", attempted, embeddedXml: attachment.xml };
      }
      // An ordinary PDF with no embedded invoice — a scan or an export.
      // It genuinely needs a vision model, and a PDF cannot be
      // rasterised inside a Worker, so no handler here can read it.
      attempted.push({ test: "embedded_invoice_xml", outcome: "none present" });
      return { structure: null, attempted };
    } catch (err) {
      // The document DECLARES an embedded invoice and it could not be
      // read. Recorded distinctly from "none present": one is a
      // supplier not sending structured data, the other is a supplier
      // sending it badly.
      const reason = err instanceof PdfExtractionError ? err.message : String(err);
      attempted.push({ test: "embedded_invoice_xml", outcome: `declared but unreadable: ${reason}` });
      return { structure: null, attempted };
    }
  }
  attempted.push({ test: "pdf_header", outcome: "not a PDF" });

  // 2. XML in its own right — UBL, or a Peppol BIS message.
  if (looksLikeXml(bytes)) {
    attempted.push({ test: "xml_declaration", outcome: "found" });
    return { structure: "structured_xml", attempted };
  }
  attempted.push({ test: "xml_declaration", outcome: "not XML" });

  // 3. A recognised image, by magic bytes rather than by a filename or
  //    a caller's content type — both of which can be wrong.
  const imageType = sniffImageType(bytes);
  if (imageType !== null) {
    attempted.push({ test: "image_magic_bytes", outcome: imageType });
    return { structure: "image", attempted };
  }
  attempted.push({ test: "image_magic_bytes", outcome: "unrecognised" });

  // 4. Nothing matched. Not an error — a document for a human.
  return { structure: null, attempted };
}

/**
 * Renders the attempted tests as the comma-separated string a rule can
 * test, matching how `validation.failures` and `extraction.conflicts`
 * already work — so the existing `contains` operator applies and no new
 * operator is needed.
 */
export function summariseAttempts(attempted: readonly { test: string; outcome: string }[]): string {
  return attempted.map((a) => a.test).join(",");
}
