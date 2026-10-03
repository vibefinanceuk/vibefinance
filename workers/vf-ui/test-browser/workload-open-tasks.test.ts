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
    "workload.opentasksuser": "User",
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
    expect(document.querySelector("select")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderOpenTasks({ users: [], available: 0 }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/open-tasks"))).toBe(true);
  });
});

describe("a person chosen on the left, their open tasks by stage on the right (decision 0612)", () => {
  const DATA = {
    users: [
      {
        userId: "wei",
        userName: "Wei C.",
        openCount: 5,
        stages: [
          { stageId: "validation", stageName: "Validation", n: 1 },
          { stageId: "approval", stageName: "Approval", n: 4 },
        ],
      },
      { userId: "dana", userName: "Dana R.", openCount: 2, stages: [{ stageId: "coding", stageName: "Coding", n: 2 }] },
    ],
    stages: [
      { stageId: "validation", stageName: "Validation" },
      { stageId: "coding", stageName: "Coding" },
      { stageId: "approval", stageName: "Approval" },
    ],
    available: 3,
  };

  it("offers only the people with open tasks, by name, with their counts, the busiest chosen first", async () => {
    await renderOpenTasks(DATA);
    expect(document.querySelector(".barlist-row")).toBeNull();
    const picker = document.querySelector<HTMLSelectElement>(".opentasks-pick select")!;
    expect([...picker.options].map((o) => o.textContent)).toEqual(["Dana R. (2)", "Wei C. (5)"]);
    expect(picker.value).toBe("wei");
    expect(picker.getAttribute("aria-label")).toBe("User");
    // The picker comes before (left of) the ring.
    const body = document.querySelector(".opentasks-body")!;
    expect([...body.children].map((c) => c.className)).toEqual(["opentasks-pick", "opentasks-ring"]);
  });

  it("draws a slice per stage the chosen person has open work at, with the total in the middle", async () => {
    await renderOpenTasks(DATA);
    const ring = document.querySelector(".opentasks-ring")!;
    expect(ring.querySelectorAll("svg circle")).toHaveLength(2);
    expect([...ring.querySelectorAll(".donutkey")].map((k) => k.textContent)).toEqual(["Validation1", "Approval4"]);
    expect([...ring.querySelectorAll("svg text")].map((n) => n.textContent)).toContain("5");
  });

  it("redraws the ring for whoever is chosen, a stage keeping its colour from one person to the next", async () => {
    await renderOpenTasks(DATA);
    const ringColours = () =>
      Object.fromEntries(
        [...document.querySelectorAll(".opentasks-ring .donutkey")].map((k) => [
          k.querySelector("span:nth-child(2)")?.textContent,
          (k.querySelector(".donutdot") as HTMLElement).style.background,
        ])
      );
    expect(ringColours()).toEqual({ Validation: "var(--chart-1)", Approval: "var(--chart-3)" });

    const picker = document.querySelector<HTMLSelectElement>(".opentasks-pick select")!;
    picker.value = "dana";
    picker.dispatchEvent(new Event("change"));
    expect([...document.querySelectorAll(".opentasks-ring .donutkey")].map((k) => k.textContent)).toEqual(["Coding2"]);
    // Coding is the second stage anyone has work at, whoever's ring it is in.
    expect(ringColours()).toEqual({ Coding: "var(--chart-2)" });
  });

  it("shows the unclaimed total as its own note line, not a slice or a person", async () => {
    await renderOpenTasks(DATA);
    expect(document.body.textContent).toContain("3 unclaimed");
    expect(document.body.textContent).not.toContain("Unclaimed (");
  });

  it("still shows the unclaimed note, with no picker, when only unclaimed tasks are open", async () => {
    await renderOpenTasks({ users: [], stages: [], available: 4 });
    expect(document.body.textContent).toContain("4 unclaimed");
    expect(document.body.textContent).not.toContain("No open tasks right now");
    expect(document.querySelector("select")).toBeNull();
  });
});
