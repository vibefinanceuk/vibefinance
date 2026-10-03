import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Open task count by user, split by ownership — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.opentasks": "Open tasks by user",
    "workload.opentaskssub": "Who currently owns or has claimed what, and how much sits unclaimed",
    "workload.noopentasks": "No open tasks right now",
    "workload.opentasksavailable": "{n} unclaimed",
    "workload.opentasksuser": "User",
    "workload.opentasksopenall": "Open all of {name}'s open tasks in Documents",
    "documents.showing.openfor": "Showing what is open for {name}",
    "documents.showing.openforstage": "Showing what is open for {name} at {stage}",
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
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
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
    // The picker and the key on the left, the ring on the right (decision 0613).
    const layout = document.querySelector(".opentasks-layout")!;
    expect([...layout.children].map((c) => c.className)).toEqual(["opentasks-left", "opentasks-ring"]);
    expect([...layout.querySelector(".opentasks-left")!.children].map((c) => c.className)).toEqual(["opentasks-pick", "opentasks-key"]);
  });

  it("draws a slice per stage the chosen person has open work at, with the total in the middle", async () => {
    await renderOpenTasks(DATA);
    const ring = document.querySelector(".opentasks-ring")!;
    expect(ring.querySelectorAll("svg circle")).toHaveLength(2);
    expect(ring.querySelector(".donutkey")).toBeNull();
    expect([...document.querySelectorAll(".opentasks-key .donutkey")].map((k) => k.textContent)).toEqual(["Validation1", "Approval4"]);
    expect([...ring.querySelectorAll("svg text")].map((n) => n.textContent)).toContain("5");
  });

  it("redraws the ring for whoever is chosen, a stage keeping its colour from one person to the next", async () => {
    await renderOpenTasks(DATA);
    const ringColours = () =>
      Object.fromEntries(
        [...document.querySelectorAll(".opentasks-key .donutkey")].map((k) => [
          k.querySelector("span:nth-child(2)")?.textContent,
          (k.querySelector(".donutdot") as HTMLElement).style.background,
        ])
      );
    expect(ringColours()).toEqual({ Validation: "var(--chart-1)", Approval: "var(--chart-3)" });

    const picker = document.querySelector<HTMLSelectElement>(".opentasks-pick select")!;
    picker.value = "dana";
    picker.dispatchEvent(new Event("change"));
    expect([...document.querySelectorAll(".opentasks-key .donutkey")].map((k) => k.textContent)).toEqual(["Coding2"]);
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

describe("the key stays inside the card, however narrow (decision 0613)", () => {
  /**
   * Dan's screenshot: a card three to a row, about 290px, its key
   * squeezed beside the ring and spilling past the card's edge. Laid
   * out here with the real stylesheets, at that width and wider.
   */
  async function laidOutAt(width: number) {
    const sheets = (await import("virtual:stylesheets")).default;
    const style = document.createElement("style");
    style.textContent = `${sheets["tokens.css"] ?? ""}\n${sheets["app.css"]}`;
    document.head.append(style);
    document.getElementById("card-under-test")!.style.width = `${width}px`;
    await renderOpenTasks({
      users: [
        {
          userId: "alice",
          userName: "Alice McDonald",
          openCount: 13,
          stages: [
            { stageId: "validation", stageName: "Validation", n: 8 },
            { stageId: "matching", stageName: "Matching", n: 4 },
            { stageId: "coding", stageName: "Coding", n: 1 },
          ],
        },
      ],
      stages: [
        { stageId: "validation", stageName: "Validation" },
        { stageId: "matching", stageName: "Matching" },
        { stageId: "coding", stageName: "Coding" },
      ],
      available: 44,
    });
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect();
    const card = box("#card-under-test .panel");
    const result = { card, picker: box(".opentasks-pick"), key: box(".opentasks-key"), ring: box(".opentasks-ring svg"), style };
    return result;
  }

  for (const width of [290, 640]) {
    it(`puts the key under the drop-down and the ring beside them, all inside a ${width}px card`, async () => {
      const { card, picker, key, ring, style } = await laidOutAt(width);
      try {
        expect(key.top).toBeGreaterThanOrEqual(picker.bottom);
        expect(Math.abs(key.left - picker.left)).toBeLessThan(1);
        expect(ring.left).toBeGreaterThanOrEqual(key.right);
        for (const part of [picker, key, ring]) {
          expect(part.left).toBeGreaterThanOrEqual(card.left);
          expect(part.right).toBeLessThanOrEqual(card.right);
        }
        for (const row of document.querySelectorAll(".opentasks-key .donutkey")) {
          expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1);
        }
      } finally {
        style.remove();
      }
    });
  }
});

describe("the ring opens Documents (decision 0614)", () => {
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
    ],
    stages: [
      { stageId: "validation", stageName: "Validation" },
      { stageId: "approval", stageName: "Approval" },
    ],
    available: 0,
  };

  async function documentsAsked(seen: string[]) {
    await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
    return new URL(seen.find((u) => u.startsWith("/api/documents"))!, "http://x").searchParams;
  }

  it("a slice opens that person's open tasks at that stage, and says so", async () => {
    const seen: string[] = [];
    await renderOpenTasks(DATA, seen);
    const arcs = document.querySelectorAll<SVGCircleElement>(".opentasks-ring svg circle.clickable");
    expect(arcs).toHaveLength(2);
    arcs[1].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const asked = await documentsAsked(seen);
    expect(asked.get("openFor")).toBe("wei");
    expect(asked.get("openStage")).toBe("approval");
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing what is open for Wei C. at Approval"));
  });

  it("a row of the key does the same, by mouse or keyboard", async () => {
    const seen: string[] = [];
    await renderOpenTasks(DATA, seen);
    const row = [...document.querySelectorAll<HTMLElement>(".opentasks-key .donutkey")].find((r) => r.textContent?.startsWith("Validation"))!;
    expect(row.classList.contains("clickable")).toBe(true);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const asked = await documentsAsked(seen);
    expect(asked.get("openFor")).toBe("wei");
    expect(asked.get("openStage")).toBe("validation");
  });

  it("the rest of the ring opens all of that person's open tasks", async () => {
    const seen: string[] = [];
    await renderOpenTasks(DATA, seen);
    const svg = document.querySelector<SVGSVGElement>(".opentasks-ring svg")!;
    expect(svg.getAttribute("aria-label")).toBe("Open all of Wei C.'s open tasks in Documents");
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const asked = await documentsAsked(seen);
    expect(asked.get("openFor")).toBe("wei");
    expect(asked.has("openStage")).toBe(false);
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing what is open for Wei C."));
  });
});
