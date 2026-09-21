import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Hold history — decision 0427, the last of Supplier Performance's eight key metrics. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.holdhistory": "Hold history",
    "supplierperformance.holdhistorysub": "How often and for how long a supplier has been placed on hold, and why",
    "supplierperformance.noholdhistory": "No recorded hold periods yet",
    "supplierperformance.supplier": "Supplier",
    "supplierperformance.holdstarted": "Started",
    "supplierperformance.holdended": "Ended",
    "supplierperformance.holdongoing": "Ongoing",
    "supplierperformance.holdduration": "Days on hold",
    "supplierperformance.holdreason": "Reason",
    "supplierperformance.dayscount": "{n} days",
  },
};

function stubHoldHistory(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/hold-history")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderHoldHistory(data: unknown, seen: string[] = []) {
  stubHoldHistory(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-hold-history.js");
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
    await renderHoldHistory({ periods: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Hold history");
  });

  it("says no recorded hold periods rather than drawing an empty table", async () => {
    await renderHoldHistory({ periods: [] });
    expect(document.body.textContent).toContain("No recorded hold periods yet");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderHoldHistory({ periods: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/hold-history"))).toBe(true);
  });
});

describe("the table, already ordered by the route", () => {
  it("draws one row per period, with its own dates, duration and reason", async () => {
    await renderHoldHistory({
      periods: [
        {
          supplierId: "s1",
          supplierName: "Northwind",
          startedAt: "2026-09-01T10:00:00Z",
          endedAt: "2026-09-07T10:00:00Z",
          days: 6,
          reason: "Quality dispute",
        },
      ],
    });

    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(cells).toEqual(["Northwind", "2026-09-01", "2026-09-07", "6 days", "Quality dispute"]);
  });

  it("shows Ongoing rather than a blank cell for an unresolved hold", async () => {
    await renderHoldHistory({
      periods: [
        { supplierId: "s1", supplierName: "Northwind", startedAt: "2026-09-01T10:00:00Z", endedAt: null, days: 3, reason: "Awaiting new bank details" },
      ],
    });

    expect(document.body.textContent).toContain("Ongoing");
  });

  it("shows an em dash rather than a blank cell when no reason was recorded", async () => {
    await renderHoldHistory({
      periods: [{ supplierId: "s1", supplierName: "Northwind", startedAt: "2026-09-01T10:00:00Z", endedAt: null, days: 3, reason: null }],
    });

    const reasonCell = [...document.querySelectorAll("tbody tr td")].at(-1);
    expect(reasonCell?.textContent).toBe("—");
  });

  it("draws one row per period across more than one supplier, in the order the route returned them", async () => {
    await renderHoldHistory({
      periods: [
        { supplierId: "s2", supplierName: "Acme Widgets", startedAt: "2026-09-10T10:00:00Z", endedAt: null, days: 1, reason: "Second dispute" },
        { supplierId: "s1", supplierName: "Northwind", startedAt: "2026-08-01T10:00:00Z", endedAt: "2026-08-05T10:00:00Z", days: 4, reason: "First dispute" },
      ],
    });

    const names = [...document.querySelectorAll("tbody tr td:first-child")].map((td) => td.textContent);
    expect(names).toEqual(["Acme Widgets", "Northwind"]);
  });
});
