import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The document manager — decisions 0164, 0165.
 *
 * **Every way into a document was a task**, so an invoice that went
 * straight through was invisible.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

/**
 * **Defaults `/invoices/:id/pages` to "no retained pages"** (decision
 * 0381), asked by every open document through `pageViewer()` (decision
 * 0382) — a question this file's own tests are not about. Same call
 * `viewer.test.ts`'s own `stubFetch` makes, for the same reason.
 */
function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path in routes) return { ok: true, json: async () => routes[path] } as Response;
      if (/^\/api\/invoices\/[^/]+\/pages$/.test(path)) {
        return { ok: true, json: async () => ({ pages: [] }) } as Response;
      }
      throw new Error(`no stub for ${path}`);
    })
  );
}

const STRINGS = {
  locale: "en",
  strings: {
    "viewer.back": "Back",
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
    "mood.label": "Mood",
    "mood.day": "Day",
    "mood.night": "Night",
    "documents.subtitle": "Everything that has arrived",
    "documents.searchhint": "Supplier, document number, or amount",
    "documents.choosecolumns": "Choose columns",
    "documents.none": "Nothing has arrived yet.",
    "documents.nomatch": "Nothing matches that.",
    "documents.unreadable": "Could not be read automatically",
    "documents.notread": "Not read",
    "documents.unknownsender": "Unknown",
    "documents.noprocess": "Finished",
    "documents.straightthrough": "Straight through",
    "documents.handcount": "{n} touched it",
    "column.number": "Document",
    "column.type": "Type",
    "column.status": "Status",
    "column.amount": "Amount",
    "column.sender": "Sender",
    "column.recipient": "Recipient",
    "column.received": "Received",
    "column.due": "Due",
    "column.stage": "Stage",
    "column.hands": "Hands",
    "column.expand": "Expand",
    "column.unit": "Business unit",
    "documents.nounit": "Unassigned",
    "documents.allunits": "All business units",
    /**
     * Reused, not re-typed — decision 0448, the same
     * `purchase-orders.js`/`coding-lists.js` pagination-row keys.
     */
    "purchaseorders.rows": "Rows",
    "purchaseorders.rangeof": "{start}–{end} of {total}",
    "purchaseorders.firstpage": "First page",
    "purchaseorders.previouspage": "Previous page",
    "purchaseorders.nextpage": "Next page",
    "purchaseorders.lastpage": "Last page",
    "docstatus.waiting": "Waiting",
    "docstatus.moving": "In progress",
    "docstatus.done": "Finished",
    "docstatus.unreadable": "Needs keying",
    "docstatus.outside": "Not in a process",
    "doctype.380": "Invoice",
    "doctype.unknown": "Unknown",
    "viewer.title": "Invoice",
    "viewer.reflabel": "Unique Ref:",
    "viewer.save": "Save",
    "viewer.expand": "Expand",
    "viewer.status": "Status",
    "viewer.known": "known",
    "tasks.notkeyed": "Not keyed",
    "tasks.stage": "Stage",
    "tasks.waiting": "Waiting",
    "tasks.owner": "Owner",
  },
};

const DOC = {
  id: "inv-1",
  number: "MCD2001321-010",
  typeCode: "380",
  supplier: "UK Office Supplies Direct",
  amount: 251.88,
  currency: "GBP",
  issueDate: "2026-08-05",
  dueDate: null,
  receivedAt: "2026-09-08 12:31:05",
  sender: "billing@example.com",
  recipient: "ap.acme@vibefinance-ai.com",
  stageId: "payment",
  stageName: "Payment-eligible",
  status: "done",
  hands: 0,
};

/** What the unit filter is built from, per test. */
let UNITS: { id: string; name: string; kind: string }[] = [];

async function openDocuments(documents: unknown[]) {
  window.localStorage.clear();
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/documents": { documents, searched: documents.length, total: documents.length, page: 1, pageSize: 50 },
    "/api/org/units": { units: UNITS },
    "/api/code-lists": { fields: {} },
    "/api/field-visibility": { fields: [], derived: {} },
    "/api/invoices/inv-1": { facts: {}, lines: [], validation: { passed: true, checked: [], failures: [] } },
    "/api/invoices/inv-1/document-url": { url: null },
    "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
  });

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/documents.js");
  await open();
  await new Promise((r) => setTimeout(r, 0));
}

