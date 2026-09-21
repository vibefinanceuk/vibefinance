import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-entity exception and fraud-signal trend — decision 0431, the
 * Multi-Enterprise CFO View's fourth real card
 * (`workers/vf-app/src/executive-exception-trends-route.ts`).
 *
 * **`charts.js`'s own `sparkline()` again**, the same trend cell
 * `fraud-exception-trends.js` already draws — one row per entity here,
 * uncapped.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "executiveiq.exceptiontrendsbyentity": "Cross-entity exception and fraud-signal trend",
    "executiveiq.exceptiontrendsbyentitysub": "Every entity, trended over 8 weeks",
    "executiveiq.noexceptiontrendsbyentity": "No exceptions in the last 8 weeks",
    "executiveiq.entity": "Entity",
    "fraudprevention.exceptioncount": "Exceptions",
    "fraudprevention.trend": "Trend",
  },
};

function stubTrends(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/executive/exception-trends")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderTrends(data: unknown, seen: string[] = []) {
  stubTrends(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/executive-exception-trends.js");
  await load();
  document.getElementById("card-under-test")!.replaceChildren(renderCard());
}

const EMPTY = { weekStartDates: [], byEntity: [] };

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the card the route returned", () => {
  it("titles the card with the route's own heading", async () => {
    await renderTrends(EMPTY);

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Cross-entity exception and fraud-signal trend");
  });

  it("says no exceptions rather than drawing an empty table", async () => {
    await renderTrends(EMPTY);

    expect(document.body.textContent).toContain("No exceptions in the last 8 weeks");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route with no ?org= query at all", async () => {
    const seen: string[] = [];
    await renderTrends(EMPTY, seen);

    const call = seen.find((u) => u.startsWith("/api/executive/exception-trends"));
    expect(call).toBe("/api/executive/exception-trends");
  });
});

describe("one row per entity, each with its own total and trend", () => {
  const DATA = {
    weekStartDates: ["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"],
    byEntity: [
      { orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 5, weeklyCounts: [0, 0, 0, 0, 1, 1, 1, 2] },
      { orgUnitId: "de", orgUnitName: "Acme Germany", orgUnitKind: "legal_entity", total: 1, weeklyCounts: [0, 0, 0, 0, 0, 0, 0, 1] },
    ],
  };

  it("draws one row per entity, in the order the route returned them, each with a trend chart", async () => {
    await renderTrends(DATA);

    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Acme France");
    expect(rows[0].textContent).toContain("5");
    expect(rows[0].querySelector("svg")).not.toBeNull();
    expect(rows[1].textContent).toContain("Acme Germany");
  });
});
