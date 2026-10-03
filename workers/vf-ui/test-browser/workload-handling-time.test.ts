import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Average handling time by stage and by user — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.handlingtime": "Average handling time",
    "workload.handlingtimesub": "Claim to complete, by stage and by user",
    "workload.nohandlingtime": "No completed, claimed tasks yet",
    "workload.stage": "Stage",
    "workload.user": "User",
    "workload.avghandlingtime": "Avg. handling time",
    "workload.taskcount": "Tasks",
    "workload.hourscount": "{n} hours",
    "workload.taskcountnote": "{n} tasks",
    "documents.showing.handledby": "Showing where {name} claimed and completed a task",
    "documents.showing.handledbystage": "Showing where {name} claimed and completed a task at {stage}",
  },
};

function stubHandlingTime(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/handling-time")) return { ok: true, json: async () => data } as Response;
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderHandlingTime(data: unknown, seen: string[] = []) {
  stubHandlingTime(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-handling-time.js");
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
    await renderHandlingTime({ rows: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Average handling time");
  });

  it("says no completed, claimed tasks rather than drawing an empty list", async () => {
    await renderHandlingTime({ rows: [] });
    expect(document.body.textContent).toContain("No completed, claimed tasks yet");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderHandlingTime({ rows: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/handling-time"))).toBe(true);
  });
});


async function documentsAsked(seen: string[]) {
  await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
  return new URL(seen.find((u) => u.startsWith("/api/documents"))!, "http://x").searchParams;
}

describe("a group per person, a bar per stage (decision 0616)", () => {
  const DATA = {
    rows: [
      { stageId: "validation", stageName: "Validation", userId: "alice", userName: "Alice McDonald", avgHours: 21.5, n: 4 },
      { stageId: "coding", stageName: "Coding", userId: "wei", userName: "Wei C.", avgHours: 10.75, n: 2 },
      { stageId: "coding", stageName: "Coding", userId: "alice", userName: "Alice McDonald", avgHours: 2.8, n: 3 },
      { stageId: "matching", stageName: "Matching", userId: "alice", userName: "Alice McDonald", avgHours: 0, n: 1 },
    ],
  };

  it("groups the route's rows by person, in the order it ranked them, with no table", async () => {
    await renderHandlingTime(DATA);
    expect(document.querySelector("table")).toBeNull();
    const groups = [...document.querySelectorAll(".handlinggroup")];
    expect(groups.map((g) => g.querySelector(".teamgrouphead")?.textContent)).toEqual(["Alice McDonald", "Wei C."]);
    expect([...groups[0].querySelectorAll(".barlist-head span:first-child")].map((n) => n.textContent)).toEqual(["Validation", "Coding", "Matching"]);
  });

  it("shows each stage's hours and task count, sized on one scale across people", async () => {
    await renderHandlingTime(DATA);
    const [alice, wei] = [...document.querySelectorAll(".handlinggroup")];
    expect([...alice.querySelectorAll(".barlist-head .muted")].map((n) => n.textContent)).toEqual([
      "21.5 hours · 4 tasks",
      "2.8 hours · 3 tasks",
      "0 hours · 1 tasks",
    ]);
    expect(parseFloat((wei.querySelector(".barlist-fill") as HTMLElement).style.width)).toBeCloseTo(50, 1);
  });

  it("a stage's bar opens what that person claimed and completed there, even at 0 hours", async () => {
    const seen: string[] = [];
    await renderHandlingTime(DATA, seen);
    const matching = [...document.querySelectorAll<HTMLElement>(".handlinggroup .barlist-row")].find((r) => r.textContent?.startsWith("Matching"))!;
    expect(matching.classList.contains("clickable")).toBe(true);
    matching.click();
    const q = await documentsAsked(seen);
    expect([q.get("handledBy"), q.get("handledStage")]).toEqual(["alice", "matching"]);
    await vi.waitFor(() =>
      expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing where Alice McDonald claimed and completed a task at Matching")
    );
  });

  it("the person's name opens everything they claimed and completed, from the keyboard too", async () => {
    const seen: string[] = [];
    await renderHandlingTime(DATA, seen);
    const wei = [...document.querySelectorAll<HTMLElement>(".teamgrouphead")].find((h) => h.textContent === "Wei C.")!;
    wei.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const q = await documentsAsked(seen);
    expect([q.get("handledBy"), q.get("handledStage")]).toEqual(["wei", null]);
  });
});

describe("it stays inside a card three to a row (decision 0616)", () => {
  it("lays out within 290px, nothing past the card's edge", async () => {
    const sheets = (await import("virtual:stylesheets")).default;
    const style = document.createElement("style");
    style.textContent = `${sheets["tokens.css"]}\n${sheets["app.css"]}`;
    document.head.append(style);
    try {
      document.getElementById("card-under-test")!.style.width = "290px";
      await renderHandlingTime({
        rows: [
          { stageId: "v", stageName: "Validation", userId: "a", userName: "Alice McDonald", avgHours: 21.5, n: 4 },
          { stageId: "c", stageName: "Supplier Maintenance Review", userId: "a", userName: "Alice McDonald", avgHours: 2.8, n: 13 },
        ],
      });
      const card = document.querySelector("#card-under-test .panel")!.getBoundingClientRect();
      for (const node of document.querySelectorAll(".handlinggroup, .handlinggroup .barlist-head span")) {
        const box = node.getBoundingClientRect();
        expect(box.right).toBeLessThanOrEqual(card.right + 0.5);
      }
    } finally {
      style.remove();
    }
  });
});