/**
 * Wait for the condition rather than for a duration.
 *
 * **Decision 0138's own finding**: `setTimeout(30)` is a guess about
 * how long a dynamic import and four fetches take, and a guess that
 * passes on one run fails on another. This waits for the thing being
 * asserted, and gives up rather than hanging.
 */
async function until(condition: () => boolean, ms = 500) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (condition()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

/**
 * **A stub that outlives its file** — decision 0227, applied to every
 * file rather than the one that had the symptom.
 *
 * `vi.stubGlobal` is not undone between files, so whichever ran next
 * inherited this one's `fetch` — and failed **depending on the order
 * the two were scheduled in**.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what the list shows", () => {
  it("shows a document nobody has a task for", async () => {
    await openDocuments([DOC]);
    expect(document.body.textContent).toContain("MCD2001321-010");
    expect(document.body.textContent).toContain("UK Office Supplies Direct");
  });

  it("shows the amount with its currency", async () => {
    await openDocuments([DOC]);
    expect(document.body.textContent).toContain("251.88");
    expect(document.body.textContent).toContain("GBP");
  });

  it("says what happened to a document nothing could read", async () => {
    // **Four empty cells say nothing.**
    await openDocuments([
      { ...DOC, number: null, supplier: null, amount: null, status: "unreadable" },
    ]);
    expect(document.body.textContent).toContain("Could not be read automatically");
  });

  it("invites action when nothing has arrived", async () => {
    await openDocuments([]);
    expect(document.body.textContent).toContain("Nothing has arrived yet");
  });
});

describe("which columns to show", () => {
  it("shows the defaults", async () => {
    await openDocuments([DOC]);
    const headings = [...document.querySelectorAll("th")].map((h) => h.textContent);
    expect(headings).toContain("Sender");
    // Off by default, available.
    expect(headings).not.toContain("Due");
  });

  it("turns one on and keeps it", async () => {
    // **Kept in the browser**: a column choice is a preference about
    // one screen on one machine (decision 0164).
    await openDocuments([DOC]);

    const boxes = [...document.querySelectorAll(".columnlist input")] as HTMLInputElement[];
    const due = boxes[7];
    due.checked = true;
    due.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect([...document.querySelectorAll("th")].map((h) => h.textContent)).toContain("Due");
    expect(window.localStorage.getItem("vf.documents.columns")).toContain("due");
  });

  it("will not let somebody hide the document number", async () => {
    // **A row that cannot be identified or opened is not a row**, and
    // the disabled box shows the rule rather than hiding it.
    await openDocuments([DOC]);
    const boxes = [...document.querySelectorAll(".columnlist input")] as HTMLInputElement[];
    expect(boxes[0].disabled).toBe(true);
  });

  it("gives the checkbox a real, small size rather than the 32px text-input default (decision 0282)", async () => {
    /**
     * **Reported live, from a screenshot**: "the check boxes appear
     * very large and cumbersome." `tokens.css`'s own global
     * `input, textarea { min-height: 32px; width: 100%; ... }` never
     * excluded `[type="checkbox"]` — a bare `input` selector matches a
     * checkbox exactly as it matches a text box, so every checkbox in
     * the app inherited a 32px-tall, full-width, padded, bordered box
     * built for prose.
     *
     * jsdom applies no CSS, so this reads the real stylesheet rather
     * than measure a rendered checkbox no test here can produce.
     */
    const css = (await import("virtual:stylesheets")).default["tokens.css"];

    // The exclusion has to exist on both rules that were the actual
    // bug — the shared appearance rule and the sizing rule. Matched
    // against `input:not(...)` specifically, not the bare `:not(...)`
    // fragment alone — an earlier version of this test matched that
    // shorter string and was also finding this very comment's own
    // explanation of the fix, silently counting a sentence as a rule.
    const occurrences = css.split('input:not([type="checkbox"])').length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);

    // And a deliberate size was given back, rather than left to
    // whatever a bare, unstyled checkbox happens to render as on
    // whichever browser opens it.
    const page = (await import("virtual:stylesheets")).default["app.css"];
    const sizeRule = page.slice(
      page.indexOf('.columnlist input[type="checkbox"]'),
      page.indexOf('.columnlist input[type="checkbox"]') + 150
    );
    expect(sizeRule).toContain("width: 14px");
    expect(sizeRule).toContain("height: 14px");
  });
});

