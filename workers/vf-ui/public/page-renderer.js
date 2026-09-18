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
    highlightBtn.classList.toggle("on", highlightMode);
    canvasHolder.classList.toggle("highlighting", highlightMode);
  });

  const controls = el("div", { class: "vcontrols" }, [
    zoomOutBtn,
    zoomInBtn,
    rotateBtn,
    prevBtn,
    nextBtn,
    highlightBtn,
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
    if (highlightMode) return stopHighlightDrag(e);
    stopDragging();
  });
  canvasHolder.addEventListener("pointercancel", () => {
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
    highlightLayer.replaceChildren(
      ...highlights.map((box) => el("div", { class: "vhighlight", style: highlightStyle(box) })),
      ...(dragBox ? [el("div", { class: "vhighlight vhighlightdraft", style: highlightStyle(dragBox) })] : [])
    );
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

  function selectPage(index) {
    current = index;
    for (const [i, btn] of railButtons.entries()) btn.className = i === index ? "vrailthumb on" : "vrailthumb";
    // A highlight is drawn against one page's own content — carrying
    // it over to whichever page happens to occupy the same box
    // fraction on arrival would be showing it over the wrong thing,
    // the same reasoning the rotation handler above already follows.
    highlights = [];
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
