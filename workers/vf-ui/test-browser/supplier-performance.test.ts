import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Supplier Performance card — decision 0416, the second real
 * screen drawn from the Management Dashboard design (decision 0415
 * built the first, Workload). Ships one metric — "Spend by supplier,
 * with a top-N ranking" — grouped by currency rather than summed
 * across them, since real invoices here are genuinely multi-currency
 * and this system has no FX conversion.
 *
 * **Tests `load()`/`renderCard()` directly, not `open()` — decision
 * 0417.** This module lost its own topbar, frame and screen identity
 * when it moved into the Supplier Performance tab of the new AP
 * Analytics screen (`ap-analytics.js`); there is no `open()` here any
 * more to call, and no `.topbar` of this module's own to assert
 * against. Everything this file already proved about the card's own
 * content — the currency split, the ranking, the empty state — still
 * holds, just reached by calling the two exports the tab shell itself
 * calls.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.spend": "Spend by supplier",
    "supplierperformance.spendsub": "Ranked by total invoiced amount, by currency",
    "supplierperformance.nospend": "No priced invoices yet",
    "supplierperformance.invoicecount": "{n} invoices",
  },
};

function stubSpend(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/spend")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderSupplierPerformance(data: unknown, seen: string[] = []) {
  stubSpend(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-performance.js");
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
  it("titles the card with the route's own spend heading", async () => {
    await renderSupplierPerformance({ currencies: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Spend by supplier");
  });

  it("says no priced invoices yet rather than drawing an empty list", async () => {
    await renderSupplierPerformance({ currencies: [] });

    expect(document.body.textContent).toContain("No priced invoices yet");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderSupplierPerformance({ currencies: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/suppliers/spend"))).toBe(true);
  });
});

describe("a single currency reads as the plain simple list the design asked for", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        suppliers: [
          { supplierId: "s1", supplierName: "Northwind", spend: 12400, invoiceCount: 8 },
          { supplierId: "s2", supplierName: "Southwind", spend: 3200, invoiceCount: 2 },
        ],
      },
    ],
  };

  it("draws one row per supplier, with no currency label wrapper", async () => {
    await renderSupplierPerformance(DATA);

    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    expect(document.querySelector(".spendcurrency")).toBeNull();
  });

  it("shows a formatted money figure and the invoice count, not the raw number", async () => {
    await renderSupplierPerformance(DATA);

    expect(document.body.textContent).toContain("GBP 12,400.00");
    expect(document.body.textContent).toContain("8 invoices");
  });

  it("ranks the bar widths by spend, not by invoice count", async () => {
    await renderSupplierPerformance(DATA);

    const fills = [...document.querySelectorAll(".barlist-fill")].map(
      (f) => (f as HTMLElement).style.width
    );
    // Northwind (12,400) is the largest in its own currency — full width.
    expect(fills[0]).toBe("100%");
  });
});

describe("more than one currency splits into its own labelled list each", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        suppliers: [{ supplierId: "s1", supplierName: "Northwind", spend: 12400, invoiceCount: 8 }],
      },
      {
        currency: "EUR",
        suppliers: [{ supplierId: "s1", supplierName: "Northwind", spend: 3200, invoiceCount: 2 }],
      },
    ],
  };

  it("labels each currency's own group, in the order the route returned them", async () => {
    await renderSupplierPerformance(DATA);

    const groups = [...document.querySelectorAll(".spendcurrency")];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.querySelector(":scope > .muted")?.textContent)).toEqual(["GBP", "EUR"]);
  });

  it("never shows one blended figure for a supplier billed in more than one currency", async () => {
    await renderSupplierPerformance(DATA);

    // Northwind appears once per currency, each with its own real figure —
    // never a single 15,600 total anywhere on the page.
    expect(document.body.textContent).toContain("GBP 12,400.00");
    expect(document.body.textContent).toContain("EUR 3,200.00");
    expect(document.body.textContent).not.toContain("15,600.00");
    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
  });
});