describe("opening a document (decision 0165)", () => {
  /**
   * **Showing the viewer is the caller's job.** `openViewer` renders
   * into `#viewer` and does not unhide it — the task list swaps the two
   * panes itself, and this screen did not, so the viewer rendered into a
   * hidden element and nothing appeared to happen.
   *
   * Reported as *"neither the expand nor the document link launch
   * anything."*
   */
  it("shows the viewer pane", async () => {
    await openDocuments([DOC]);

    const row = document.querySelector("tbody tr.clickable") as HTMLElement;
    row.click();
    await until(() => !(document.getElementById("viewer") as HTMLElement).hidden);

    expect((document.getElementById("viewer") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("shell") as HTMLElement).hidden).toBe(true);
  });

  it("opens from a click anywhere on the row, not just one cell (decision 0287)", async () => {
    /**
     * **The row itself is the way in now**, not a specific cell within
     * it. The document number used to be its own separate clickable
     * link alongside a dedicated Expand button; both are gone, and the
     * whole row carries the click instead — matching the dashboard's
     * own "On my clock" list (decision 0250).
     */
    await openDocuments([DOC]);

    const numberCell = [...document.querySelectorAll("tbody td")].find((td) =>
      td.textContent?.includes(DOC.number)
    ) as HTMLElement;
    numberCell.click();
    await until(() => !(document.getElementById("viewer") as HTMLElement).hidden);

    expect((document.getElementById("viewer") as HTMLElement).hidden).toBe(false);
  });

  it("returns here, not to the task list, when Back is clicked (decision 0284)", async () => {
    /**
     * **Reported live**: "the back appears in the viewer launched from
     * Tasks and Documents links, so Back is generic as you may not
     * return to the Task." The label reads generically on purpose —
     * this proves the behaviour underneath actually matches it: the
     * viewer's own `onClose` is documents.js's own callback, not
     * tasks.js's, so closing it re-shows the document list and
     * re-fetches it, never the task list.
     */
    await openDocuments([DOC]);

    const row = document.querySelector("tbody tr.clickable") as HTMLElement;
    row.click();
    await until(() => !(document.getElementById("viewer") as HTMLElement).hidden);

    const back = [...document.querySelectorAll(".topbar button")].find(
      (b) => b.getAttribute("title") === "Back"
    ) as HTMLButtonElement;
    back.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).hidden);

    expect((document.getElementById("viewer") as HTMLElement).hidden).toBe(true);
    expect((document.getElementById("shell") as HTMLElement).hidden).toBe(false);
    // The documents list itself, not the tasks screen's own table —
    // this is what proves it returned to Documents specifically.
    expect(document.querySelector(".searchrow")).not.toBeNull();
  });
});

describe("a document that is not work (decision 0167)", () => {
  /**
   * **The viewer was written for a task.** The document manager opens
   * it for an invoice nobody has a task for, so there is no `createdAt`
   * to have waited since and no `ownership` to report.
   *
   * `waited(undefined)` threw and the render stopped mid-way, so Expand
   * swapped the panes and showed **a blank page** — reported exactly
   * that way.
   */
  it("renders rather than blanking", async () => {
    await openDocuments([{ ...DOC, stageId: null, stageName: null, status: "outside" }]);

    const row = document.querySelector("tbody tr.clickable") as HTMLElement;
    row.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).childElementCount > 0);

    const viewer = document.getElementById("viewer") as HTMLElement;
    expect(viewer.childElementCount).toBeGreaterThan(0);
    /**
     * **The document's own reference, decision 0312** — the heading
     * used to fall back to the generic "Invoice" only when a task had
     * no stage at all; now the heading always names the document by
     * its own reference when one exists (this fixture's own row
     * click always supplies one), so this checks for that instead.
     */
    expect(viewer.textContent).toContain("inv-1");
  });

  it("says nothing about waiting or ownership", async () => {
    // **Omitted rather than filled in.** *"Waiting 0h"* about a
    // document nobody is waiting on is a fact invented to fill a row.
    await openDocuments([{ ...DOC, stageId: null, stageName: null, status: "outside" }]);

    const row = document.querySelector("tbody tr.clickable") as HTMLElement;
    row.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).childElementCount > 0);

    const viewer = document.getElementById("viewer") as HTMLElement;
    expect(viewer.textContent).not.toContain("Waiting");
    expect(viewer.textContent).not.toContain("Owner");
  });

  it("offers no actions, because there is no task to act on", async () => {
    await openDocuments([DOC]);

    const row = document.querySelector("tbody tr.clickable") as HTMLElement;
    row.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).childElementCount > 0);

    expect(document.querySelectorAll("#viewer .actionrow a")).toHaveLength(0);
  });
});

