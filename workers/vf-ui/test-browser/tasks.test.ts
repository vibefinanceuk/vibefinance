import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The task list — decisions 0103, 0138, 0142.
 *
 * **Opening a document is navigation, not an action.** Whether somebody
 * may look at a task is decided by the task being theirs; what they may
 * *do* is decided by the actions it reports, and what they may *edit*
 * by field visibility at that stage.
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
    "tasks.stage": "Stage",
    "tasks.line": "line",
    "tasks.supplier": "Supplier",
    "tasks.amount": "Amount",
    "tasks.waiting": "Waiting",
    "tasks.owner": "Owner",
    "tasks.signout": "Sign out",
    "tasks.allstages": "All stages",
    "tasks.everything": "Everything",
    "tasks.mine": "Mine",
    "tasks.available": "Available",
    "tasks.locked": "Locked",
    "tasks.empty": "Nothing here",
    "tasks.nodocument": "No document",
    "tasks.notkeyed": "Not keyed",
    "action.complete": "Complete",
    "action.return": "Return",
    "action.key": "Key",
    "mood.label": "Mood",
    "mood.day": "Day time",
    "mood.night": "Night time",
  },
};

const APPROVAL_TASK = {
  id: "t-approve",
  stageId: "approval",
  stageName: "Approval",
  ownership: "mine",
  createdAt: "2026-09-01 09:00:00",
  // **No `key`.** An approval task never offers it, which is why
  // opening had to stop depending on it.
  actions: ["complete", "return"],
  subject: { type: "invoice", id: "inv-9", supplierName: "Munch GmbH", totalWithVat: 1200 },
};

async function openList(tasks: unknown[]) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions: [] },
    "/api/tasks": { tasks, counts: {} },
  });

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

describe("opening a task that cannot be keyed (decision 0142)", () => {
  it("makes the document itself clickable", async () => {
    // **A row names a document**, and looking at one is the first thing
    // anybody wants to do with it. Making that a button among the
    // actions would put navigation where decisions live.
    await openList([APPROVAL_TASK]);

    const link = document.querySelector("button.subjectlink");
    expect(link?.textContent).toBe("Munch GmbH");
  });

  it("offers no disabled buttons", async () => {
    // **Every action works now** (decision 0138). The row listed three
    // and disabled the rest, which was true until the proxy carried
    // them and three routes accepted a session.
    await openList([APPROVAL_TASK]);

    const disabled = [...document.querySelectorAll("td button[disabled]")];
    expect(disabled).toHaveLength(0);
  });

  it("shows the actions the task reports, and no others", async () => {
    await openList([APPROVAL_TASK]);
    const labels = [...document.querySelectorAll("button.act")].map((b) => b.textContent);
    expect(labels).toEqual(["Complete", "Return"]);
  });

  it("does not offer a link for a task with no document", async () => {
    // A task about nothing has nothing to open.
    await openList([{ ...APPROVAL_TASK, subject: null }]);
    expect(document.querySelector("button.subjectlink")).toBeNull();
  });
});

describe("the brand mark (decision 0145)", () => {
  it("sits at the head of the column, above the navigation", async () => {
    // **It sat at the foot first**, on my argument that the top of a
    // sidebar is where somebody looks to move. The operator wanted it
    // at the top, which is the conventional place and the one people
    // look for when orienting themselves rather than navigating —
    // small enough that it does not compete.
    await openList([APPROVAL_TASK]);

    const children = [...(document.querySelector(".nav")?.children ?? [])];
    const firstLink = children.findIndex((c) => c.tagName === "A");
    const mark = children.findIndex((c) => c.classList.contains("brandmark"));

    expect(mark).toBeLessThan(firstLink);
  });

  it("is small enough not to compete with the entries", async () => {
    // A mark at the head of a column orients; one that fills it
    // announces. 84px against a 190px column.
    const css = (await import("virtual:stylesheets")).default["index.html"];
    const rule = css.slice(css.indexOf(".brandmark {"));
    expect(rule).toContain("max-width: 84px");
  });

  it("ships both a dark and a light mark", async () => {
    // **The navy wordmark all but vanishes** on the night surface:
    // #001842 against #0d1626 is a difference of value nobody can read.
    await openList([APPROVAL_TASK]);

    expect(document.querySelector("img.brandmark.dark")).not.toBeNull();
    expect(document.querySelector("img.brandmark.light")).not.toBeNull();
  });

  it("announces nothing to a screen reader", async () => {
    // The name is already in the page title, and "VibeFinance logo"
    // before every navigation is noise rather than information.
    await openList([APPROVAL_TASK]);

    const mark = document.querySelector("img.brandmark") as HTMLImageElement;
    expect(mark.alt).toBe("");
  });
});

describe("a task about one line (decision 0183)", () => {
  /**
   * A stage scoped `per_line` raises one task per invoice line, so an
   * eight-line invoice produces eight rows naming the same supplier,
   * the same amount and the same stage.
   *
   * **Eight identical rows teach somebody the list is broken.**
   */
  it("names the line beside the supplier", async () => {
    await openList([
      { ...APPROVAL_TASK, lineNumber: 3 },
    ]);
    expect(document.body.textContent).toContain("line 3");
  });

  it("says nothing where a task is about the whole document", async () => {
    await openList([APPROVAL_TASK]);
    expect(document.body.textContent).not.toContain("line ");
  });
});
