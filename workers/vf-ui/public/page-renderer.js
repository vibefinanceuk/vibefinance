/**
 * A real, client-side page renderer — decision 0382, phase 2 of
 * `docs/design/document-viewer.md`. Decided in conversation: not the
 * browser's own PDF viewer, one thumbnail rail, one zoom, one rotate,
 * shared by images and PDFs alike, so the Document tab stops behaving
 * differently per document kind.
 *
 * **Every dependency below is injectable** (the `deps` parameter,
 * defaulting to `REAL_DEPS`) — the same seam `documentFrame()`'s own
 * `mint` parameter uses (decision 0380). A test drives `resolvePages()`
 * and the widget's controls against stubs; nothing here has to run a
 * real PDF engine or decode a real image to be tested, and nothing
 * fakes one badly instead.
 */

import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";
import { pdfWords, locate, rotateBox, unrotatePoint, wordsInLasso, contextFor, polygonBox } from "/doc-words.js";
import { docLink } from "/doc-link.js";
import { readPage } from "/ocr.js";

export const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
/** Index into ZOOM_STEPS for 1×, and where every document starts. */
export const DEFAULT_ZOOM_INDEX = 2;
export const ROTATIONS = [0, 90, 180, 270];

/**
 * Every page behind one invoice's document card, in reading order.
 *
 * **Two genuinely different shapes, told apart by asking, not by
 * guessing from the invoice.** A multi-page pending-document-sourced
 * invoice (decision 0045) has real, separately-addressed pages —
 * `listRetainedPages` (decision 0381) either finds them or finds none,
 * and finding none is the ordinary case, not an error. Everything else
 * has exactly one retained document, which is either a PDF with however
 * many pages pdf.js finds inside it — a Factur-X/ZUGFeRD hybrid
 * original is the real case today (0042) — or a single image, which is
 * one page: itself.
 */
export async function resolvePages(invoiceId, contentType, deps) {
  const retained = await deps.listRetainedPages(invoiceId);
  if (retained.length > 0) {
    return retained.map((p) => pageSource(p.pageNumber, "image", { urlFor: () => deps.mintPageUrl(invoiceId, p.pageNumber) }));
  }

  if (!contentType) return [];

  if (/pdf/i.test(contentType)) {
    const url = await deps.mintDocumentUrl(invoiceId);
    if (!url) return [];
    const pdf = await deps.loadPdfDocument(url);
    if (!pdf) return [];
    return Array.from({ length: pdf.numPages }, (_, i) => pageSource(i + 1, "pdf", { pdf }));
  }

  return [pageSource(1, "image", { urlFor: () => deps.mintDocumentUrl(invoiceId) })];
}

/**
 * One page, described rather than yet loaded. `load()` memoizes —
 * called once by the thumbnail rail and again by the main view, and
 * the second call must not re-mint a URL or re-fetch bytes already in
 * hand.
 */
function pageSource(pageNumber, kind, extra) {
  let loaded = null;
  return {
    pageNumber,
    kind,
    ...extra,
    load(deps) {
      loaded ??= kind === "pdf" ? deps.loadPdfPage(extra.pdf, pageNumber) : deps.loadImage(extra.urlFor);
      return loaded;
    },
  };
}

/**
 * Draws one page into a canvas, either at an absolute `zoom` or, for a
 * thumbnail, scaled to `fitWidth` regardless of the page's own size —
 * two different questions ("how big is 1×" and "how big is the rail")
 * that the real image/PDF drawing code below answers differently, but
 * this seam does not need to know that.
 */
async function renderPage(source, canvas, { zoom, rotation, fitWidth }, deps) {
  const loaded = await source.load(deps);
  if (!loaded) return false;
  if (source.kind === "pdf") await deps.drawPdfPage(loaded, canvas, { zoom, rotation, fitWidth });
  else await deps.drawImage(loaded, canvas, { zoom, rotation, fitWidth });
  return true;
}

// ---------------------------------------------------------------------
// Real implementations. Not exercised by the browser test suite
// (decision 0121's jsdom has no working canvas 2D context and no real
// image decoder) — the same honesty decision 0380 already applied to
// "measured in Chromium, not Safari or Firefox": stated here rather
// than quietly assumed correct.
// ---------------------------------------------------------------------

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });
}

function drawRotated(ctx, drawable, w, h, scale, rotation) {
  const rotated = rotation === 90 || rotation === 270;
  ctx.canvas.width = Math.round((rotated ? h : w) * scale);
  ctx.canvas.height = Math.round((rotated ? w : h) * scale);
  ctx.save();
  ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(drawable, (-w * scale) / 2, (-h * scale) / 2, w * scale, h * scale);
  ctx.restore();
}

