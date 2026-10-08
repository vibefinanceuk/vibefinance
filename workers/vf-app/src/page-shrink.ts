/**
 * **A smaller working copy of a scanned PDF — decision 0690.**
 *
 * Dan, 8 October 2026: *"take any image PDF, and create a localised
 * version of it, with much smaller filesize such that it can be processed
 * more efficiently. The original can be retained and stored as an
 * attachment."*
 *
 * A scanner's page is typically a 1654×2339 colour JPEG of several hundred
 * kilobytes. Each one went to the vision model as it was (decision 0684),
 * and a day of testing used up Workers AI's daily allowance. Here each page
 * is made **greyscale and no larger than `SHRUNK_MAX_SIDE`** by Cloudflare
 * Images, outside the Worker — decision 0684 found that decoding and
 * re-encoding a page inside the Worker cost heavy CPU and caused time-outs.
 *
 * The smaller pages are what the model reads, and they are kept as the
 * invoice's **working pages** (`invoice_pages`): one JPEG per page with its
 * size, which the viewer draws as page images. One image per page is the
 * shape a lasso needs (Dan: *"I would like to enhance the document viewer
 * to support lasso functionality"*): a region drawn on a page is in that
 * image's pixels, so it can be cropped and read directly. The PDF as it
 * arrived stays the invoice's `original`, in the Attachments tab.
 *
 * **Never worse than the original.** A page is replaced only by a valid
 * JPEG that is smaller than it; where Images is not bound, fails, or would
 * not save anything, the original pages are used exactly as before.
 */

/** The longest side of a page as read: about 140 dpi on A4, ample for printed text. */
export const SHRUNK_MAX_SIDE = 1600;
/** JPEG quality of the smaller pages: text stays sharp, the file a fraction of the scan's. */
export const SHRUNK_QUALITY = 70;

/** Makes one page image smaller. Throws on failure; the caller keeps the original. */
export type PageShrinker = (bytes: Uint8Array) => Promise<Uint8Array>;

/** The Cloudflare Images binding as a shrinker, or undefined where it is not bound. */
export function imagesShrinker(images: ImagesBinding | undefined): PageShrinker | undefined {
  if (!images) return undefined;
  return async (bytes) => {
    const result = await images
      .input(new Blob([bytes as Uint8Array<ArrayBuffer>]).stream())
      .transform({ width: SHRUNK_MAX_SIDE, height: SHRUNK_MAX_SIDE, fit: "scale-down", saturation: 0 })
      .output({ format: "image/jpeg", quality: SHRUNK_QUALITY });
    return new Uint8Array(await new Response(result.image()).arrayBuffer());
  };
}

/** One working page: a smaller JPEG, its size, and the size of the page it came from. */
export interface WorkingPage {
  bytes: Uint8Array;
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
}

export interface ShrunkPages {
  /** What to read: the smaller copy of each page where one was made, else the original. */
  pages: Uint8Array[];
  /** True when every page was replaced by a smaller copy, so the copy can stand for the document. */
  shrunk: boolean;
  /** The working pages, when `shrunk`. */
  working: WorkingPage[];
  bytesBefore: number;
  bytesAfter: number;
  /** Why the pages were not all shrunk. */
  reason?: string;
}

/**
 * Each page through `shrink`. A page whose copy is not a smaller valid JPEG
 * keeps its original. **All or nothing for the working pages**: a document
 * is kept as working pages only when every page was shrunk, so the viewer
 * never shows half a document at one size and half at another.
 */
export async function shrinkPages(pages: readonly Uint8Array[], shrink: PageShrinker | undefined): Promise<ShrunkPages> {
  const bytesBefore = pages.reduce((n, p) => n + p.length, 0);
  if (!shrink) return { pages: [...pages], shrunk: false, working: [], bytesBefore, bytesAfter: bytesBefore, reason: "no Images binding" };
  const out: Uint8Array[] = [];
  const working: WorkingPage[] = [];
  let reason: string | undefined;
  for (const page of pages) {
    try {
      const small = await shrink(page);
      const size = jpegSize(small);
      if (size && small.length < page.length) {
        out.push(small);
        const original = imageSize(page);
        working.push({ bytes: small, width: size.width, height: size.height, originalWidth: original?.width ?? null, originalHeight: original?.height ?? null });
      } else {
        out.push(page);
        reason ??= "the copy was not smaller";
      }
    } catch (err) {
      out.push(page);
      reason ??= String(err).slice(0, 200);
    }
  }
  const shrunk = working.length === pages.length && pages.length > 0;
  return {
    pages: out,
    shrunk,
    working: shrunk ? working : [],
    bytesBefore,
    bytesAfter: out.reduce((n, p) => n + p.length, 0),
    ...(shrunk ? {} : { reason: reason ?? "no pages" }),
  };
}

/** A JPEG's or PNG's width and height, or null. */
export function imageSize(bytes: Uint8Array): { width: number; height: number } | null {
  const jpeg = jpegSize(bytes);
  if (jpeg) return { width: jpeg.width, height: jpeg.height };
  if (bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  return null;
}

/** A JPEG's width and height from its frame header, or null if it is not a JPEG. */
export function jpegSize(bytes: Uint8Array): { width: number; height: number; components: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // Fill bytes and markers with no length.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    // Start of frame: baseline, extended, progressive or lossless (not DHT, JPG or DAC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    if (marker === 0xda) return null; // Image data before any frame header.
    i += 2 + length;
  }
  return null;
}

/** "2.4 MB" / "310 KB", for the note on the invoice. */
export function sizeText(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
