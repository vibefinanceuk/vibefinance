import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Exceptions by type, by user, by supplier — trended — decision 0423,
 * the third real card in the Fraud Prevention tab
 * (`workers/vf-app/src/fraud-exception-trends-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape `fraud-duplicates.js` and
 * `fraud-unapproved-suppliers.js` were already built with, `load()`
 * and `renderCard()` for the tab shell (`ap-analytics.js`) to call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "fraudprevention.exceptiontrends": "Exceptions by type, by user, by supplier",
    "fraudprevention.exceptiontrendssub": "Trended over the last 8 weeks",
    "fraudprevention.noexceptiontrends": "No exceptions in the last 8 weeks",
    "fraudprevention.exceptioncount": "Exceptions",
    "fraudprevention.trend": "Trend",
    "fraudprevention.bysupplier": "By supplier",
    "fraudprevention.byuser": "By user",
    "fraudprevention.bytype": "By type",
    "fraudprevention.supplier": "Supplier",
    "fraudprevention.user": "User",
    "fraudprevention.type": "Type",
    "fraudprevention.nosupplier": "No matched supplier",
  },
};

function stubTrends(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/fraud/exception-trends")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderTrends(data: unknown, seen: string[] = []) {
  stubTrends(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/fraud-exception-trends.js");
  await load();
  document.getElementById("card-under-test")!.replaceChildren(renderCard());
}

const EMPTY = { weekStartDates: [], bySupplier: [], byUser: [], byType: [] };

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

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Exceptions by type, by user, by supplier");
  });

  it("says no exceptions rather than drawing empty tables", async () => {
    await renderTrends(EMPTY);

    expect(document.body.textContent).toContain("No exceptions in the last 8 weeks");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderTrends(EMPTY, seen);

    expect(seen.some((u) => u.startsWith("/api/fraud/exception-trends"))).toBe(true);
  });
});

describe("the three breakdowns, each its own short table with a trend column", () => {
  const DATA = {
    weekStartDates: ["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"],
    bySupplier: [
      { supplierId: "s1", supplierName: "Northwind", total: 3, weeklyCounts: [0, 0, 0, 0, 0, 1, 1, 1] },
      { supplierId: null, supplierName: null, total: 1, weeklyCounts: [0, 0, 0, 0, 0, 0, 0, 1] },
    ],
    byUser: [{ userId: "u1", userName: "Priya", total: 2, weeklyCounts: [0, 0, 0, 0, 0, 0, 1, 1] }],
    byType: [{ type: "amount_mismatch", total: 4, weeklyCounts: [0, 0, 0, 0, 1, 1, 1, 1] }],
  };

  it("shows all three section headings when all three have data", async () => {
    await renderTrends(DATA);

    const headings = [...document.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toEqual(["By supplier", "By user", "By type"]);
  });

  it("draws one row per supplier with its own total and a trend chart, in the order the route returned them", async () => {
    await renderTrends(DATA);

    const tables = [...document.querySelectorAll(".tablewrap")];
    const supplierRows = [...tables[0].querySelectorAll("tbody tr")];
    expect(supplierRows).toHaveLength(2);
    expect(supplierRows[0].textContent).toContain("Northwind");
    expect(supplierRows[0].textContent).toContain("3");
    expect(supplierRows[0].querySelector("svg")).not.toBeNull();
  });

  it("falls back to a named placeholder for the unmatched-supplier entry", async () => {
    await renderTrends(DATA);

    const tables = [...document.querySelectorAll(".tablewrap")];
    const supplierRows = [...tables[0].querySelectorAll("tbody tr")];
    expect(supplierRows[1].textContent).toContain("No matched supplier");
  });

  it("draws the user breakdown with its own total and trend", async () => {
    await renderTrends(DATA);

    const tables = [...document.querySelectorAll(".tablewrap")];
    const userRows = [...tables[1].querySelectorAll("tbody tr")];
    expect(userRows).toHaveLength(1);
    expect(userRows[0].textContent).toContain("Priya");
    expect(userRows[0].textContent).toContain("2");
    expect(userRows[0].querySelector("svg")).not.toBeNull();
  });

  it("draws the type breakdown with its own total and trend", async () => {
    await renderTrends(DATA);

    const tables = [...document.querySelectorAll(".tablewrap")];
    const typeRows = [...tables[2].querySelectorAll("tbody tr")];
    expect(typeRows).toHaveLength(1);
    expect(typeRows[0].textContent).toContain("amount_mismatch");
    expect(typeRows[0].textContent).toContain("4");
    expect(typeRows[0].querySelector("svg")).not.toBeNull();
  });

  it("omits a breakdown's own section entirely when that breakdown has no data", async () => {
    await renderTrends({ ...DATA, byUser: [] });

    const headings = [...document.querySelectorAll("h4")].map((h) => h.textContent);
    expect(headings).toEqual(["By supplier", "By type"]);
  });
});
