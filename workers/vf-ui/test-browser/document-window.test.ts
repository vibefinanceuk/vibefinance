import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The document pop-out window's own bootstrap, in a DOM — decision
 * 0384, phase 4 of docs/design/document-viewer.md.
 *
 * `viewer.test.ts`'s own "the document pop-out window" describe block
 * covers the *opener's* side — `openDocumentWindow()`, the placeholder,
 * the retarget-on-task-switch. This file covers the pop-out's own
 * page: `initDocumentWindow()` (exported from viewer.js, shared with
 * the embedded panel) and `document-window.js`'s thin bootstrap around
 * it.
 */

function mountDocWindow() {
  document.body.innerHTML = `
    <main id="docwindow-root"></main>
    <link id="brand" />
  `;
  // jsdom carries `document.title` across tests in the same file (no
  // real navigation resets it) — reset it here so a title assertion in
  // one test can't pass or fail on what an earlier test left behind.
  document.title = "";
}

const STRINGS = {
  locale: "en",
  strings: {
    "viewer.document": "Document",
    "viewer.nodocument": "No document retained",
    "viewer.xmltab": "XML",
    "viewer.tried": "Tried:",
    "viewer.unreadable": "This document could not be read automatically. Please manually enter the fields in the cells provided.",
    "action.close": "Close",
    "activity.timelinetab": "Timeline / Chat",
    "activity.systemalert": "System Alert",
    "activity.loading": "Loading…",
    "activity.empty": "Nothing here yet.",
    "activity.placeholder": "Leave a note for your team…",
    "activity.post": "Post",
    "activity.internalonly": "Internal only — not visible to the supplier.",
    "activity.loadfailed": "Could not load the activity for this document.",
    "activity.postfailed": "That did not post. Try again.",
    "activity.received": "Invoice received",
    "activity.stagecompleted": "{who} completed {stage}",
    "activity.rulefired": "Business rule '{rule}' fired: {actions}",
  },
};

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path in routes) return { ok: true, json: async () => routes[path] } as Response;
      if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
        return { ok: true, json: async () => ({ pages: [] }) } as Response;
      }
      throw new Error(`no stub for ${path} — add one, or the test proves nothing`);
    })
  );
}

