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
    draw();
  });

  const controls = el("div", { class: "vcontrols" }, [zoomOutBtn, zoomInBtn, rotateBtn, status]);
  const canvasHolder = el("div", { class: "vcanvasholder" }, [canvas]);
  const main = el("div", { class: "vmain" }, [controls, canvasHolder]);
  const root = el("div", { class: "vpagesroot" }, [rail, main]);

  function pageLabel(pageNumber, total) {
    return t("viewer.pageof").replace("{n}", String(pageNumber)).replace("{total}", String(total));
  }

  async function draw() {
    const source = pages[current];
    if (!source) return;
    zoomOutBtn.disabled = zoomIndex === 0;
    zoomInBtn.disabled = zoomIndex === ZOOM_STEPS.length - 1;
    status.textContent = pageLabel(current + 1, pages.length);
    await renderPage(source, canvas, { zoom: ZOOM_STEPS[zoomIndex], rotation }, deps);
  }

  function selectPage(index) {
    current = index;
    for (const [i, btn] of railButtons.entries()) btn.className = i === index ? "vrailthumb on" : "vrailthumb";
    draw();
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
  load();

  return root;
}
