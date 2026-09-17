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
});