async function realDrawImage(img, canvas, { zoom, rotation, fitWidth }) {
  const ctx = canvas.getContext("2d");
  const rotated = rotation === 90 || rotation === 270;
  const naturalSpan = rotated ? img.naturalHeight : img.naturalWidth;
  const scale = fitWidth ? fitWidth / naturalSpan : zoom;
  drawRotated(ctx, img, img.naturalWidth, img.naturalHeight, scale, rotation);
}

async function realDrawPdfPage(pdfPage, canvas, { zoom, rotation, fitWidth }) {
  // pdf.js rotates and scales for us — cleaner than the canvas
  // transform the image path needs, and the reason a PDF page is never
  // routed through `realDrawImage` even though both end at a canvas.
  const base = pdfPage.getViewport({ scale: 1, rotation: 0 });
  const scale = fitWidth ? fitWidth / base.width : zoom;
  const viewport = pdfPage.getViewport({ scale, rotation });
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await pdfPage.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
}

/** Text widths in a font like the PDF's, so each word's box starts where its ink does (0697). */
let measurer = null;
function measureText() {
  if (measurer !== null) return measurer || null;
  try {
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx?.measureText) throw new Error("no canvas");
    measurer = (text, family) => {
      ctx.font = `100px ${family}`;
      return ctx.measureText(text).width;
    };
  } catch {
    measurer = false;
  }
  return measurer || null;
}

/** The longest side a PDF page is drawn at to be read by OCR: about 170 dpi on A4. */
const OCR_SIDE = 2000;

/**
 * A page's words — decisions 0697 and 0698. A PDF's own text layer where
 * it has one; otherwise the page read by Tesseract (`ocr.js`): an image
 * page from its own bytes, a PDF page with no text (a scan inside a PDF)
 * drawn to a canvas first. `null` when there is nothing to read.
 */