describe("the column picker has its own name (decision 0177)", () => {
  it("does not borrow the two-column layout's class", async () => {
    // **`.columns` meant two things** and the later rule won, so the
    // viewer's layout was styled as a dropdown.
    await openDocuments([DOC]);
    expect(document.querySelector(".columnpicker")).not.toBeNull();
    expect(document.querySelector("details.columns")).toBeNull();
  });
});

describe("which part of the business (decision 0193)", () => {
  /**
   * **`org_unit_id` has existed since decision 0036 and no screen has
   * ever shown it.** A customer with France, Germany and UK sees one
   * undifferentiated list.
   *
   * Shown, not enforced — a label to read and filter by, not a
   * boundary.
   */
  const TWO_UNITS = [
    { id: "ap-fr", name: "AP France", kind: "operating_unit" },
    { id: "ap-de", name: "AP Deutschland", kind: "operating_unit" },
    { id: "acme-fr", name: "Acme France", kind: "legal_entity" },
  ];

  it("names the unit on a document", async () => {
    UNITS = TWO_UNITS;
    await openDocuments([{ ...DOC, orgUnitId: "ap-fr", orgUnitName: "AP France" }]);
    expect(document.body.textContent).toContain("AP France");
  });

  it("says unassigned rather than nothing", async () => {
    UNITS = TWO_UNITS;
    await openDocuments([{ ...DOC, orgUnitId: null, orgUnitName: null }]);
    expect(document.body.textContent).toContain("Unassigned");
  });

  it("offers a filter where there is a choice", async () => {
    UNITS = TWO_UNITS;
    await openDocuments([DOC]);
    expect(document.querySelector(".unitpicker")).not.toBeNull();
  });

  it("offers only operating units, never a legal entity", async () => {
    // **An invoice may belong to an operating unit and never to a legal
    // entity** — decision 0036's own invariant.
    UNITS = TWO_UNITS;
    await openDocuments([DOC]);

    const options = [...document.querySelectorAll(".unitpicker option")].map(
      (o) => o.textContent
    );
    expect(options).toContain("AP France");
    expect(options).not.toContain("Acme France");
  });

  it("offers no filter where there is one unit", async () => {
    // **A dropdown with one entry is a control that cannot do
    // anything.**
    UNITS = [{ id: "ap-fr", name: "AP France", kind: "operating_unit" }];
    await openDocuments([DOC]);
    expect(document.querySelector(".unitpicker")).toBeNull();
  });

  it("offers no filter where none are configured", async () => {
    UNITS = [];
    await openDocuments([DOC]);
    expect(document.querySelector(".unitpicker")).toBeNull();
  });
});

describe("focused on one org, decision 0315", () => {
  /**
   * **Extends decision 0314's own treatment of Tasks to Documents.**
   * A different, wider concept from the existing `unit` filter above
   * — `unit` narrows within whichever org is already in scope; `org`
   * is the org itself, decision 0313's own switcher.
   */
  it("sends the chosen org to /api/documents", async () => {
    window.localStorage.clear();
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/documents": { documents: [DOC], searched: 1, total: 1, page: 1, pageSize: 50 },
      "/api/org/units": { units: UNITS },
      "/api/code-lists": { fields: {} },
    });
    // After the clear `openDocuments()` itself would otherwise do,
    // since this test is specifically about what survives it.
    localStorage.setItem("vf-current-org", "fr");

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/documents.js");
    await open();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const call = calls.find((u) => u.startsWith("/api/documents?"));
    expect(call).toContain("org=fr");
  });

  it("sends no org param at all when nothing is chosen", async () => {
    await openDocuments([DOC]);

    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const call = calls.find((u) => u.startsWith("/api/documents?"));
    expect(call).not.toContain("org=");
  });
});

/**
 * A page of `count` documents out of `total` — decision 0448, the same
 * shape `purchase-orders.js`'s own `pageOf()` (decision 0376) uses,
 * for tests about the pagination display rather than any one row's
 * own content.
 */
function pageOf(count: number, total: number, page: number, pageSize: number) {
  return {
    documents: Array.from({ length: count }, (_, i) => ({ ...DOC, id: `doc-${i}`, number: `DOC-${i}` })),
    searched: count,
    total,
    page,
    pageSize,
  };
}

