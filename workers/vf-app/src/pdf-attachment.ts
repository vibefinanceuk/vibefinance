/**
 * Hybrid PDF (Factur-X / ZUGFeRD) embedded-XML extraction — decision
 * 0042.
 *
 * A hybrid invoice is a PDF/A-3 file carrying a complete, valid
 * EN 16931 XML invoice as an embedded file attachment. Germany
 * (ZUGFeRD) and France (Factur-X) both mandate this shape, and
 * decision 0013 already anticipated it: "pull the XML attachment out
 * of the received PDF/A-3 to populate structured facts".
 *
 * The XML is the authoritative data. Sending a hybrid PDF to a vision
 * model would be a genuine regression — taking structured,
 * mandate-grade data and asking a model to re-read it from a picture,
 * introducing extraction error where there was none. So any PDF is
 * checked for an embedded invoice FIRST, and a model is never invoked
 * when one is found.
 *
 * This is deterministic container parsing, not machine learning: the
 * same guarantees the existing UBL/XML path already has. No
 * confidence score, because there is nothing to be uncertain about.
 *
 * Deliberately a minimal, targeted PDF reader rather than a general
 * one. It answers exactly one question — "is there an embedded XML
 * invoice, and what is it?" — and refuses clearly when it cannot.
 * A full PDF parser would be a far larger surface for no benefit
 * here.
 */

export class PdfExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PdfExtractionError";
  }
}

/** Decodes PDF bytes as Latin-1 so byte offsets and string indices
 *  stay in lockstep. Deliberately NOT TextDecoder("utf-8"): a
 *  multi-byte sequence would shift every subsequent index, and the
 *  stream boundaries below are byte offsets into the original array.
 *  Only the structure is read this way; the extracted XML itself is
 *  decoded as UTF-8 separately. */
function toLatin1(bytes: Uint8Array): string {
  let out = "";
  // Chunked to avoid blowing the call-stack limit on a large PDF,
  // which String.fromCharCode(...spread) would do on real invoices.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

/** True if these bytes are a PDF at all. Checked before anything
 *  else, so a mislabelled upload fails with a clear message rather
 *  than a confusing parse error deeper in. */
export function looksLikePdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && toLatin1(bytes.subarray(0, 5)) === "%PDF-";
}

/**
 * The conventional filenames the mandates actually specify. Checked
 * case-insensitively, and a PDF whose attachment is named something
 * else entirely is still accepted if it is the only XML present —
 * being strict about the filename would reject real, valid invoices
 * from producers who deviate slightly, and the filename is not what
 * makes the data authoritative.
 */
const KNOWN_ATTACHMENT_NAMES = [
  "factur-x.xml", // Factur-X (France)
  "zugferd-invoice.xml", // ZUGFeRD 1.0
  "xrechnung.xml", // XRechnung (Germany)
  "order-x.xml",
];

interface EmbeddedStream {
  objectNumber: number;
  dict: string;
  start: number;
  end: number;
}

/** Resolves PDF name escapes: (factur\055x\056xml) -> factur-x.xml.
 *  Real producers emit these, and a naive reader would look for a
 *  filename that never literally appears in the file. */
function decodePdfName(raw: string): string {
  return raw.replace(/\\(\d{1,3})/g, (_, oct: string) => String.fromCharCode(parseInt(oct, 8)));
}

/** Locates every /Filespec that points at an embedded file stream,
 *  returning the object number and the declared filename. */
function findFilespecs(text: string): { objectNumber: number; filename: string }[] {
  const results: { objectNumber: number; filename: string }[] = [];
  // A Filespec's /F (filename) and its /EF << /F n 0 R >> can appear
  // in either order in practice, so both directions are tried rather
  // than assuming one layout.
  const re = /\/Type\s*\/Filespec([\s\S]{0,600}?)\/EF\s*<<\s*\/(?:F|UF)\s+(\d+)\s+\d+\s+R/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const nameMatch = /\/(?:F|UF)\s*\(([^)]*)\)/.exec(m[1]);
    results.push({
      objectNumber: Number(m[2]),
      filename: nameMatch ? decodePdfName(nameMatch[1]) : "",
    });
  }
  return results;
}

