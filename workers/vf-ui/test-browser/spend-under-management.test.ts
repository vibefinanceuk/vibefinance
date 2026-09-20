import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Spend under management (with PO) vs. total spend — decision 0419,
 * Financial Performance's second real card
 * (`workers/vf-app/src/spend-under-management-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape `accruals.js` was already built with, `load()` and
 * `renderCard()` for the tab shell (`ap-analytics.js`) to call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "financialperformance.spendundermanagement": "Spend under management",
    "financialperformance.spendundermanagementsub": "Share of spend backed by a purchase order",
    "financialperformance.nospend": "No spend recorded yet",
    "financialperformance.totalspend": "{amount} total spend",
    "financialperformance.withpospend": "{amount} with a PO",
    "financialperformance.invoiceswithpo": "{withpo} of {total} invoices with a PO",
  },
};

function stubSpend(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/spend/under-management")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderSpend(data: unknown, seen: string[] = []) {
  stubSpend(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/spend-under-management.js");
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
    await renderSpend({ currencies: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Spend under management");
  });

  it("says no spend recorded yet rather than drawing an empty ring", async () => {
    await renderSpend({ currencies: [] });

    expect(document.body.textContent).toContain("No spend recorded yet");
    expect(document.querySelector(".donutwrap")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderSpend({ currencies: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/spend/under-management"))).toBe(true);
  });
});

describe("a single currency, decision 0419's own stat-tile shape", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        totalSpend: 4000,
        totalCount: 4,
        withPoSpend: 3000,
        withPoCount: 3,
        percentWithPo: 75,
      },
    ],
  };

  it("draws one ring, labelled with its own currency and rounded percentage", async () => {
    await renderSpend(DATA);

    expect(document.querySelectorAll(".donutwrap")).toHaveLength(1);
    expect(document.body.textContent).toContain("75%");
    expect(document.body.textContent).toContain("GBP");
  });

  it("shows the total spend, the spend with a PO, and the invoice counts as its own detail lines", async () => {
    await renderSpend(DATA);

    expect(document.body.textContent).toContain("GBP 4,000.00 total spend");
    expect(document.body.textContent).toContain("GBP 3,000.00 with a PO");
    expect(document.body.textContent).toContain("3 of 4 invoices with a PO");
  });

  it("has no more than one tile when there is only one currency", async () => {
    await renderSpend(DATA);

    expect(document.querySelectorAll(".spendundermanagementtile")).toHaveLength(1);
  });
});

describe("more than one currency draws its own ring each, never one blended percentage", () => {
  const DATA = {
    currencies: [
      { currency: "GBP", totalSpend: 2000, totalCount: 2, withPoSpend: 1000, withPoCount: 1, percentWithPo: 50 },
      { currency: "EUR", totalSpend: 500, totalCount: 1, withPoSpend: 500, withPoCount: 1, percentWithPo: 100 },
    ],
  };

  it("draws one tile and one ring per currency, in the order the route returned them", async () => {
    await renderSpend(DATA);

    const tiles = [...document.querySelectorAll(".spendundermanagementtile")];
    expect(tiles).toHaveLength(2);
    expect(tiles.map((tile) => tile.textContent?.includes("GBP"))[0]).toBe(true);
    expect(tiles.map((tile) => tile.textContent?.includes("EUR"))[1]).toBe(true);
  });

  it("never shows one blended total or percentage across currencies", async () => {
    await renderSpend(DATA);

    expect(document.body.textContent).toContain("GBP 2,000.00 total spend");
    expect(document.body.textContent).toContain("EUR 500.00 total spend");
    expect(document.body.textContent).not.toContain("2,500.00");
    expect(document.body.textContent).toContain("50%");
    expect(document.body.textContent).toContain("100%");
  });
});
