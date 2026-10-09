/**
 * **Reading a scanned page into words, in the browser — decision 0698.**
 *
 * A scan or a photo has no text layer, so Tesseract reads it: each word with
 * its box and how sure it was. The words are the same shape a PDF's text
 * layer gives (`doc-words.js`), so finding a field's value and reading a
 * lasso work on a scan exactly as on a PDF with text.
 *
 * **In the browser, not at intake.** Agreed with Dan, 9 October 2026: it is
 * free, uses none of the Workers AI allowance, and nothing leaves this
 * deployment. The cost is a one-off download (about 7 MB, then cached) and a
 * few seconds the first time each page is read.
 *
 * One Tesseract worker for the whole window, made the first time a page
 * needs reading; pages are read one at a time through it. A page read once
 * is kept for as long as the window is open, so opening the invoice again,
 * or clicking another field, does not read it again.
 */
import { ocrWords } from "/doc-words.js";

const BASE = "/vendor/tesseract";
/** English and German: the interface's languages (see vendor/tesseract/VENDORED.md). */
export const LANGUAGES = ["eng", "deu"];

let workerPromise = null;
let queue = Promise.resolve();
const done = new Map();

async function worker() {
  workerPromise ??= (async () => {
    const { default: Tesseract } = await import("/vendor/tesseract/tesseract.esm.min.js");
    return Tesseract.createWorker(LANGUAGES, 1, {
      workerPath: `${BASE}/worker.min.js`,
      corePath: `${BASE}/core`,
      langPath: `${BASE}/lang`,
      workerBlobURL: false,
    });
  })().catch((err) => {
    workerPromise = null;
    throw err;
  });
  return workerPromise;
}

/**
 * The words on one page image. `image` is anything Tesseract reads (a
 * Blob, a canvas); `width` and `height` are its size in pixels. `key`
 * names the page, so it is read once.
 */
export function readPage(key, image, width, height) {
  if (done.has(key)) return done.get(key);
  const result = (queue = queue.then(async () => {
    const w = await worker();
    const { data } = await w.recognize(image, {}, { blocks: true, text: false });
    return ocrWords(data.blocks, width, height);
  }));
  // A failed read is not kept: the next attempt tries again.
  const kept = result.catch((err) => {
    done.delete(key);
    throw err;
  });
  queue = kept.catch(() => {});
  done.set(key, kept);
  return kept;
}

/** Whether `key` has already been read (or is being read). */
export function isRead(key) {
  return done.has(key);
}
