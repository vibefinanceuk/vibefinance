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