/** Stubs `/api/documents` with a fetch that also records the last requested URL. */
function stubDocumentsRecordingUrl(body: unknown) {
  let requestedUrl = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/org/units") return { ok: true, json: async () => ({ units: UNITS }) } as Response;
      if (path === "/api/documents") {
        requestedUrl = String(url);
        return { ok: true, json: async () => body } as Response;
      }
      throw new Error(`no stub for ${path}`);
    })
  );
  return () => requestedUrl;
}

async function openScreen() {
  window.localStorage.clear();
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/documents.js");
  await open();
  await new Promise((r) => setTimeout(r, 0));
}

describe("searching the list — real, server-side search, decision 0448", () => {
  it("shows the search box with its own placeholder", async () => {
    await openDocuments([]);

    const search = document.getElementById("docsearch");
    expect(search?.getAttribute("placeholder")).toBe("Supplier, document number, or amount");
  });

  it("re-fetches with the search term once typing is done, and resets to page 1", async () => {
    const requestedUrl = stubDocumentsRecordingUrl(pageOf(1, 1, 1, 50));
    await openScreen();

    const search = document.getElementById("docsearch") as HTMLInputElement;
    search.value = "widgets";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl()).toContain("q=widgets");
    expect(requestedUrl()).toContain("page=1");
  });

  it("keeps focus on the search box after a search reloads the screen", async () => {
    await openDocuments([]);

    const search = document.getElementById("docsearch") as HTMLInputElement;
    search.value = "widgets";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.activeElement?.id).toBe("docsearch");
  });

  it("shows a message distinct from 'nothing has arrived' when a search matches nothing", async () => {
    stubDocumentsRecordingUrl(pageOf(0, 0, 1, 50));
    await openScreen();

    const search = document.getElementById("docsearch") as HTMLInputElement;
    search.value = "no such thing";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(document.body.textContent).toContain("Nothing matches that.");
    expect(document.body.textContent).not.toContain("Nothing has arrived yet");
  });
});

describe("pagination controls — decision 0448", () => {
  it("shows every page size actually offered", async () => {
    await openDocuments([]);

    const options = [...document.querySelectorAll("#docrowsize option")].map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["25", "50", "100", "200"]);
  });

  it("changing the page size re-fetches with the new size and resets to page 1", async () => {
    const requestedUrl = stubDocumentsRecordingUrl(pageOf(25, 120, 1, 25));
    await openScreen();

    const sizePicker = document.getElementById("docrowsize") as HTMLSelectElement;
    sizePicker.value = "25";
    sizePicker.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl()).toContain("pageSize=25");
    expect(requestedUrl()).toContain("page=1");
  });

  it("disables first and previous on the first page", async () => {
    stubDocumentsRecordingUrl(pageOf(50, 120, 1, 50));
    await openScreen();

    expect((document.querySelector('[aria-label="First page"]') as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector('[aria-label="Previous page"]') as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector('[aria-label="Next page"]') as HTMLButtonElement)?.disabled).toBe(false);
    expect((document.querySelector('[aria-label="Last page"]') as HTMLButtonElement)?.disabled).toBe(false);
  });

  it("disables next and last on the last page", async () => {
    stubDocumentsRecordingUrl(pageOf(20, 120, 3, 50));
    await openScreen();

    expect((document.querySelector('[aria-label="Next page"]') as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector('[aria-label="Last page"]') as HTMLButtonElement)?.disabled).toBe(true);
    expect((document.querySelector('[aria-label="First page"]') as HTMLButtonElement)?.disabled).toBe(false);
    expect((document.querySelector('[aria-label="Previous page"]') as HTMLButtonElement)?.disabled).toBe(false);
  });

  it("enables every button in the middle of a multi-page result", async () => {
    stubDocumentsRecordingUrl(pageOf(50, 120, 2, 50));
    await openScreen();

    for (const label of ["First page", "Previous page", "Next page", "Last page"]) {
      expect((document.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement)?.disabled).toBe(false);
    }
  });

  it("shows the range as text", async () => {
    stubDocumentsRecordingUrl(pageOf(50, 120, 2, 50));
    await openScreen();

    expect(document.body.textContent).toContain("51–100 of 120");
  });

  it("clicking next advances the page while keeping the same search term", async () => {
    const requestedUrl = stubDocumentsRecordingUrl(pageOf(50, 120, 1, 50));
    await openScreen();

    const search = document.getElementById("docsearch") as HTMLInputElement;
    search.value = "widgets";
    search.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 0));

    (document.querySelector('[aria-label="Next page"]') as HTMLButtonElement)?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(requestedUrl()).toContain("page=2");
    expect(requestedUrl()).toContain("q=widgets");
  });
});
