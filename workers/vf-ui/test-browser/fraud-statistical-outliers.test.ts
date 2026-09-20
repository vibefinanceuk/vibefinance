import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Statistical outliers — decision 0424, the fourth real card in the
 * Fraud Prevention tab
 * (`workers/vf-app/src/fraud-statistical-outliers-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape every other Fraud Prevention card already uses,
 * `load()` and `renderCard()` for the tab shell (`ap-analytics.js`) to
 * call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "fraudprevention.statisticaloutliers": "Statistical outliers",
    "fraudprevention.statisticaloutlierssub": "An amount well outside the supplier's own historical range",
    "fraudprevention.nostatisticaloutliers": "No statistical outliers right now",
    "fraudprevention.invoicenumber": "Invoice",
    "fraudprevention.supplier": "Supplier",
    "fraudprevention.amount": "Amount",
    "fraudprevention.issuedate": "Issue date",
    "fraudprevention.historicalmean": "Historical average",
    "fraudprevention.deviation": "Deviation",
    "fraudprevention.undefinedmagnitude": "Undefined magnitude",
  },
};

function stubOutliers(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/fraud/statistical-outliers")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderOutliers(data: unknown, seen: string[] = []) {
  stubOutliers(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/fraud-statistical-outliers.js");
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
    await renderOutliers({ invoices: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Statistical outliers");
  });

  it("says no statistical outliers rather than drawing an empty table", async () => {
    await renderOutliers({ invoices: [] });

    expect(document.body.textContent).toContain("No statistical outliers right now");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderOutliers({ invoices: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/fraud/statistical-outliers"))).toBe(true);
  });
});

describe("the table itself, in the order the route returned it", () => {
  const DATA = {
    invoices: [
      {
        id: "inv-1",
        invoiceNumber: "INV-101",
        supplierId: "s1",
        supplierName: "Northwind",
        totalWithVat: 10000,
        currency: "GBP",
        issueDate: "2026-09-01",
        historicalMean: 1000,
        historicalStdDev: 141.42,
        sampleSize: 5,
        zScore: 63.6,
      },
      {
        id: "inv-2",
        invoiceNumber: "INV-102",
        supplierId: "s2",
        supplierName: "Southwind",
        totalWithVat: 501,
        currency: "GBP",
        issueDate: "2026-09-05",
        historicalMean: 500,
        historicalStdDev: 0,
        sampleSize: 6,
        zScore: null,
      },
    ],
  };

  it("draws one row per invoice, in the order the route returned them", async () => {
    await renderOutliers(DATA);

    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("INV-101");
    expect(rows[1].textContent).toContain("INV-102");
  });

  it("shows the invoice number, supplier, amount and historical average", async () => {
    await renderOutliers({ invoices: [DATA.invoices[0]] });

    const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(cells[0]).toBe("INV-101");
    expect(cells[1]).toBe("Northwind");
    expect(cells[2]).toBe("GBP 10,000.00");
    expect(cells[3]).toBe("2026-09-01");
    expect(cells[4]).toBe("GBP 1,000.00");
  });

  it("shows a numeric z-score as a signed multiple of standard deviation", async () => {
    await renderOutliers({ invoices: [DATA.invoices[0]] });

    expect(document.querySelector("tbody tr")?.textContent).toContain("+63.6σ");
  });

  it("shows a null z-score as an honest 'undefined magnitude', never a fabricated number", async () => {
    await renderOutliers({ invoices: [DATA.invoices[1]] });

    expect(document.querySelector("tbody tr")?.textContent).toContain("Undefined magnitude");
  });
});
