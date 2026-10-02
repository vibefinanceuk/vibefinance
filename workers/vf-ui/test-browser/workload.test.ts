import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Workload card — decision 0415, the first screen backed by
 * `AP.Analysis` (`workers/vf-app/src/workload-route.ts`). "In order
 * to make this a reality — what would you start with?" / "let's
 * go!": the vertical slice is the Management Dashboard design's own
 * "Throughput by user, stacked by stage" chart, built for real.
 *
 * **Tests `load()`/`renderCard()` directly, not `open()` — decision
 * 0417.** This module lost its own topbar, frame and screen identity
 * when it moved into a tab of the new AP Analytics screen
 * (`ap-analytics.js`); there is no `open()` here any more to call, and
 * no `.topbar` of this module's own to assert against. Everything this
 * file already proved about the card's own content — the chart, the
 * legend, the empty state — still holds, just reached by calling the
 * two exports the tab shell itself calls.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "workload.throughput": "Throughput by user",
    "workload.throughputsub": "Completed in the last 7 days, stacked by stage",
    "workload.nothroughput": "Nothing completed in the last 7 days",
    "documents.showing.doneby": "Showing what {name} completed in the last 7 days",
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
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderWorkload(data: unknown, seen: string[] = []) {
  stubWorkload(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/workload.js");
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
  it("titles the card with the route's own throughput heading", async () => {
    await renderWorkload({ users: [], legend: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Throughput by user");
  });

  it("says nothing completed rather than drawing an empty chart", async () => {
    await renderWorkload({ users: [], legend: [] });

    expect(document.body.textContent).toContain("Nothing completed in the last 7 days");
    expect(document.querySelector(".panel svg")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderWorkload({ users: [], legend: [] }, seen);

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
    await renderWorkload(DATA);

    // dana: 2 segments, wei: 2 segments — never 4 apiece just because
    // the legend names 4 buckets in all.
    expect(document.querySelectorAll(".stackrow-seg")).toHaveLength(4);
  });

  it("lays each user's bar on its side, their name on the left and their total on the right (decision 0611)", async () => {
    await renderWorkload(DATA);

    expect(document.querySelector(".panel svg")).toBeNull();
    const rows = [...document.querySelectorAll(".stackrow")];
    expect(rows.map((r) => [...r.children].map((c) => c.className.split(" ")[0]))).toEqual([
      ["stackrow-name", "stackrow-track", "stackrow-total"],
      ["stackrow-name", "stackrow-track", "stackrow-total"],
    ]);
    expect(rows.map((r) => r.querySelector(".stackrow-name")?.textContent)).toEqual(["Dana R.", "Wei C."]);
    expect(rows.map((r) => r.querySelector(".stackrow-total")?.textContent)).toEqual(["5", "2"]);
    // A segment names its stage when pointed at.
    expect(rows[0].querySelector(".stackrow-seg")?.getAttribute("title")).toBe("Received: 2");
  });

  it("keys every bucket the legend names, with its own real total", async () => {
    await renderWorkload(DATA);

    const keys = [...document.querySelectorAll(".chartkey")].map((k) => k.textContent);
    expect(keys).toEqual(["Received2", "Validation1", "Matching & Coding3", "Review & Payment-eligible1"]);
  });

  it("colours a segment by its own bucket, not by its position in one user's own row", async () => {
    /**
     * **The property `stackedBarRows`'s own doc comment exists to
     * guarantee.** Dana's own second segment (bucket 3) and Wei's own
     * second segment (bucket 5) sit at the same array index within
     * their respective rows, but name different real stage buckets —
     * a chart that coloured by position rather than by the bucket
     * itself would draw them identically.
     */
    await renderWorkload(DATA);

    const segs = [...document.querySelectorAll<HTMLElement>(".stackrow-seg")];
    const fills = segs.map((r) => r.style.background);

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

describe("a person's bar opens their week in Documents (decision 0611)", () => {
  it("asks Documents for what that person completed, and says so", async () => {
    const seen: string[] = [];
    await renderWorkload(
      {
        users: [{ userId: "wei", userName: "Wei C.", total: 2, buckets: [{ bucket: 2, label: "Validation", n: 2 }] }],
        legend: [{ bucket: 2, label: "Validation", n: 2 }],
      },
      seen
    );
    const row = document.querySelector<HTMLElement>(".stackrow.clickable");
    expect(row?.textContent).toContain("Wei C.");
    row!.click();
    await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
    const request = seen.find((u) => u.startsWith("/api/documents"))!;
    expect(new URL(request, "http://x").searchParams.get("doneBy")).toBe("wei");
    await vi.waitFor(() =>
      expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing what Wei C. completed in the last 7 days")
    );
  });

  it("opens from the keyboard too", async () => {
    const seen: string[] = [];
    await renderWorkload(
      {
        users: [{ userId: "wei", userName: "Wei C.", total: 2, buckets: [{ bucket: 2, label: "Validation", n: 2 }] }],
        legend: [{ bucket: 2, label: "Validation", n: 2 }],
      },
      seen
    );
    const row = document.querySelector<HTMLElement>(".stackrow.clickable")!;
    expect(row.tabIndex).toBe(0);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(seen.some((u) => u.includes("doneBy=wei"))).toBe(true));
  });
});
