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
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
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
    "documents.showing.exceptionsfor": "Showing failed validations for {name} in the last 8 weeks",
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
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
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

describe("one breakdown at a time, by tabs, each row opening Documents (decision 0618)", () => {
  const DATA = {
    weekStartDates: ["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14"],
    weeklyTotals: [0, 0, 0, 0, 1, 1, 2, 2],
    total: 6,
    bySupplier: [
      { supplierId: "s1", supplierName: "Northwind", total: 3, weeklyCounts: [0, 0, 0, 0, 0, 1, 1, 1] },
      { supplierId: null, supplierName: null, total: 1, weeklyCounts: [0, 0, 0, 0, 0, 0, 0, 1] },
    ],
    byUser: [{ userId: "u1", userName: "Priya", total: 2, weeklyCounts: [0, 0, 0, 0, 0, 0, 1, 1] }],
    byType: [{ type: "amount_mismatch", total: 4, weeklyCounts: [0, 0, 0, 0, 1, 1, 1, 1] }],
  };
  const rows = () => [...document.querySelectorAll(".fraudlist tbody tr")];
  const tab = (name: string) => [...document.querySelectorAll<HTMLElement>(".fraudtabs .chip")].find((b) => b.textContent === name)!;
  async function documentsAsked(seen: string[]) {
    await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
    return new URL(seen.find((u) => u.startsWith("/api/documents"))!, "http://x").searchParams;
  }

  it("is one full-width card with three tabs, suppliers showing, and no stacked tables", async () => {
    await renderTrends(DATA);
    expect(document.querySelector(".fraudlist")?.classList.contains("card-list")).toBe(true);
    expect([...document.querySelectorAll(".fraudtabs .chip")].map((b) => b.textContent)).toEqual(["By supplier", "By user", "By type"]);
    expect(tab("By supplier").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelectorAll("table")).toHaveLength(1);
    expect(document.querySelector("h4")).toBeNull();
  });

  it("draws one row per supplier with its total and trend, the unmatched one named", async () => {
    await renderTrends(DATA);
    expect(rows()).toHaveLength(2);
    expect(rows()[0].textContent).toContain("Northwind");
    expect(rows()[0].textContent).toContain("3");
    expect(rows()[0].querySelector("svg")).not.toBeNull();
    expect(rows()[1].textContent).toContain("No matched supplier");
  });

  it("switches to people, and to types", async () => {
    await renderTrends(DATA);
    tab("By user").click();
    expect(rows().map((r) => r.textContent)).toEqual([expect.stringContaining("Priya")]);
    tab("By type").click();
    expect(rows()[0].textContent).toContain("amount_mismatch");
    expect(tab("By type").getAttribute("aria-selected")).toBe("true");
  });

  it("a supplier's row opens Documents at its failed validations in the eight weeks, and says so", async () => {
    const seen: string[] = [];
    await renderTrends(DATA, seen);
    rows()[0].dispatchEvent(new MouseEvent("click", { bubbles: true }));
    const q = await documentsAsked(seen);
    expect([q.get("exceptionsSince"), q.get("exceptionSupplierId")]).toEqual(["2026-07-27", "s1"]);
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing failed validations for Northwind in the last 8 weeks"));
  });

  it("the unmatched supplier, a person and a type each ask for theirs", async () => {
    let seen: string[] = [];
    await renderTrends(DATA, seen);
    rows()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect((await documentsAsked(seen)).get("exceptionSupplierId")).toBe("~none");

    seen = [];
    await renderTrends(DATA, seen);
    tab("By user").click();
    rows()[0].click();
    expect((await documentsAsked(seen)).get("exceptionUser")).toBe("u1");

    seen = [];
    await renderTrends(DATA, seen);
    tab("By type").click();
    rows()[0].click();
    expect((await documentsAsked(seen)).get("exceptionType")).toBe("amount_mismatch");
  });

  it("a tab with nothing says so", async () => {
    await renderTrends({ ...DATA, byUser: [] });
    tab("By user").click();
    expect(rows()).toHaveLength(0);
    expect(document.querySelector(".fraudtrendbody")?.textContent).toContain("No exceptions in the last 8 weeks");
  });

  it("gives the tile every failed validation and its weekly line", async () => {
    await renderTrends(DATA);
    const { summary } = await import("/fraud-exception-trends.js");
    expect(summary()).toMatchObject({ key: "trends", count: 6, weekly: [0, 0, 0, 0, 1, 1, 2, 2] });
  });
});
