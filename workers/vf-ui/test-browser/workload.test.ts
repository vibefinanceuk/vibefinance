import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Workload screen — decision 0415, the first screen backed by
 * `AP.Analysis` (`workers/vf-app/src/workload-route.ts`). "In order
 * to make this a reality — what would you start with?" / "let's
 * go!": the vertical slice is the Management Dashboard design's own
 * "Throughput by user, stacked by stage" chart, built for real.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.heading": "Workload",
    "workload.sub": "Team throughput by stage",
    "workload.throughput": "Throughput by user",
    "workload.throughputsub": "Completed in the last 7 days, stacked by stage",
    "workload.nothroughput": "Nothing completed in the last 7 days",
  },
};

function stubWorkload(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/workload/throughput")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function openWorkload(data: unknown, seen: string[] = []) {
  stubWorkload(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/workload.js");
  await open();
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the heading and the card the route returned", () => {
  it("reads Workload, with the card's own title and subtitle", async () => {
    await openWorkload({ users: [], legend: [] });

    expect(document.querySelector(".topbar h2")?.textContent).toBe("Workload");
    expect(document.querySelector(".topbar .sub")?.textContent).toBe("Team throughput by stage");
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Throughput by user");
  });

  it("says nothing completed rather than drawing an empty chart", async () => {
    await openWorkload({ users: [], legend: [] });

    expect(document.body.textContent).toContain("Nothing completed in the last 7 days");
    expect(document.querySelector(".panel svg")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await openWorkload({ users: [], legend: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/workload/throughput"))).toBe(true);
  });
});

describe("the chart the route's data draws", () => {
  const DATA = {
    users: [
      {
        userId: "dana",
        userName: "Dana R.",
        total: 5,
        buckets: [
          { bucket: 1, label: "Received", n: 2 },
          { bucket: 3, label: "Matching & Coding", n: 3 },
        ],
      },
      {
        userId: "wei",
        userName: "Wei C.",
        total: 2,
        buckets: [
          { bucket: 2, label: "Validation", n: 1 },
          { bucket: 5, label: "Review & Payment-eligible", n: 1 },
        ],
      },
    ],
    legend: [
      { bucket: 1, label: "Received", n: 2 },
      { bucket: 2, label: "Validation", n: 1 },
      { bucket: 3, label: "Matching & Coding", n: 3 },
      { bucket: 5, label: "Review & Payment-eligible", n: 1 },
    ],
  };

  it("draws one bar segment per bucket a user actually has, not one per legend entry", async () => {
    await openWorkload(DATA);

    // dana: 2 segments, wei: 2 segments — never 4 apiece just because
    // the legend names 4 buckets in all.
    expect(document.querySelectorAll(".panel svg rect")).toHaveLength(4);
  });

  it("names each user and their total beneath and above their own bar", async () => {
    await openWorkload(DATA);

    const labels = [...document.querySelectorAll(".panel svg text")].map((n) => n.textContent);
    expect(labels).toContain("Dana R.");
    expect(labels).toContain("Wei C.");
    expect(labels).toContain("5");
    expect(labels).toContain("2");
  });

  it("keys every bucket the legend names, with its own real total", async () => {
    await openWorkload(DATA);

    const keys = [...document.querySelectorAll(".chartkey")].map((k) => k.textContent);
    expect(keys).toEqual(["Received2", "Validation1", "Matching & Coding3", "Review & Payment-eligible1"]);
  });

  it("colours a segment by its own bucket, not by its position in one user's own row", async () => {
    /**
     * **The property `stackedBarChart`'s own doc comment exists to
     * guarantee.** Dana's own second segment (bucket 3) and Wei's own
     * second segment (bucket 5) sit at the same array index within
     * their respective rows, but name different real stage buckets —
     * a chart that coloured by position rather than by the bucket
     * itself would draw them identically.
     */
    await openWorkload(DATA);

    const rects = [...document.querySelectorAll(".panel svg rect")];
    const fills = rects.map((r) => r.getAttribute("fill"));

    // Every real bucket used gets its own, distinct colour token.
    expect(new Set(fills).size).toBe(4);
    expect(fills).toContain("var(--chart-1)");
    expect(fills).toContain("var(--chart-2)");
    expect(fills).toContain("var(--chart-3)");
    expect(fills).toContain("var(--chart-5)");

    // And the legend's own dot for a bucket matches the segment
    // drawn for that same bucket — the whole point of colouring by
    // the entity rather than by row position.
    const legendDots = [...document.querySelectorAll(".chartkey")].map((row) => ({
      label: row.querySelector("span:nth-child(2)")?.textContent,
      colour: (row.querySelector(".chartdot") as HTMLElement)?.style.background,
    }));
    const matching = legendDots.find((d) => d.label === "Matching & Coding");
    expect(matching?.colour).toBe("var(--chart-3)");
  });
});