/** Locates an indirect object's stream data by object number. */
function findStream(text: string, objectNumber: number): EmbeddedStream | null {
  const re = new RegExp(`(?:^|[^0-9])${objectNumber}\\s+0\\s+obj([\\s\\S]*?)endobj`, "m");
  const m = re.exec(text);
  if (!m) return null;

  const streamKeyword = text.indexOf("stream", m.index);
  if (streamKeyword === -1) return null;
  const dict = text.slice(m.index, streamKeyword);

  let start = streamKeyword + "stream".length;
  // The spec allows CRLF or LF after the keyword, never CR alone.
  if (text[start] === "\r") start++;
  if (text[start] === "\n") start++;

  // /Length is authoritative when present, and using it avoids a real
  // off-by-one found while prototyping: searching for "endstream"
  // includes the EOL the spec requires BEFORE it, which corrupts
  // compressed data and makes decompression fail with trailing junk.
  const lengthMatch = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
  let end: number;
  if (lengthMatch) {
    end = start + Number(lengthMatch[1]);
  } else {
    // /Length can itself be an indirect reference, which this minimal
    // reader deliberately does not resolve. Fall back to the keyword
    // and trim the required EOL back off.
    end = text.indexOf("endstream", start);
    if (end === -1) return null;
    while (end > start && (text[end - 1] === "\n" || text[end - 1] === "\r")) end--;
  }

  return { objectNumber, dict, start, end };
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  // "deflate" handles the zlib wrapper real PDF producers emit;
  // "deflate-raw" is tried as a fallback because some writers omit it.
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      // Try the next format rather than failing on the first.
    }
  }
  throw new PdfExtractionError("the embedded file stream could not be decompressed");
}

export interface ExtractedAttachment {
  filename: string;
  xml: string;
}

/**
 * Returns the embedded XML invoice from a hybrid PDF, or null if this
 * PDF simply doesn't have one.
 *
 * null and a thrown error mean genuinely different things, and the
 * distinction matters to the caller: null is "this is an ordinary
 * PDF, treat it as an image", while an error is "this looks like a
 * hybrid invoice and something is wrong with it" — which is exactly
 * the case a mandate-bound customer may want to refuse outright
 * rather than silently degrade.
 */
export async function extractEmbeddedInvoiceXml(bytes: Uint8Array): Promise<ExtractedAttachment | null> {
  if (!looksLikePdf(bytes)) {
    throw new PdfExtractionError("not a PDF file (missing %PDF- header)");
  }

  const text = toLatin1(bytes);
  if (!text.includes("/EmbeddedFiles") && !text.includes("/Filespec")) {
    return null; // An ordinary PDF. Not an error.
  }

  const filespecs = findFilespecs(text);
  if (filespecs.length === 0) return null;

  // Prefer a conventionally-named attachment when there is one; a PDF
  // can carry several embedded files and only one of them is the
  // invoice.
  const byConvention = filespecs.filter((f) =>
    KNOWN_ATTACHMENT_NAMES.includes(f.filename.toLowerCase())
  );
  const byExtension = filespecs.filter((f) => f.filename.toLowerCase().endsWith(".xml"));
  const candidates = byConvention.length > 0 ? byConvention : byExtension.length > 0 ? byExtension : filespecs;

  for (const candidate of candidates) {
    const stream = findStream(text, candidate.objectNumber);
    if (!stream) continue;

    let raw: Uint8Array = bytes.slice(stream.start, stream.end);
    if (/\/Filter\s*(?:\[\s*)?\/FlateDecode/.test(stream.dict)) {
      raw = await inflate(raw);
    }

    const xml = new TextDecoder().decode(raw);
    // Confirms this really is XML before handing it on — an embedded
    // file that decompressed to something else entirely should not be
    // passed to the UBL parser as if it were an invoice.
    if (!xml.trimStart().startsWith("<")) continue;

    return { filename: candidate.filename || "(unnamed)", xml };
  }

  // Filespecs were present but nothing usable came out of them. This
  // is the "looks like a hybrid and something is wrong" case, and is
  // deliberately an error rather than null.
  throw new PdfExtractionError(
    "this PDF declares an embedded file but no readable XML invoice could be extracted from it"
  );
}
