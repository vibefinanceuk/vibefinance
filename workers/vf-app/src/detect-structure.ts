import { looksLikePdf, extractEmbeddedInvoiceXml, PdfExtractionError } from "./pdf-attachment.js";
import { sniffImageType } from "./extraction.js";
import { looksLikeCsv } from "@vibefinance/shared";

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

/**
 * `structured_csv` — decision 0565: a supplier's own CSV, read through a
 * supplier mapping. It has no intake channel of its own: it is read on
 * the process's structured-data channel, `structured_xml`, as its
 * mapping turns it into the same facts (`channelStructure`).
 */
export const DETECTED_STRUCTURES = ["structured_xml", "structured_pdfa", "image", "structured_csv"] as const;
export type ChannelStructure = "structured_xml" | "structured_pdfa" | "image";
export const channelStructure = (s: DetectedStructure): ChannelStructure => (s === "structured_csv" ? "structured_xml" : s);
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
  /** Decision 0683: an ordinary PDF (no embedded invoice), read on the image channel by its text or its page pictures. */
  pdf?: boolean;
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
      // **Read now — decision 0683**: its text, or the picture of each
      // page, on the image channel, by `handleCaptureOrdinaryPdf`. Until
      // then a Worker could not rasterise it and nothing read it.
      attempted.push({ test: "embedded_invoice_xml", outcome: "none present" });
      return { structure: "image", attempted, pdf: true };
    } catch (err) {
      // The document DECLARES an embedded invoice and it could not be
      // read. Recorded distinctly from "none present": one is a
      // supplier not sending structured data, the other is a supplier
      // sending it badly.
      const reason = err instanceof PdfExtractionError ? err.message : String(err);
      attempted.push({ test: "embedded_invoice_xml", outcome: `declared but unreadable: ${reason}` });
      // Decision 0683: read as an ordinary PDF rather than not at all; `attempted` keeps why.
      return { structure: "image", attempted, pdf: true };
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
  /**
   * **What the bytes actually start with** — decision 0168.
   *
   * A real JPEG arrived and this said *"unrecognised"*, which is true
   * and useless: it does not distinguish a file that is not an image
   * from an image that arrived damaged, and only one of those is our
   * fault.
   *
   * The same lesson as decision 0162 one layer up — the system knew
   * something and reported a word instead.
   *
   * Eight bytes, hex, which is enough to name any format and far too
   * few to be a document.
   */
  const opening = [...bytes.slice(0, 8)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");

  attempted.push({
    test: "image_magic_bytes",
    outcome: bytes.length === 0 ? "no bytes at all" : `unrecognised (starts ${opening})`,
  });

  // 4. A supplier's own CSV — decision 0565. Last, because the test is
  //    the loosest: text that one separator splits into the same number
  //    of columns on at least two rows. Recorded only when found, so an
  //    undetected document's attempts read as they always have.
  if (looksLikeCsv(bytes)) {
    attempted.push({ test: "csv_rows", outcome: "found" });
    return { structure: "structured_csv", attempted };
  }

  // 5. Nothing matched. Not an error — a document for a human.
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

/**
 * What each test actually found — decision 0169.
 *
 * `summariseAttempts` stores the **names** of the tests that ran, in a
 * comma-separated form matching `validation.failures` so the existing
 * `contains` operator applies. That format is a contract a customer's
 * rule may depend on, and it stays.
 *
 * **But it discards every answer.** `intake.attempted` read
 * `pdf_header,xml_declaration,image_magic_bytes` — a list of questions
 * with none of the results, so decision 0168's opening bytes never
 * reached storage.
 *
 * **The third time in one day that evidence existed and something
 * summarised it out of existence**: decision 0162 at the email layer,
 * 0168 at detection, this at storage.
 *
 * Kept separate rather than folded in, so a rule matching on which
 * tests ran is untouched by what they found.
 */
export function detailOfAttempts(
  attempted: readonly { test: string; outcome: string }[]
): string {
  return attempted.map((a) => `${a.test}: ${a.outcome}`).join(" · ");
}
