/**
 * **Reading an ordinary PDF — decision 0683.**
 *
 * A PDF with no embedded invoice (no Factur-X/ZUGFeRD XML) used to reach
 * nobody: a Worker cannot rasterise a PDF for the vision model (no
 * native renderer, and PDF.js needs a canvas workerd does not have), so
 * it was kept as an invoice with no facts for a person to key. Dan's
 * emailed PDFs arrived exactly like that.
 *
 * Two kinds of PDF arrive, and each has a way in that needs no canvas:
 *
 * - **A digital PDF**, exported by accounting software, carries its text.
 *   `unpdf` (PDF.js's serverless build, which runs in workerd) reads it
 *   page by page, and the model reads the text instead of a picture.
 * - **A scanned PDF** is a picture of each page wrapped in a PDF. PDF.js
 *   decodes the picture to pixels (JPEG, Flate, JBIG2 or CCITT alike);
 *   it is turned into a grey PNG here — CompressionStream does the
 *   deflate — and goes to the vision model as any photograph does.
 *
 * Text wins when there is enough of it: it is exact where a picture is
 * read, and far smaller.
 */
// Loaded on first use (`await import`), so a request that never meets an
// ordinary PDF never evaluates PDF.js — over a megabyte of it.
type Unpdf = typeof import("unpdf");
let unpdf: Unpdf | null = null;
const loadUnpdf = async (): Promise<Unpdf> => (unpdf ??= await import("unpdf"));

/** Fewer letters and digits than this, across all pages, is not a text layer worth reading. */
const MIN_TEXT_CHARS = 30;
/** A scanned page is read at most this wide or tall, which is ample for an invoice and keeps the request small. */
const MAX_IMAGE_SIDE = 1600;
/** The pages read from a scanned PDF; more are left for a person, as a long photographed document is (0163). */
export const MAX_SCANNED_PAGES = 5;
/** Text past this many characters is cut, with the cut said, so a huge PDF cannot outgrow one request. */
const MAX_TEXT_CHARS = 60_000;

export type PdfRead =
  | { kind: "text"; pages: string[]; truncated: boolean }
  | { kind: "images"; images: Uint8Array[]; pageCount: number }
  | { kind: "none"; reason: string };

export async function readPdf(bytes: Uint8Array): Promise<PdfRead> {
  const { extractText, extractImages, getDocumentProxy } = await loadUnpdf();
  let pdf;
  try {
    // PDF.js takes ownership of the buffer it is given, so it gets a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes));
  } catch (err) {
    return { kind: "none", reason: `the PDF could not be opened: ${String(err).slice(0, 200)}` };
  }

  const { text } = await extractText(pdf, { mergePages: false });
  const pages = (text as string[]).map((t) => t.trim());
  const chars = pages.join("").replace(/[^\p{L}\p{N}]/gu, "").length;
  if (chars >= MIN_TEXT_CHARS) {
    let total = 0;
    let truncated = false;
    const kept: string[] = [];
    for (const page of pages) {
      if (total + page.length > MAX_TEXT_CHARS) {
        kept.push(page.slice(0, Math.max(0, MAX_TEXT_CHARS - total)));
        truncated = true;
        break;
      }
      kept.push(page);
      total += page.length;
    }
    return { kind: "text", pages: kept, truncated };
  }

  const images: Uint8Array[] = [];
  const pageCount = pdf.numPages;
  for (let n = 1; n <= Math.min(pageCount, MAX_SCANNED_PAGES); n++) {
    let found;
    try {
      found = await extractImages(pdf, n);
    } catch {
      continue;
    }
    // The page's picture is its largest image; a logo or stamp beside it is not the page.
    const largest = found.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!largest || largest.width < 200 || largest.height < 200) continue;
    images.push(await toGreyPng(largest.data, largest.width, largest.height, largest.channels));
  }
  if (images.length > 0) return { kind: "images", images, pageCount };
  return { kind: "none", reason: "the PDF has no text to read and no page image" };
}

/** Pixels (1, 3 or 4 channels) to a grey PNG no wider or taller than MAX_IMAGE_SIDE. */
export async function toGreyPng(data: Uint8ClampedArray | Uint8Array, width: number, height: number, channels: number): Promise<Uint8Array> {
  const scale = Math.max(1, Math.ceil(Math.max(width, height) / MAX_IMAGE_SIDE));
  const w = Math.floor(width / scale);
  const h = Math.floor(height / scale);
  // One filter byte (0, none) at the start of every row, then the grey pixels.
  const raw = new Uint8Array(h * (w + 1));
  for (let y = 0; y < h; y++) {
    const row = y * (w + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      // A box average over the scale × scale source pixels.
      let sum = 0;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const i = ((y * scale + dy) * width + (x * scale + dx)) * channels;
          sum += channels >= 3 ? (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000 : data[i];
        }
      }
      raw[row + 1 + x] = Math.round(sum / (scale * scale));
    }
  }
  const idat = await deflate(raw);
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, w);
  view.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return concat([
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** zlib-wrapped deflate, which is what a PNG's IDAT holds and what CompressionStream("deflate") writes. */
async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

let CRC_TABLE: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
