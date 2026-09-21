import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Team queue depth — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.queuedepth": "Team queue depth",
    "workload.queuedepthsub": "Available (unclaimed) vs. locked (claimed but not finished), by team",
    "workload.noqueuedepth": "No team-owned tasks open right now",
    "workload.available": "Available",
    "workload.locked": "Locked",
  },
};

function stubQueueDepth(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/queue-depth")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderQueueDepth(data: unknown, seen: string[] = []) {
  stubQueueDepth(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload-queue-depth.js");
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
    await renderQueueDepth({ teams: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Team queue depth");
  });

  it("says no team-owned tasks open rather than drawing an empty chart", async () => {
    await renderQueueDepth({ teams: [] });
    expect(document.body.textContent).toContain("No team-owned tasks open right now");
    expect(document.querySelector(".panel svg")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderQueueDepth({ teams: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/workload/queue-depth"))).toBe(true);
  });
});

describe("the chart the route's data draws", () => {
  const DATA = {
    teams: [
      { teamId: "t1", teamName: "AP Processing", available: 6, locked: 3 },
      { teamId: "t2", teamName: "Exceptions", available: 1, locked: 0 },
    ],
  };

  it("draws two stacked segments for a team with both available and locked tasks, one for a team with only one", async () => {
    await renderQueueDepth(DATA);
    // AP Processing: 2 segments (available + locked); Exceptions: 1
    // segment (locked is 0, skipped by stackedBarChart itself).
    expect(document.querySelectorAll(".panel svg rect")).toHaveLength(3);
  });

  it("names each team beneath its own bar", async () => {
    await renderQueueDepth(DATA);
    const labels = [...document.querySelectorAll(".panel svg text")].map((n) => n.textContent);
    expect(labels).toContain("AP Processing");
    expect(labels).toContain("Exceptions");
  });

  it("totals available and locked across every team in the legend", async () => {
    await renderQueueDepth(DATA);
    const keys = [...document.querySelectorAll(".chartkey")].map((k) => k.textContent);
    expect(keys).toEqual(["Available7", "Locked3"]);
  });

  it("colours available and locked consistently, matching the legend's own dots", async () => {
    await renderQueueDepth(DATA);
    const rects = [...document.querySelectorAll(".panel svg rect")];
    const fills = new Set(rects.map((r) => r.getAttribute("fill")));
    expect(fills).toEqual(new Set(["var(--chart-1)", "var(--chart-2)"]));

    const legendDots = [...document.querySelectorAll(".chartkey")].map((row) => ({
      label: row.querySelector("span:nth-child(2)")?.textContent,
      colour: (row.querySelector(".chartdot") as HTMLElement)?.style.background,
    }));
    expect(legendDots.find((d) => d.label === "Available")?.colour).toBe("var(--chart-1)");
    expect(legendDots.find((d) => d.label === "Locked")?.colour).toBe("var(--chart-2)");
  });
});