async function realPageWords(source, loaded, { invoiceId } = {}) {
  if (source.kind === "pdf" && loaded?.getTextContent) {
    try {
      const content = await loaded.getTextContent();
      const words = pdfWords(content, loaded.getViewport({ scale: 1, rotation: 0 }), measureText());
      if (words.length) return words;
    } catch {
      // Fall through to reading it as a picture.
    }
    try {
      const base = loaded.getViewport({ scale: 1, rotation: 0 });
      const viewport = loaded.getViewport({ scale: Math.min(4, OCR_SIDE / Math.max(base.width, base.height)), rotation: 0 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await loaded.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const words = await readPage(`${invoiceId}:pdf:${source.pageNumber}`, canvas, canvas.width, canvas.height);
      return words.length ? words : null;
    } catch {
      return null;
    }
  }
  if (source.kind === "image" && source.urlFor) {
    try {
      const url = await source.urlFor();
      if (!url) return null;
      const blob = await (await fetch(url)).blob();
      let width = loaded?.naturalWidth;
      let height = loaded?.naturalHeight;
      if (!width || !height) {
        const bitmap = await createImageBitmap(blob);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close?.();
      }
      const words = await readPage(`${invoiceId}:image:${source.pageNumber}`, blob, width, height);
      return words.length ? words : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The longest side of a lassoed cut-out sent to be read: plenty for a value, small to send. */
const CROP_SIDE = 1200;

/**
 * The lassoed `box` (a fraction of the unrotated page) cut out of the page
 * at full resolution, a little larger than drawn, as a JPEG data URL —
 * decision 0699. A PDF page is drawn large first; an image page is read
 * from its own bytes (a picture shown from another origin cannot be read
 * back from the screen).
 */
async function realCropRegion(source, loaded, box, { invoiceId } = {}) {
  let picture;
  let width;
  let height;
  if (source.kind === "pdf" && loaded?.render) {
    const base = loaded.getViewport({ scale: 1, rotation: 0 });
    const viewport = loaded.getViewport({ scale: Math.min(5, 3000 / Math.max(base.width, base.height)), rotation: 0 });
    picture = document.createElement("canvas");
    picture.width = width = Math.round(viewport.width);
    picture.height = height = Math.round(viewport.height);
    await loaded.render({ canvasContext: picture.getContext("2d"), viewport }).promise;
  } else {
    const url = await source.urlFor();
    const blob = await (await fetch(url)).blob();
    picture = await createImageBitmap(blob);
    width = picture.width;
    height = picture.height;
  }
  const padX = Math.max(0.01, box.w * 0.08);
  const padY = Math.max(0.006, box.h * 0.25);
  const sx = Math.max(0, (box.x - padX) * width);
  const sy = Math.max(0, (box.y - padY) * height);
  const sw = Math.min(width - sx, (box.w + 2 * padX) * width);
  const sh = Math.min(height - sy, (box.h + 2 * padY) * height);
  const scale = Math.min(1, CROP_SIDE / Math.max(sw, sh));
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(sw * scale));
  out.height = Math.max(1, Math.round(sh * scale));
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.drawImage(picture, sx, sy, sw, sh, 0, 0, out.width, out.height);
  picture.close?.();
  void invoiceId;
  return out.toDataURL("image/jpeg", 0.88);
}

/** Sends a cut-out to be read; `{ ok, text, field, reason }`. */
async function realReadRegion(invoiceId, payload) {
  try {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/read-region`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, reason: body.reason ?? "ai_failed" };
    return { ok: true, text: body.text ?? "", field: body.field ?? null };
  } catch {
    return { ok: false, reason: "ai_failed" };
  }
}

async function realLoadPdfDocument(url) {
  // Loaded only when a page turns out to be a PDF — most invoices are
  // an image or a set of retained pages and never need pdf.js's ~1.7MB
  // at all. Vendored locally (`vendor/pdfjs/`), not a CDN: the same
  // choice decision 0124 made for the font, so nothing this
  // application shows depends on a third party's uptime.
  const pdfjs = await import("/vendor/pdfjs/pdf.min.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = "/vendor/pdfjs/pdf.worker.min.mjs";
  try {
    return await pdfjs.getDocument({ url }).promise;
  } catch {
    return null;
  }
}

// Exported so a test can check every dependency `pageViewer()` and
// `resolvePages()` actually call is really here — the exact bug this
// guards against already happened once while building this file:
// `pageViewer()` called `deps.resolvePages`, and this object had no
// such key, undetected until the first test run threw.
export const REAL_DEPS = {
  listRetainedPages: async (invoiceId) => {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/pages`);
    if (!res.ok) return [];
    return (await res.json()).pages ?? [];
  },
  mintPageUrl: async (invoiceId, pageNumber) => {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/pages/${pageNumber}/document-url`, {
      method: "POST",
    });
    if (!res.ok) return null;
    return (await res.json()).url ?? null;
  },
  mintDocumentUrl: async (invoiceId) => {
    const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/document-url`, { method: "POST" });
    if (!res.ok) return null;
    return (await res.json()).url ?? null;
  },
  loadPdfDocument: realLoadPdfDocument,
  loadPdfPage: (pdf, pageNumber) => pdf.getPage(pageNumber),
  loadImage: (urlFor) => urlFor().then((url) => (url ? loadImageElement(url) : null)),
  drawPdfPage: realDrawPdfPage,
  drawImage: realDrawImage,
  /**
   * The words on a page and where each one is — decision 0697. A PDF's
   * own text layer through pdf.js; `null` for a page with none to give
   * (an image, or a scan inside a PDF) — decision 0698 reads those.
   */
  pageWords: realPageWords,
  // The link to the invoice form beside it, or in the other window — decision 0697.
  docLink: (invoiceId) => docLink(invoiceId),
  // A lassoed area cut out of the page, and read by the vision model — decision 0699.
  cropRegion: realCropRegion,
  readRegion: realReadRegion,
  // The widget calls `deps.resolvePages`, not the module-level export
  // directly, so a widget-level test can stub the whole page list in
  // one go instead of every fetch and every pdf.js call beneath it.
  resolvePages,
};

/**
 * The widget itself: a vertical thumbnail rail, a main canvas, and
 * zoom/rotate controls above it — replacing the `<img>`/`<iframe>`
 * split `showPreview()` used to build directly.
 *
 * **Rotate and zoom reset on every open, never remembered** — decided
 * in conversation: a session convenience, not data worth a place to
 * store it, and it matches how the browser's own PDF viewer behaved
 * before this replaced it.
 */
export function pageViewer(invoiceId, contentType, deps = REAL_DEPS) {
  let pages = [];
  let current = 0;
  let zoomIndex = DEFAULT_ZOOM_INDEX;
  let rotation = 0;
  let railButtons = [];

  const canvas = el("canvas", { class: "vcanvas" });
  const rail = el("div", { class: "vrail", "aria-label": t("viewer.thumbnails") });
  const status = el("div", { class: "vpagestatus" });
  const empty = el("div", { class: "vthumb", text: t("viewer.nodocument") });

  function iconButton(name, label, onclick) {
    const button = el("button", { class: "iconbutton", "aria-label": label, title: label });
    button.append(icon(name));
    button.onclick = onclick;
    return button;
  }

  const zoomOutBtn = iconButton("zoomout", t("viewer.zoomout"), () => {
    zoomIndex = Math.max(0, zoomIndex - 1);
    draw();
  });
  const zoomInBtn = iconButton("zoomin", t("viewer.zoomin"), () => {
    zoomIndex = Math.min(ZOOM_STEPS.length - 1, zoomIndex + 1);
    draw();
  });
  const rotateBtn = iconButton("rotate", t("viewer.rotate"), () => {
    rotation = ROTATIONS[(ROTATIONS.indexOf(rotation) + 1) % ROTATIONS.length];
    // **Highlights do not survive a rotation** — decision 0394. Each
    // one is recorded as a fraction of the canvas's own rendered box
    // (below), which stays a valid description of "where on the page"
    // only while that box keeps the same orientation. Rotating swaps
    // the box's own width and height, so a fraction that meant
    // "top-left corner" a moment ago would land somewhere unrelated
    // once the page turns — clearing is the honest choice, not a
    // silent misplacement.
    highlights = [];
    draw();
  });
  /**
   * **Previous/next, beside Rotate** — decision 0394, asked for
   * directly: *"next / previous page cycling on the top of the
   * document image viewer to the right of the rotate icon."* Calls
   * the same `selectPage()` the thumbnail rail already uses, so the
   * rail's own highlight and `draw()` stay the single source of truth
   * for "which page is current" — this is a second way to reach it,
   * not a second copy of it.
   */
  const prevBtn = iconButton("chevronleft", t("viewer.previouspage"), () => {
    if (current > 0) selectPage(current - 1);
  });
  const nextBtn = iconButton("chevronright", t("viewer.nextpage"), () => {
    if (current < pages.length - 1) selectPage(current + 1);
  });

  /**
   * **The highlight tool — decision 0394, a small first cut.** Session
   * only: nothing here is sent anywhere or outlives this window being
   * closed. Scoped down deliberately from "annotations" to one shape
   * (a dragged rectangle) so it could be built, measured and shipped
   * rather than designed indefinitely — see the decision record for
   * what this does not yet do (persistence, other shapes, showing up
   * in the Timeline).
   *
   * **Recorded as a fraction of the canvas's own rendered box**
   * (`canvas.offsetLeft/Top/Width/Height`, relative to `canvasHolder`,
   * its positioned ancestor — stable under scroll, unlike
   * `getBoundingClientRect()`), not of the underlying page image.
   * `drawRotated()` always resizes the canvas bitmap to exactly the
   * scaled, rotated image with no letterboxing, so that box *is* the
   * image at every zoom step — a fraction of it stays correct across
   * zoom precisely because zoom only ever scales that box, never
   * reshapes it. Rotation reshapes it, which is why the handler above
   * clears on rotate rather than trying to re-project.
   */
  let highlights = [];
  let highlightMode = false;
  let dragBox = null;

  const highlightBtn = iconButton("highlight", t("viewer.highlight"), () => {
    highlightMode = !highlightMode;
    if (highlightMode) setLassoMode(false);
    highlightBtn.classList.toggle("on", highlightMode);
    canvasHolder.classList.toggle("highlighting", highlightMode);
  });

  /**
   * **Where a field's value is, and the lasso — decision 0697.**
   *
   * `located` is where the value of the field just clicked in the form
   * was found, best first, each a box on the **unrotated page** (a
   * fraction of it) with its page number — so, unlike a drawn
   * highlight, it survives rotation and turning the page: it is drawn
   * on whichever page it belongs to, turned with the page.
   *
   * The lasso is drawn freehand; on release the words whose centres are
   * inside it are sent to the form, which puts them in the field that
   * had focus. `wordsFor()` gives a page's words once and keeps them.
   */
  const link = deps.docLink ? deps.docLink(invoiceId) : null;
  let located = [];
  let lassoMode = false;
  let lassoPath = null;
  let lassoed = null;
  const wordCache = new Map();
  const hint = el("span", { class: "vhint", role: "status" });

  function setHint(key) {
    hint.textContent = key ? t(key) : "";
  }

  async function wordsFor(source) {
    if (!wordCache.has(source)) {
      wordCache.set(
        source,
        (async () => {
          const loaded = await source.load(deps);
          return (deps.pageWords ? await deps.pageWords(source, loaded, { invoiceId }) : null) ?? null;
        })()
      );
    }
    return wordCache.get(source);
  }

  function setLassoMode(on) {
    lassoMode = on;
    lassoBtn.classList.toggle("on", on);
    canvasHolder.classList.toggle("lassoing", on);
    if (on && highlightMode) {
      highlightMode = false;
      highlightBtn.classList.remove("on");
      canvasHolder.classList.remove("highlighting");
    }
    setHint(on ? "viewer.lasso.hint" : null);
  }

  const lassoBtn = iconButton("lasso", t("viewer.lasso"), () => setLassoMode(!lassoMode));

  /**
   * Waits for `work` (a page being read — 0698), saying so on the toolbar
   * if it takes more than a moment, as the first read of a scan does.
   */
  async function whileReading(work) {
    const timer = setTimeout(() => setHint("viewer.ocr.reading"), 300);
    try {
      return await work;
    } finally {
      clearTimeout(timer);
      if (hint.textContent === t("viewer.ocr.reading")) setHint(null);
    }
  }

  async function showValue(message) {
    lassoed = null;
    const all = [];
    for (const source of pages) {
      const words = await whileReading(wordsFor(source));
      if (words) all.push({ pageNumber: source.pageNumber, words });
    }
    if (!all.length) {
      located = [];
      setHint("viewer.locate.notext");
      renderHighlights();
      link?.send("located", { field: message.field, count: 0, readable: false });
      return;
    }
    // A line's value is looked for beside its description: find that first (0697).
    const nearFound = message.near?.value ? locate(all, message.near)[0] : null;
    const near = nearFound ? { pageNumber: nearFound.pageNumber, box: nearFound.box } : null;
    located = locate(all, { field: message.field, value: message.value, kind: message.kind, near });
    setHint(located.length ? null : "viewer.locate.notfound");
    link?.send("located", { field: message.field, count: located.length, readable: true, best: located[0] ? { pageNumber: located[0].pageNumber, box: located[0].box } : null });
    const best = located[0];
    if (best) {
      const index = pages.findIndex((p) => p.pageNumber === best.pageNumber);
      if (index >= 0 && index !== current) await selectPage(index, { keepLocated: true });
      else renderHighlights();
      scrollToBox(best.box);
    } else {
      renderHighlights();
    }
  }

  /** Brings a found value into view when the page is zoomed past the card. */
  function scrollToBox(box) {
    const shown = rotateBox(box, rotation);
    const cx = canvas.offsetLeft + (shown.x + shown.w / 2) * canvas.offsetWidth;
    const cy = canvas.offsetTop + (shown.y + shown.h / 2) * canvas.offsetHeight;
    canvasHolder.scrollLeft = Math.max(0, cx - canvasHolder.clientWidth / 2);
    canvasHolder.scrollTop = Math.max(0, cy - canvasHolder.clientHeight / 2);
  }

  async function finishLasso(path) {
    const source = pages[current];
    if (!source || path.length < 3) return;
    const box = canvas.getBoundingClientRect();
    const xs = path.map((p) => p.x * box.width);
    const ys = path.map((p) => p.y * box.height);
    if (Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) < MIN_DRAG) return;
    // A page with no words at all is one Tesseract could not read (0698): the lasso can still go to the AI (0699).
    const words = (await whileReading(wordsFor(source))) ?? [];
    const read = words.length === 0 || words.some((w) => w.conf !== undefined) ? "ocr" : "text";
    const polygon = path.map((p) => unrotatePoint(p, rotation));
    const taken = wordsInLasso(words, polygon);
    if (!taken.words.length && read === "text") {
      setHint("viewer.lasso.empty");
      return;
    }
    const area = polygonBox(polygon);
    lassoed = { pageNumber: source.pageNumber, box: taken.box ?? area, area, source };
    located = [];
    setHint(null);
    renderHighlights();
    link?.send("lassoed", {
      text: taken.text,
      pageNumber: source.pageNumber,
      box: taken.box,
      wordCount: taken.words.length,
      source: read,
      // How sure Tesseract was of the least certain word: the form asks the AI below a threshold (0699).
      confidence: read === "ocr" ? (taken.words.length ? Math.min(...taken.words.map((w) => w.conf ?? 0)) : 0) : 100,
      context: contextFor(words, taken.box ?? area, taken.words),
    });
  }

  /**
   * **The AI reads the lassoed part of the page — decision 0699.** Asked
   * by the form, which knows the field: when Tesseract was unsure of the
   * words, they were not the field's kind of value, or no field had focus
   * and the form wants to know which field this is. The cut-out is the
   * lasso's own area, a little larger, at full resolution.
   */
  async function readWithAi(request) {
    const shownLasso = lassoed;
    if (!shownLasso || !deps.cropRegion || !deps.readRegion) return link?.send("filled", { ok: false, reason: "viewer.lasso.ai.failed" });
    setHint("viewer.lasso.ai.reading");
    try {
      const loaded = await shownLasso.source.load(deps);
      const image = await deps.cropRegion(shownLasso.source, loaded, shownLasso.area, { invoiceId });
      const answer = await deps.readRegion(invoiceId, {
        image,
        contentType: "image/jpeg",
        kind: request.kind ?? null,
        label: request.label ?? null,
        ocrText: request.ocrText ?? "",
        context: request.context ?? "",
        fields: request.fields ?? [],
      });
      if (lassoed !== shownLasso) return;
      if (!answer.ok) {
        setHint(answer.reason === "ai_allowance" ? "viewer.lasso.ai.allowance" : "viewer.lasso.ai.failed");
        return;
      }
      setHint(null);
      link?.send("lassoed", {
        text: answer.text ?? "",
        pageNumber: shownLasso.pageNumber,
        box: shownLasso.box,
        source: "ai",
        suggested: answer.field ?? null,
        confidence: 100,
      });
    } catch {
      if (lassoed === shownLasso) setHint("viewer.lasso.ai.failed");
    }
  }

  /** "Looks like Due date · Put it there" — the AI's suggestion, offered, not applied (0699). */
  function offerSuggestion(message) {
    const put = el("button", { class: "vsuggest", text: t("viewer.lasso.suggest.put") });
    put.onclick = () => link?.send("fillField", { field: message.suggestion.field, text: message.text ?? "" });
    hint.replaceChildren(document.createTextNode(`${t("viewer.lasso.suggest").replace("{field}", message.suggestion.label ?? "")} · `), put);
  }

  /**
   * Whether this viewer is still on screen. One that has been replaced
   * (another invoice opened, the card redrawn) closes its end of the link
   * the next time it hears anything, rather than answering for a page
   * nobody can see.
   */
  let shown = false;
  function live() {
    if (root.isConnected) {
      shown = true;
      return true;
    }
    if (shown) link?.close();
    return false;
  }

  link?.on("locate", (message) => {
    ready.then(() => {
      if (live()) showValue(message);
    });
  });
  // The form's answer to a lasso: which field it filled, or why it could not.
  link?.on("readRegion", (request) => {
    if (live() && lassoed) readWithAi(request);
  });
  link?.on("filled", (message) => {
    if (!live() || !lassoed) return;
    if (!message.ok && message.suggestion) return offerSuggestion(message);
    hint.textContent = message.ok
      ? t("viewer.lasso.filled").replace("{field}", message.label ?? "")
      : t(message.reason ?? "viewer.lasso.nofield").replace("{field}", message.label ?? "");
  });
  link?.on("clear", () => {
    if (!live()) return;
    located = [];
    lassoed = null;
    if (!lassoMode) setHint(null);
    renderHighlights();
  });

  const controls = el("div", { class: "vcontrols" }, [
    zoomOutBtn,
    zoomInBtn,
    rotateBtn,
    prevBtn,
    nextBtn,
    highlightBtn,
    lassoBtn,
    hint,
    status,
  ]);
  const canvasHolder = el("div", { class: "vcanvasholder" }, [canvas]);
  const highlightLayer = el("div", { class: "vhighlightlayer" });
  canvasHolder.append(highlightLayer);
  const main = el("div", { class: "vmain" }, [controls, canvasHolder]);
  const root = el("div", { class: "vpagesroot" }, [rail, main]);

  /**
   * **Drag to pan, once zoomed in past fit** — decision 0392, asked
   * for directly: *"use the mouse pointer to drag around the page."*
   * Pointer capture, not a `mousemove`/`mouseup` pair on `window` —
   * the usual way to keep a drag tracking once the cursor leaves the
   * element it started in. A `window` listener would work the same
   * way but would need removing again the moment this widget is torn
   * down, and nothing here ever tears one down explicitly (a fresh
   * `pageViewer()` call per document, per decision 0382's own design);
   * capture avoids the leak by never attaching to `window` at all —
   * `pointerup`/`pointercancel` release it automatically.
   */
  let dragging = false;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartLeft = 0;
  let dragStartTop = 0;

  /**
   * **A drag under the highlight tool draws instead of pans** — the
   * same pointer-capture gesture decision 0392 built for panning, but
   * `highlightMode` sends it to a different outcome rather than
   * duplicating the capture/release plumbing. `dragBox` is the
   * in-progress rectangle, in the same box-fraction coordinates
   * `highlights` itself uses, redrawn live as the pointer moves.
   * `MIN_DRAG` throws out anything that was really a click — the same
   * gesture used to remove an existing highlight, below.
   */
  const MIN_DRAG = 4;
  let dragOriginXFrac = 0;
  let dragOriginYFrac = 0;

  function pointToFraction(e) {
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  }

  function removeHighlightAt(frac) {
    const hit = [...highlights]
      .reverse()
      .find((h) => frac.x >= h.x && frac.x <= h.x + h.w && frac.y >= h.y && frac.y <= h.y + h.h);
    if (!hit) return false;
    highlights = highlights.filter((h) => h !== hit);
    return true;
  }

  canvasHolder.addEventListener("pointerdown", (e) => {
    if (lassoMode) {
      lassoPath = [pointToFraction(e)];
      canvasHolder.setPointerCapture?.(e.pointerId);
      return;
    }
    if (highlightMode) {
      const frac = pointToFraction(e);
      dragOriginXFrac = frac.x;
      dragOriginYFrac = frac.y;
      dragBox = { x: frac.x, y: frac.y, w: 0, h: 0 };
      canvasHolder.setPointerCapture?.(e.pointerId);
      return;
    }
    dragging = true;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartLeft = canvasHolder.scrollLeft;
    dragStartTop = canvasHolder.scrollTop;
    canvasHolder.classList.add("dragging");
    // Optional chaining: jsdom (decision 0121) has no such method, and
    // this must stay a harmless no-op there rather than throw.
    canvasHolder.setPointerCapture?.(e.pointerId);
  });
  canvasHolder.addEventListener("pointermove", (e) => {
    if (lassoMode) {
      if (!lassoPath) return;
      lassoPath.push(pointToFraction(e));
      renderHighlights();
      return;
    }
    if (highlightMode) {
      if (!dragBox) return;
      const frac = pointToFraction(e);
      dragBox = {
        x: Math.min(dragOriginXFrac, frac.x),
        y: Math.min(dragOriginYFrac, frac.y),
        w: Math.abs(frac.x - dragOriginXFrac),
        h: Math.abs(frac.y - dragOriginYFrac),
      };
      renderHighlights();
      return;
    }
    if (!dragging) return;
    canvasHolder.scrollLeft = dragStartLeft - (e.clientX - dragStartX);
    canvasHolder.scrollTop = dragStartTop - (e.clientY - dragStartY);
  });
  function stopHighlightDrag(e) {
    if (!dragBox) return;
    const box = canvas.getBoundingClientRect();
    const movedPixels = Math.max(dragBox.w * box.width, dragBox.h * box.height);
    if (movedPixels < MIN_DRAG) {
      // A click, not a drag: remove whatever highlight is under it
      // instead of adding a zero-size one nobody could see or select
      // again.
      removeHighlightAt(pointToFraction(e));
    } else {
      highlights = [...highlights, dragBox];
    }
    dragBox = null;
    renderHighlights();
  }
  const stopDragging = () => {
    dragging = false;
    canvasHolder.classList.remove("dragging");
  };
  canvasHolder.addEventListener("pointerup", (e) => {
    if (lassoMode) {
      const path = lassoPath ? [...lassoPath, pointToFraction(e)] : [];
      lassoPath = null;
      renderHighlights();
      return finishLasso(path);
    }
    if (highlightMode) return stopHighlightDrag(e);
    stopDragging();
  });
  canvasHolder.addEventListener("pointercancel", () => {
    if (lassoMode) {
      lassoPath = null;
      renderHighlights();
      return;
    }
    if (highlightMode) {
      dragBox = null;
      renderHighlights();
      return;
    }
    stopDragging();
  });

  function highlightStyle(box) {
    return `left:${box.x * 100}%; top:${box.y * 100}%; width:${box.w * 100}%; height:${box.h * 100}%;`;
  }

  /**
   * Repositions the overlay to sit exactly over the canvas's own
   * rendered box, then draws every highlight (plus the in-progress
   * drag, if any) as a percentage of that box — see the field
   * declarations above for why a percentage of *this* box is the
   * right unit to store and draw in.
   */
  function renderHighlights() {
    highlightLayer.style.left = `${canvas.offsetLeft}px`;
    highlightLayer.style.top = `${canvas.offsetTop}px`;
    highlightLayer.style.width = `${canvas.offsetWidth}px`;
    highlightLayer.style.height = `${canvas.offsetHeight}px`;
    const pageNumber = pages[current]?.pageNumber;
    const onPage = located.filter((found) => found.pageNumber === pageNumber);
    highlightLayer.replaceChildren(
      ...highlights.map((box) => el("div", { class: "vhighlight", style: highlightStyle(box) })),
      ...(dragBox ? [el("div", { class: "vhighlight vhighlightdraft", style: highlightStyle(dragBox) })] : []),
      // Decision 0697: where the field's value is — the best place solid, any other dashed.
      ...onPage.map((found) =>
        el("div", { class: found === located[0] ? "vlocate best" : "vlocate", style: highlightStyle(pad(rotateBox(found.box, rotation))) })
      ),
      ...(lassoed && lassoed.pageNumber === pageNumber ? [el("div", { class: "vlassoed", style: highlightStyle(pad(rotateBox(lassoed.box, rotation))) })] : []),
      ...(lassoPath && lassoPath.length > 1 ? [lassoShape(lassoPath)] : [])
    );
  }

  /** A found box a touch larger than its words, so the outline does not sit on the ink. */
  function pad(box) {
    const px = 0.004;
    const py = 0.003;
    return { x: Math.max(0, box.x - px), y: Math.max(0, box.y - py), w: Math.min(1, box.w + 2 * px), h: Math.min(1, box.h + 2 * py) };
  }

  /** The lasso being drawn: an SVG line over the page, in the same fractions as everything else. */
  function lassoShape(path) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "vlassopath");
    svg.setAttribute("viewBox", "0 0 1 1");
    svg.setAttribute("preserveAspectRatio", "none");
    const line = document.createElementNS(ns, "polygon");
    line.setAttribute("points", path.map((p) => `${p.x},${p.y}`).join(" "));
    line.setAttribute("vector-effect", "non-scaling-stroke");
    svg.append(line);
    return svg;
  }

  function pageLabel(pageNumber, total) {
    return t("viewer.pageof").replace("{n}", String(pageNumber)).replace("{total}", String(total));
  }

  async function draw() {
    const source = pages[current];
    if (!source) return;
    zoomOutBtn.disabled = zoomIndex === 0;
    zoomInBtn.disabled = zoomIndex === ZOOM_STEPS.length - 1;
    prevBtn.disabled = current === 0;
    nextBtn.disabled = current === pages.length - 1;
    status.textContent = pageLabel(current + 1, pages.length);
    /**
     * **Escapes `.vcanvas`'s own width clamp once zoomed in past the
     * default** — decision 0392, the other half of the same request:
     * *"the user will want to zoom into the image detail past max
     * width."* Below and at the default step the clamp is what makes
     * the initial view fit the card at all (most scanned invoices are
     * already wider than it); past that step it only ever suppressed
     * the zoom the person just asked for, drawing at a higher
     * resolution behind the same fixed box rather than actually
     * showing more of it. `canvasHolder`'s own `overflow: auto`
     * (decision 0382) is what turns the lifted clamp into a
     * scrollable, panned view rather than an overflowing mess.
     */
    const zoomedIn = zoomIndex > DEFAULT_ZOOM_INDEX;
    canvas.classList.toggle("zoomedin", zoomedIn);
    canvasHolder.classList.toggle("pannable", zoomedIn);
    await renderPage(source, canvas, { zoom: ZOOM_STEPS[zoomIndex], rotation }, deps);
    renderHighlights();
  }

  function selectPage(index, { keepLocated = false } = {}) {
    current = index;
    if (!keepLocated) lassoed = null;
    for (const [i, btn] of railButtons.entries()) btn.className = i === index ? "vrailthumb on" : "vrailthumb";
    // A highlight is drawn against one page's own content — carrying
    // it over to whichever page happens to occupy the same box
    // fraction on arrival would be showing it over the wrong thing,
    // the same reasoning the rotation handler above already follows.
    highlights = [];
    return draw();
  }

  async function load() {
    pages = await deps.resolvePages(invoiceId, contentType, deps);

    if (pages.length === 0) {
      // A document nothing retained is a real state, not a failure: an
      // invoice can exist with no original at all.
      root.replaceChildren(empty);
      return;
    }

    railButtons = pages.map((source, index) => {
      const thumbCanvas = el("canvas", { class: "vrailcanvas" });
      const btn = el("button", { class: index === 0 ? "vrailthumb on" : "vrailthumb", "aria-label": pageLabel(source.pageNumber, pages.length) }, [
        thumbCanvas,
      ]);
      btn.onclick = () => selectPage(index);
      // Not awaited: a slow thumbnail should not hold up the main view,
      // the same reasoning `showPreview()` never awaited its own fetch.
      renderPage(source, thumbCanvas, { fitWidth: 64, rotation: 0 }, deps);
      return btn;
    });

    rail.replaceChildren(...railButtons);
    rail.hidden = pages.length <= 1;
    current = 0;
    await draw();
  }

  // Fire-and-forget from the caller's point of view, matching
  // `showPreview()`'s own contract — the caller gets the root node
  // immediately and content fills in once the first fetch resolves.
  // Kept so a field clicked before the pages arrive waits for them (0697).
  // A page that fails to draw must not stop its words being searched.
  const ready = load().catch(() => {});

  return root;
}
