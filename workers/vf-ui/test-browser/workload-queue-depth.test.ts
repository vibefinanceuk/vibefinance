import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Team queue depth — decision 0428. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.queuedepth": "Team queue depth",
    "workload.queuedepthsub": "Available (unclaimed) vs. locked (claimed but not finished), by team",
    "workload.noqueuedepth": "No team-owned tasks open right now",
    "workload.available": "Available",
    "workload.locked": "Locked",
    "documents.showing.team": "Showing what is open in {team}'s queue",
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
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
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

  it("lays each team's bar on its side, available then locked, one segment for a team with only one", async () => {
    await renderQueueDepth(DATA);
    // AP Processing: 2 segments (available + locked); Exceptions: 1
    // segment (locked is 0, skipped by stackedBarRows itself).
    expect(document.querySelector(".panel svg")).toBeNull();
    const rows = [...document.querySelectorAll(".stackrow")];
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelectorAll(".stackrow-seg")).toHaveLength(2);
    expect(rows[1].querySelectorAll(".stackrow-seg")).toHaveLength(1);
    // Proportional to the busiest team: 6 of 9 and 3 of 9.
    const widths = [...rows[0].querySelectorAll<HTMLElement>(".stackrow-seg")].map((n) => parseFloat(n.style.width));
    expect(widths[0]).toBeCloseTo(66.67, 1);
    expect(widths[1]).toBeCloseTo(33.33, 1);
  });

  it("names each team on the left of its bar, its total on the right", async () => {
    await renderQueueDepth(DATA);
    const rows = [...document.querySelectorAll(".stackrow")];
    expect(rows.map((r) => r.querySelector(".stackrow-name")?.textContent)).toEqual(["AP Processing", "Exceptions"]);
    expect(rows.map((r) => r.querySelector(".stackrow-total")?.textContent)).toEqual(["9", "1"]);
    expect(rows[0].firstElementChild?.className).toBe("stackrow-name");
    expect(rows[0].lastElementChild?.className).toContain("stackrow-total");
    expect(rows[0].querySelector(".stackrow-seg")?.getAttribute("title")).toBe("Available: 6");
  });

  it("totals available and locked across every team in the legend", async () => {
    await renderQueueDepth(DATA);
    const keys = [...document.querySelectorAll(".chartkey")].map((k) => k.textContent);
    expect(keys).toEqual(["Available7", "Locked3"]);
  });

  it("colours available and locked consistently, matching the legend's own dots", async () => {
    await renderQueueDepth(DATA);
    const segs = [...document.querySelectorAll<HTMLElement>(".stackrow-seg")];
    const fills = new Set(segs.map((r) => r.style.background));
    expect(fills).toEqual(new Set(["var(--chart-1)", "var(--chart-2)"]));

    const legendDots = [...document.querySelectorAll(".chartkey")].map((row) => ({
      label: row.querySelector("span:nth-child(2)")?.textContent,
      colour: (row.querySelector(".chartdot") as HTMLElement)?.style.background,
    }));
    expect(legendDots.find((d) => d.label === "Available")?.colour).toBe("var(--chart-1)");
    expect(legendDots.find((d) => d.label === "Locked")?.colour).toBe("var(--chart-2)");
  });
});

describe("a team's bar opens its queue in Documents (decision 0611)", () => {
  it("asks Documents for the invoices open in that team's queue, and says so", async () => {
    const seen: string[] = [];
    await renderQueueDepth(
      {
        teams: [
          { teamId: "t1", teamName: "AP Processing", available: 6, locked: 3 },
          { teamId: "t2", teamName: "Exceptions", available: 1, locked: 0 },
        ],
      },
      seen
    );
    const row = [...document.querySelectorAll<HTMLElement>(".stackrow")].find((r) => r.textContent?.includes("Exceptions"));
    expect(row?.classList.contains("clickable")).toBe(true);
    row!.click();
    await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
    const request = seen.find((u) => u.startsWith("/api/documents"))!;
    expect(new URL(request, "http://x").searchParams.get("team")).toBe("t2");
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing what is open in Exceptions's queue"));
  });

  it("offers no click on a team with nothing open", async () => {
    await renderQueueDepth({ teams: [{ teamId: "t1", teamName: "AP Processing", available: 0, locked: 0 }] });
    expect(document.querySelectorAll(".stackrow.clickable")).toHaveLength(0);
  });
});
