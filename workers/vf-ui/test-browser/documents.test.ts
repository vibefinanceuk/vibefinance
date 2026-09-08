import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The document manager — decisions 0164, 0165.
 *
 * **Every way into a document was a task**, so an invoice that went
 * straight through was invisible.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      return { ok: true, json: async () => routes[path] } as Response;
    })
  );
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
    "mood.label": "Mood",
    "mood.day": "Day time",
    "mood.night": "Night time",
    "documents.subtitle": "Everything that has arrived",
    "documents.searchhint": "Supplier, document number, or amount",
    "documents.choosecolumns": "Choose columns",
    "documents.none": "Nothing has arrived yet.",
    "documents.nomatch": "Nothing matches that.",
    "documents.searchedcount": "{shown} of the {searched} most recent.",
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
    "docstatus.waiting": "Waiting",
    "docstatus.moving": "In progress",
    "docstatus.done": "Finished",
    "docstatus.unreadable": "Needs keying",
    "docstatus.outside": "Not in a process",
    "doctype.380": "Invoice",
    "doctype.unknown": "Unknown",
    "viewer.title": "Invoice",
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

async function openDocuments(documents: unknown[]) {
  window.localStorage.clear();
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/documents": { documents, searched: documents.length },
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

    const expand = document.querySelector("button.expand") as HTMLButtonElement;
    expand.click();
    await until(() => !(document.getElementById("viewer") as HTMLElement).hidden);

    expect((document.getElementById("viewer") as HTMLElement).hidden).toBe(false);
    expect((document.getElementById("shell") as HTMLElement).hidden).toBe(true);
  });

  it("opens from the document number too", async () => {
    // **The number is the way in**, the same as a rule's sentence.
    await openDocuments([DOC]);

    const link = document.querySelector("button.rulelink") as HTMLButtonElement;
    link.click();
    await until(() => !(document.getElementById("viewer") as HTMLElement).hidden);

    expect((document.getElementById("viewer") as HTMLElement).hidden).toBe(false);
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

    const expand = document.querySelector("button.expand") as HTMLButtonElement;
    expand.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).childElementCount > 0);

    const viewer = document.getElementById("viewer") as HTMLElement;
    expect(viewer.childElementCount).toBeGreaterThan(0);
    expect(viewer.textContent).toContain("Invoice");
  });

  it("says nothing about waiting or ownership", async () => {
    // **Omitted rather than filled in.** *"Waiting 0h"* about a
    // document nobody is waiting on is a fact invented to fill a row.
    await openDocuments([{ ...DOC, stageId: null, stageName: null, status: "outside" }]);

    const expand = document.querySelector("button.expand") as HTMLButtonElement;
    expand.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).childElementCount > 0);

    const viewer = document.getElementById("viewer") as HTMLElement;
    expect(viewer.textContent).not.toContain("Waiting");
    expect(viewer.textContent).not.toContain("Owner");
  });

  it("offers no actions, because there is no task to act on", async () => {
    await openDocuments([DOC]);

    const expand = document.querySelector("button.expand") as HTMLButtonElement;
    expand.click();
    await until(() => (document.getElementById("viewer") as HTMLElement).childElementCount > 0);

    expect(document.querySelectorAll("#viewer .actionrow a")).toHaveLength(0);
  });
});
