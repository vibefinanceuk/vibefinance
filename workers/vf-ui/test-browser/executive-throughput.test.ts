import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-org throughput/workload comparison — decision 0431, the
 * Multi-Enterprise CFO View's fifth and last data-buildable card
 * (`workers/vf-app/src/executive-throughput-route.ts`).
 *
 * **A single ranked bar list**, not `workload.js`'s own stage-bucketed
 * chart — one completed-count per entity.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "executiveiq.throughputbyentity": "Cross-org throughput/workload comparison",
    "executiveiq.throughputbyentitysub": "Tasks completed in the last 7 days, by entity",
    "executiveiq.nothroughputbyentity": "No tasks completed in the last 7 days",
    "executiveiq.legalentity": "Legal entity",
    "executiveiq.operatingunit": "Operating unit",
  },
};

function stubThroughput(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/executive/throughput")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderThroughput(data: unknown, seen: string[] = []) {
  stubThroughput(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/executive-throughput.js");
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
    await renderThroughput({ entities: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Cross-org throughput/workload comparison");
  });

  it("says no tasks completed rather than drawing an empty list", async () => {
    await renderThroughput({ entities: [] });

    expect(document.body.textContent).toContain("No tasks completed in the last 7 days");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route with no ?org= query at all", async () => {
    const seen: string[] = [];
    await renderThroughput({ entities: [] }, seen);

    const call = seen.find((u) => u.startsWith("/api/executive/throughput"));
    expect(call).toBe("/api/executive/throughput");
  });
});

describe("one bar per entity, ranked by completed count", () => {
  const DATA = {
    entities: [
      { orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", completedCount: 12 },
      { orgUnitId: "de", orgUnitName: "Acme Germany", orgUnitKind: "operating_unit", completedCount: 4 },
    ],
  };

  it("draws one bar per entity, with its own kind", async () => {
    await renderThroughput(DATA);

    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    expect(document.body.textContent).toContain("Legal entity");
    expect(document.body.textContent).toContain("Operating unit");
  });

  it("ranks the bar widths by completed count, largest first", async () => {
    await renderThroughput(DATA);

    const fills = [...document.querySelectorAll(".barlist-fill")].map((f) => (f as HTMLElement).style.width);
    expect(fills[0]).toBe("100%");
  });

  it("shows the raw completed count as each row's own display figure", async () => {
    await renderThroughput(DATA);

    expect(document.body.textContent).toContain("12");
    expect(document.body.textContent).toContain("4");
  });
});