beforeEach(() => {
  mountDocWindow();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("initDocumentWindow — the same panel the embedded card shows, mounted alone", () => {
  it("mounts the Document tab (not Timeline / Chat, which is no longer a tab here) and a Close button that closes the window", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
      "/api/documents/inv-1/activity": { items: [] },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { initDocumentWindow } = await import("/viewer.js");

    const root = document.getElementById("docwindow-root") as HTMLElement;
    await initDocumentWindow("inv-1", root);

    /**
     * **Decision 0394**: Timeline / Chat became a standing right-hand
     * column here, not a third tab — asked for directly: *"the
     * timeline / chat should appear on the right of the invoice
     * image... when expanded in the separate window only."* Document
     * is still the one (and, without a hybrid PDF, only) tab.
     */
    const labels = [...root.querySelectorAll(".doctab span")].map((n) => n.textContent);
    expect(labels).toContain("Document");
    expect(labels).not.toContain("Timeline / Chat");

    const closeSpy = vi.fn();
    vi.stubGlobal("close", closeSpy);
    const closeButton = [...root.querySelectorAll(".actionlink")].find(
      (n) => n.querySelector("span")?.textContent === "Close"
    ) as HTMLElement;
    expect(closeButton).not.toBeUndefined();
    closeButton.click();
    expect(closeSpy).toHaveBeenCalled();
  });

  it("offers the XML tab for a hybrid PDF here too, not only in the embedded card", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: { contentType: "application/pdf" },
        embeddedXmlDocument: { contentType: "application/xml" },
      },
      "/api/documents/inv-1/activity": { items: [] },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { initDocumentWindow } = await import("/viewer.js");

    const root = document.getElementById("docwindow-root") as HTMLElement;
    await initDocumentWindow("inv-1", root);

    const labels = [...root.querySelectorAll(".doctab span")].map((n) => n.textContent);
    expect(labels).toContain("XML");
  });

  /**
   * **Decision 0394** — the split itself: Document (and XML, when
   * offered) on the left, Timeline / Chat standing on the right,
   * always visible rather than switched to.
   */
  it("lays out Document/XML on the left and Timeline / Chat on the right, both present at once", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
      "/api/documents/inv-1/activity": { items: [] },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { initDocumentWindow } = await import("/viewer.js");

    const root = document.getElementById("docwindow-root") as HTMLElement;
    await initDocumentWindow("inv-1", root);

    const left = root.querySelector(".docwindowsplitleft");
    const right = root.querySelector(".docwindowsplitright");
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left?.querySelector("#vpreview")).not.toBeNull();
    const timeline = right?.querySelector(".docwindowtimeline") as HTMLElement | null | undefined;
    expect(timeline).not.toBeNull();
    expect(timeline?.hidden).toBe(false);
  });

  /**
   * **The bug the shared `select()` closure would otherwise cause**:
   * it loops over every entry `buildDocTabs()` built, timeline
   * included, hiding whatever key was not just clicked — so clicking
   * Document or XML would re-hide the standing timeline column unless
   * something puts it back. This is that something, checked directly.
   */
  it("keeps the Timeline / Chat column visible after switching to the XML tab", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-1": {
        facts: {},
        lines: [],
        validation: { passed: true, checked: [], failures: [] },
        originalDocument: { contentType: "application/pdf" },
        embeddedXmlDocument: { contentType: "application/xml" },
      },
      "/api/documents/inv-1/activity": { items: [] },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { initDocumentWindow } = await import("/viewer.js");

    const root = document.getElementById("docwindow-root") as HTMLElement;
    await initDocumentWindow("inv-1", root);

    const xmlTabButton = [...root.querySelectorAll(".doctab")].find((b) => b.textContent?.includes("XML")) as HTMLElement;
    xmlTabButton.click();

    const timeline = root.querySelector(".docwindowtimeline") as HTMLElement;
    expect(timeline.hidden).toBe(false);
  });

  it("has no expand button and no pop-out placeholder — there is nowhere further out to go", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
      "/api/documents/inv-1/activity": { items: [] },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { initDocumentWindow } = await import("/viewer.js");

    const root = document.getElementById("docwindow-root") as HTMLElement;
    await initDocumentWindow("inv-1", root);

    const labels = [...root.querySelectorAll(".actionlink span")].map((n) => n.textContent);
    expect(labels).not.toContain("Expand");
    expect(root.querySelector(".vpoppedout")).toBeNull();
  });
});

describe("document-window.js's own bootstrap", () => {
  function stubLocationSearch(search: string) {
    Object.defineProperty(window, "location", {
      value: { search },
      writable: true,
      configurable: true,
    });
  }

  it("reads the invoice id from ?task= and mounts the panel for it", async () => {
    stubLocationSearch("?task=inv-7");
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-7": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
      "/api/documents/inv-7/activity": { items: [] },
    });

    await import("/document-window.js");
    // The module's own top-level `boot()` call is not awaited by the
    // import itself; give its promise chain a turn to settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.querySelector(".doctabs")).not.toBeNull();
    expect(document.title).toBe("Document");
  });

  it("says there is no document, rather than crash, when the URL carries no ?task=", async () => {
    stubLocationSearch("");
    stubFetch({ "/api/ui-strings": STRINGS });

    await import("/document-window.js");
    await new Promise((resolve) => setTimeout(resolve, 0));

    // `toContain` alone is not enough here: `viewer.nodocument` is also
    // what page-renderer.js shows for a *real* invoice with zero pages
    // (decision 0380), and this file's own `stubFetch` fallback answers
    // any `/pages` route with `{ pages: [] }` — so a version of this
    // guard that let a null invoiceId through to `initDocumentWindow`
    // would render a whole panel that *also* contains this string,
    // and a substring check would not catch it. Asserting the root's
    // *entire* text — set in one assignment by the guard itself, never
    // by the panel it guards against — is what actually distinguishes
    // "never rendered a panel" from "rendered a panel that happens to
    // say this somewhere inside it". The title check catches the same
    // distinction a second way: only the code past the guard sets it.
    expect(document.getElementById("docwindow-root")?.textContent).toBe("No document retained");
    expect(document.title).not.toBe("Document");
  });
});
