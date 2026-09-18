import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolvePages, pageViewer, ZOOM_STEPS, DEFAULT_ZOOM_INDEX, REAL_DEPS } from "/page-renderer.js";

/**
 * The page renderer — decision 0382, phase 2 of
 * `docs/design/document-viewer.md`.
 *
 * **Nothing here runs a real PDF engine or decodes a real image.**
 * `jsdom` (decision 0121) has no working canvas 2D context and no
 * image decoder, so every dependency `resolvePages()` and `pageViewer()`
 * call is injected — the same seam `documentFrame()`'s own `mint`
 * parameter uses (decision 0380). What is tested is the orchestration:
 * which pages get resolved, which ones get drawn, and what rotate,
 * zoom and page selection do to that — not what a pixel looks like.
 */

function pdfStub(numPages: number) {
  return { numPages, getPage: vi.fn(async (n: number) => ({ pageNumber: n })) };
}

function baseDeps(overrides: Record<string, unknown> = {}) {
  return {
    listRetainedPages: vi.fn(async () => []),
    mintPageUrl: vi.fn(async () => "https://vf-app.example/document-pages/tok"),
    mintDocumentUrl: vi.fn(async () => "https://vf-app.example/documents/tok"),
    loadPdfDocument: vi.fn(async () => null),
    loadPdfPage: vi.fn(async (pdf: { getPage: (n: number) => unknown }, n: number) => pdf.getPage(n)),
    loadImage: vi.fn(async () => ({ naturalWidth: 100, naturalHeight: 200 })),
    drawPdfPage: vi.fn(async () => {}),
    drawImage: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("REAL_DEPS carries everything the widget and resolvePages call", () => {
  // The bug this guards against already happened once while building
  // this file: `pageViewer()` called `deps.resolvePages`, and the real
  // dependency object had no such key. Every test above injects its own
  // `deps`, which would never have caught it — this checks the object
  // actually shipped, not a stand-in for it.
  it.each([
    "listRetainedPages",
    "mintPageUrl",
    "mintDocumentUrl",
    "loadPdfDocument",
    "loadPdfPage",
    "loadImage",
    "drawPdfPage",
    "drawImage",
    "resolvePages",
  ])("defines %s as a function", (key) => {
    expect(typeof (REAL_DEPS as Record<string, unknown>)[key]).toBe("function");
  });
});

describe("resolvePages — telling the two shapes apart", () => {
  it("uses the retained pages when there are any, never looking at the single document at all", async () => {
    const deps = baseDeps({
      listRetainedPages: vi.fn(async () => [
        { pageNumber: 1, contentType: "image/jpeg" },
        { pageNumber: 2, contentType: "image/png" },
      ]),
    });
    const pages = await resolvePages("inv-1", "application/pdf", deps);
    expect(pages.map((p) => [p.pageNumber, p.kind])).toEqual([
      [1, "image"],
      [2, "image"],
    ]);
    // The single-document path was never consulted — the retained
    // pages answered the question by themselves.
    expect(deps.mintDocumentUrl).not.toHaveBeenCalled();
  });

  it("mints each retained page's own URL, by its own page number", async () => {
    const deps = baseDeps({
      listRetainedPages: vi.fn(async () => [{ pageNumber: 3, contentType: "image/png" }]),
    });
    const [page] = await resolvePages("inv-1", null, deps);
    await page.urlFor();
    expect(deps.mintPageUrl).toHaveBeenCalledWith("inv-1", 3);
  });

  it("returns nothing for an invoice with no retained pages and no content type", async () => {
    const pages = await resolvePages("inv-1", null, baseDeps());
    expect(pages).toEqual([]);
  });

  it("treats a single retained image as one page", async () => {
    const pages = await resolvePages("inv-1", "image/jpeg", baseDeps());
    expect(pages).toHaveLength(1);
    expect(pages[0]).toMatchObject({ pageNumber: 1, kind: "image" });
  });

  it("opens a single retained PDF and enumerates its own internal pages", async () => {
    const deps = baseDeps({ loadPdfDocument: vi.fn(async () => pdfStub(3)) });
    const pages = await resolvePages("inv-1", "application/pdf", deps);
    expect(pages.map((p) => [p.pageNumber, p.kind])).toEqual([
      [1, "pdf"],
      [2, "pdf"],
      [3, "pdf"],
    ]);
  });

  it("returns nothing when a PDF is declared retained but nothing mints a URL for it", async () => {
    const deps = baseDeps({ mintDocumentUrl: vi.fn(async () => null) });
    expect(await resolvePages("inv-1", "application/pdf", deps)).toEqual([]);
  });

  it("returns nothing when pdf.js cannot open what was retained, rather than throwing", async () => {
    const deps = baseDeps({ loadPdfDocument: vi.fn(async () => null) });
    expect(await resolvePages("inv-1", "application/pdf", deps)).toEqual([]);
  });
});

describe("pageViewer — the widget", () => {
  /**
   * `t()` (`strings.js`) returns the raw key until `loadStrings()` has
   * run (decision 0107) — so the rotate/zoom buttons carry
   * `aria-label="viewer.rotate"` etc. rather than "Rotate" unless this
   * runs first, the same stub-and-load pattern `purchase-orders.test.ts`
   * already uses.
   */
  const STRINGS = {
    locale: "en",
    strings: {
      "viewer.nodocument": "No document is retained for this invoice.",
      "viewer.thumbnails": "Page thumbnails",
      "viewer.pageof": "Page {n} of {total}",
      "viewer.rotate": "Rotate",
      "viewer.zoomin": "Zoom in",
      "viewer.zoomout": "Zoom out",
      "viewer.previouspage": "Previous page",
      "viewer.nextpage": "Next page",
      "viewer.highlight": "Highlight",
    },
  };

  beforeEach(async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        throw new Error(`no stub for ${path} — page-viewer's own data comes through injected deps, not fetch`);
      })
    );
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mountedRail(root: HTMLElement) {
    return Array.from(root.querySelectorAll(".vrailthumb"));
  }

  it("shows the no-document message when resolvePages finds nothing", async () => {
    const deps = baseDeps({ resolvePages: vi.fn(async () => []) });
    const root = pageViewer("inv-1", null, deps);
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector(".vthumb")).toBeTruthy();
    expect(root.querySelector(".vrail")).toBeFalsy();
  });

  it("draws the first page on open, at the default (1×) zoom and no rotation", async () => {
    const source = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [source]) });
    pageViewer("inv-1", "image/jpeg", deps);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.drawImage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      zoom: ZOOM_STEPS[DEFAULT_ZOOM_INDEX],
      rotation: 0,
    });
  });

  it("builds one thumbnail per page, and hides the rail entirely for a single page", async () => {
    const single = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [single]) });
    const root = pageViewer("inv-1", "image/jpeg", deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelector(".vrail")?.hidden).toBe(true);
  });

  it("shows the rail for more than one page, one thumbnail each, first one selected", async () => {
    const pages = [1, 2, 3].map((n) => ({ pageNumber: n, kind: "image", load: vi.fn(async () => ({})) }));
    const deps = baseDeps({ resolvePages: vi.fn(async () => pages) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    const thumbs = mountedRail(root);
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0].className).toContain("on");
    expect(thumbs[1].className).not.toContain("on");
  });

  it("clicking a thumbnail switches the main view to that page and moves the selection", async () => {
    const pages = [1, 2].map((n) => ({ pageNumber: n, kind: "image", load: vi.fn(async () => ({ page: n })) }));
    const deps = baseDeps({ resolvePages: vi.fn(async () => pages) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    deps.drawImage.mockClear();
    const thumbs = mountedRail(root) as HTMLButtonElement[];
    thumbs[1].click();
    await Promise.resolve();
    await Promise.resolve();

    expect(thumbs[0].className).not.toContain("on");
    expect(thumbs[1].className).toContain("on");
    // The main view was redrawn from page 2's own loaded content, not
    // page 1's still-cached one.
    expect(deps.drawImage).toHaveBeenCalledWith({ page: 2 }, expect.anything(), expect.anything());
  });

  it("rotate cycles 0 → 90 → 180 → 270 → 0, redrawing the current page each time", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const rotateBtn = root.querySelector('[aria-label="Rotate"]') as HTMLButtonElement;
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      rotateBtn.click();
      await Promise.resolve();
      await Promise.resolve();
      seen.push(deps.drawImage.mock.calls.at(-1)![2].rotation);
    }
    expect(seen).toEqual([90, 180, 270, 0, 90]);
  });

  it("zoom steps through ZOOM_STEPS and clamps at both ends, disabling the button there", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const zoomOut = root.querySelector('[aria-label="Zoom out"]') as HTMLButtonElement;
    const zoomIn = root.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;

    // Start at the middle step (1×). Zooming out all the way must stop
    // at the first step, not run off the front of the array.
    for (let i = 0; i < ZOOM_STEPS.length + 2; i++) {
      zoomOut.click();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(deps.drawImage.mock.calls.at(-1)![2].zoom).toBe(ZOOM_STEPS[0]);
    expect(zoomOut.disabled).toBe(true);

    for (let i = 0; i < ZOOM_STEPS.length + 2; i++) {
      zoomIn.click();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(deps.drawImage.mock.calls.at(-1)![2].zoom).toBe(ZOOM_STEPS.at(-1));
    expect(zoomIn.disabled).toBe(true);
  });

  /**
   * **Escapes `.vcanvas`'s own width clamp only past the default step
   * — decision 0392.** Asked for directly: *"the user will want to
   * zoom into the image detail past max width."* Below and at the
   * default, `app.css`'s `max-width: 100%` is what makes the initial
   * view fit the card — most scanned invoices already exceed it —
   * so this must not lift unconditionally, only once a zoom-in click
   * has gone past `DEFAULT_ZOOM_INDEX`, and must return the moment it
   * comes back down to it.
   */
  it("marks the canvas zoomedin (and the holder pannable) only once zoomed in past the default step", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const canvas = root.querySelector(".vcanvas") as HTMLElement;
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    const zoomOut = root.querySelector('[aria-label="Zoom out"]') as HTMLButtonElement;
    const zoomIn = root.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement;

    expect(canvas.className).not.toContain("zoomedin");
    expect(holder.className).not.toContain("pannable");

    zoomIn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(canvas.className).toContain("zoomedin");
    expect(holder.className).toContain("pannable");

    zoomOut.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(canvas.className).not.toContain("zoomedin");
    expect(holder.className).not.toContain("pannable");
  });

  /**
   * **Drag to pan, once there is somewhere to pan to — decision
   * 0392**, the other half of the same request: *"use the mouse
   * pointer to drag around the page."* Pointer capture (`.
   * setPointerCapture`) is what keeps a real drag tracking once the
   * cursor leaves the holder — jsdom (decision 0121) has no such
   * method, so the handler's own optional chaining is what is really
   * being checked here: that calling it through an element without
   * one does not throw, the same way it would not in a browser too
   * old to support it.
   */
  it("drags the holder's own scroll position by exactly the pointer's own delta", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    holder.scrollLeft = 0;
    holder.scrollTop = 0;

    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 200, clientY: 150 }));
    expect(holder.className).toContain("dragging");

    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 140, clientY: 100 }));
    expect(holder.scrollLeft).toBe(60);
    expect(holder.scrollTop).toBe(50);

    holder.dispatchEvent(new MouseEvent("pointerup"));
    expect(holder.className).not.toContain("dragging");

    // A move after release is not still a drag.
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 0, clientY: 0 }));
    expect(holder.scrollLeft).toBe(60);
    expect(holder.scrollTop).toBe(50);
  });

  it("reopening the widget starts fresh — no rotation or zoom carried over from the last document", async () => {
    // Decided in conversation: reset every time, a session convenience
    // rather than data worth a place to store it. Nothing in
    // `pageViewer()` persists state between calls, so this is really a
    // guard against somebody adding module-level state later.
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });

    const first = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    (first.querySelector('[aria-label="Rotate"]') as HTMLButtonElement).click();
    (first.querySelector('[aria-label="Zoom in"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();

    deps.drawImage.mockClear();
    pageViewer("inv-1", null, deps);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(deps.drawImage).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      zoom: ZOOM_STEPS[DEFAULT_ZOOM_INDEX],
      rotation: 0,
    });
  });

  /**
   * **Previous/next page cycling — decision 0394**, asked for
   * directly: *"next / previous page cycling on the top of the
   * document image viewer to the right of the rotate icon."* Calls
   * the same `selectPage()` the thumbnail rail already uses (proven
   * by the rail's own selection moving too, not just the main view
   * redrawing), so there is one "current page" mechanism, reached two
   * ways.
   */
  it("previous/next move through the pages, moving the rail's own selection too, and disable at each end", async () => {
    const pages = [1, 2, 3].map((n) => ({ pageNumber: n, kind: "image", load: vi.fn(async () => ({ page: n })) }));
    const deps = baseDeps({ resolvePages: vi.fn(async () => pages) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const prevBtn = root.querySelector('[aria-label="Previous page"]') as HTMLButtonElement;
    const nextBtn = root.querySelector('[aria-label="Next page"]') as HTMLButtonElement;
    const thumbs = mountedRail(root) as HTMLButtonElement[];

    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(false);

    nextBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(thumbs[1].className).toContain("on");
    expect(deps.drawImage).toHaveBeenLastCalledWith({ page: 2 }, expect.anything(), expect.anything());
    expect(prevBtn.disabled).toBe(false);
    expect(nextBtn.disabled).toBe(false);

    nextBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(thumbs[2].className).toContain("on");
    expect(nextBtn.disabled).toBe(true);

    prevBtn.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(thumbs[1].className).toContain("on");
    expect(deps.drawImage).toHaveBeenLastCalledWith({ page: 2 }, expect.anything(), expect.anything());
    expect(prevBtn.disabled).toBe(false);
  });

  it("hides the vrail affordance the same way for a single page, but previous/next still exist, both disabled", async () => {
    const single = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [single]) });
    const root = pageViewer("inv-1", "image/jpeg", deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const prevBtn = root.querySelector('[aria-label="Previous page"]') as HTMLButtonElement;
    const nextBtn = root.querySelector('[aria-label="Next page"]') as HTMLButtonElement;
    expect(prevBtn.disabled).toBe(true);
    expect(nextBtn.disabled).toBe(true);
  });

  /**
   * **The highlight tool — decision 0394, a small first cut.** These
   * tests stub `canvas.getBoundingClientRect()` directly: jsdom
   * (decision 0121) always reports a zero-size box for it, same as it
   * has no working canvas 2D context, and the highlight math needs a
   * real box to divide by. The pixel-for-pixel positioning this
   * produces on screen is a Playwright concern, the same split the
   * rest of this file already draws — what is checked here is the
   * orchestration: mode toggling, which drag becomes a highlight,
   * which becomes a removal, and when the set clears.
   */
  function stubCanvasBox(root: HTMLElement, box = { left: 0, top: 0, width: 200, height: 100 }) {
    const canvas = root.querySelector(".vcanvas") as HTMLElement;
    canvas.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height, x: box.left, y: box.top, toJSON() {} });
    return canvas;
  }

  it("the highlight tool toggles on and off, marking the button and switching the holder's cursor", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const highlightBtn = root.querySelector('[aria-label="Highlight"]') as HTMLButtonElement;
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;

    // `classList.contains`, not a substring check: "iconbutton" itself
    // contains the letters "on", which a `className.toContain("on")`
    // check (fine for "vrailthumb"/"doctab", used elsewhere in this
    // file) would wrongly match before the toggle ever ran.
    expect(highlightBtn.classList.contains("on")).toBe(false);
    expect(holder.className).not.toContain("highlighting");

    highlightBtn.click();
    expect(highlightBtn.classList.contains("on")).toBe(true);
    expect(holder.className).toContain("highlighting");

    highlightBtn.click();
    expect(highlightBtn.classList.contains("on")).toBe(false);
    expect(holder.className).not.toContain("highlighting");
  });

  it("dragging with the highlight tool on draws a highlight box, sized as a fraction of the canvas", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    stubCanvasBox(root);
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    (root.querySelector('[aria-label="Highlight"]') as HTMLButtonElement).click();

    // A 100×20 drag inside a 200×100 box is 50% wide, 20% tall.
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, clientY: 40 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 120, clientY: 40 }));

    const boxes = root.querySelectorAll(".vhighlight:not(.vhighlightdraft)");
    expect(boxes).toHaveLength(1);
    const style = (boxes[0] as HTMLElement).getAttribute("style") ?? "";
    expect(style).toContain("left:10%");
    expect(style).toContain("top:20%");
    expect(style).toContain("width:50%");
    expect(style).toContain("height:20%");
  });

  it("a plain click (no real drag) with the highlight tool on removes the highlight under it, instead of adding a zero-size one", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    stubCanvasBox(root);
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    (root.querySelector('[aria-label="Highlight"]') as HTMLButtonElement).click();

    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, clientY: 40 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 120, clientY: 40 }));
    expect(root.querySelectorAll(".vhighlight")).toHaveLength(1);

    // A click inside that same box: down and up in (almost) the same
    // spot, well under the drag threshold.
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 60, clientY: 30 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 61, clientY: 30 }));
    expect(root.querySelectorAll(".vhighlight")).toHaveLength(0);
  });

  it("rotating clears any highlights — a box fraction stops meaning the same place once the page turns", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    stubCanvasBox(root);
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    (root.querySelector('[aria-label="Highlight"]') as HTMLButtonElement).click();
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, clientY: 40 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 120, clientY: 40 }));
    expect(root.querySelectorAll(".vhighlight")).toHaveLength(1);

    (root.querySelector('[aria-label="Rotate"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelectorAll(".vhighlight")).toHaveLength(0);
  });

  it("switching page clears any highlights — a box belongs to the page it was drawn on", async () => {
    const pages = [1, 2].map((n) => ({ pageNumber: n, kind: "image", load: vi.fn(async () => ({ page: n })) }));
    const deps = baseDeps({ resolvePages: vi.fn(async () => pages) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    stubCanvasBox(root);
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    (root.querySelector('[aria-label="Highlight"]') as HTMLButtonElement).click();
    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 20, clientY: 20 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 120, clientY: 40 }));
    holder.dispatchEvent(new MouseEvent("pointerup", { clientX: 120, clientY: 40 }));
    expect(root.querySelectorAll(".vhighlight")).toHaveLength(1);

    (root.querySelector('[aria-label="Next page"]') as HTMLButtonElement).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(root.querySelectorAll(".vhighlight")).toHaveLength(0);
  });

  it("with the highlight tool off, a drag still pans as before, not draws", async () => {
    const page = { pageNumber: 1, kind: "image", load: vi.fn(async () => ({})) };
    const deps = baseDeps({ resolvePages: vi.fn(async () => [page]) });
    const root = pageViewer("inv-1", null, deps) as HTMLElement;
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    stubCanvasBox(root);
    const holder = root.querySelector(".vcanvasholder") as HTMLElement;
    holder.scrollLeft = 0;
    holder.scrollTop = 0;

    holder.dispatchEvent(new MouseEvent("pointerdown", { clientX: 200, clientY: 150 }));
    holder.dispatchEvent(new MouseEvent("pointermove", { clientX: 140, clientY: 100 }));
    expect(holder.scrollLeft).toBe(60);
    holder.dispatchEvent(new MouseEvent("pointerup"));

    expect(root.querySelectorAll(".vhighlight")).toHaveLength(0);
  });
});
