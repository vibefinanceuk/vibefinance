import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Open task count by user, split by ownership — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.opentasks": "Open tasks by user",
    "workload.opentaskssub": "Who currently owns or has claimed what, and how much sits unclaimed",
    "workload.noopentasks": "No open tasks right now",
    "workload.opentasksavailable": "{n} unclaimed",
  },
};

function stubOpenTasks(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/open-tasks")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderOpenTasks(data: unknown, seen: string[] = []) {
  stubOpenTasks(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-open-tasks.js");
  await load();
  document.getElementById("card-under-test")!.replaceChildren(renderCard());
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the card the route returned", () => {
  it("titles the card with the route's own heading", async () => {
    await renderOpenTasks({ users: [], available: 0 });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Open tasks by user");
  });

  it("says no open tasks rather than drawing an empty list", async () => {
    await renderOpenTasks({ users: [], available: 0 });
    expect(document.body.textContent).toContain("No open tasks right now");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderOpenTasks({ users: [], available: 0 }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/open-tasks"))).toBe(true);
  });
});

describe("the list the route's data draws", () => {
  const DATA = {
    users: [
      { userId: "dana", userName: "Dana R.", openCount: 5 },
      { userId: "wei", userName: "Wei C.", openCount: 2 },
    ],
    available: 3,
  };

  it("draws one bar row per user", async () => {
    await renderOpenTasks(DATA);
    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    const names = [...document.querySelectorAll(".barlist-head span:first-child")].map((n) => n.textContent);
    expect(names).toEqual(["Dana R.", "Wei C."]);
  });

  it("shows the unclaimed total as its own note line, not a bar of its own", async () => {
    await renderOpenTasks(DATA);
    expect(document.body.textContent).toContain("3 unclaimed");
  });

  it("still shows the unclaimed note even when every user's own count is zero but tasks sit unclaimed", async () => {
    await renderOpenTasks({ users: [], available: 4 });
    expect(document.body.textContent).toContain("4 unclaimed");
    expect(document.body.textContent).not.toContain("No open tasks right now");
  });
});
