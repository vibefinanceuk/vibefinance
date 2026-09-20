import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The accruals report card — decision 0417's own follow-on, the first
 * real metric of the Financial Performance tab
 * (`workers/vf-app/src/accruals-route.ts`).
 *
 * **A content module from the start, never a standalone screen.**
 * Unlike `workload.js` and `supplier-performance.js`, this one was
 * built straight as `load()`/`renderCard()` for the tab shell
 * (`ap-analytics.js`) to call — it never had, and never needed, an
 * `open()` of its own.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "financialperformance.accruals": "Accruals report",
    "financialperformance.accrualssub": "Received, not yet payment-eligible, by stage",
    "financialperformance.noaccruals": "No open liabilities right now",
    "financialperformance.accrued": "{amount} accrued",
    "financialperformance.invoicecount": "{n} invoices",
  },
};

function stubAccruals(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/accruals")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderAccruals(data: unknown, seen: string[] = []) {
  stubAccruals(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/accruals.js");
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
  it("titles the card with the route's own accruals heading", async () => {
    await renderAccruals({ currencies: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Accruals report");
  });

  it("says no open liabilities rather than drawing an empty list", async () => {
    await renderAccruals({ currencies: [] });

    expect(document.body.textContent).toContain("No open liabilities right now");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderAccruals({ currencies: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/accruals"))).toBe(true);
  });
});

describe("a single currency still shows its own total — decision 0417's own headline figure", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        total: 12400,
        stages: [
          { stageId: "received", stageName: "Received", total: 4400, count: 2 },
          { stageId: "validation", stageName: "Validation", total: 8000, count: 3 },
        ],
      },
    ],
  };

  it("shows the currency's own total, unlike Supplier Performance's own bare label which the single-currency case hides", async () => {
    await renderAccruals(DATA);

    expect(document.body.textContent).toContain("GBP 12,400.00 accrued");
    expect(document.querySelector(".accrualcurrency")).toBeNull();
  });

  it("draws one row per stage, in process order rather than ranked by size", async () => {
    await renderAccruals(DATA);

    // Validation (8,000) is larger than Received (4,400) — if rows
    // were ranked by size the larger would come first. They don't,
    // because a liability reads in the order the money moves through
    // the process, not biggest-first.
    const rows = [...document.querySelectorAll(".barlist-row .barlist-head")].map((h) => h.textContent);
    expect(rows).toEqual(["ReceivedGBP 4,400.00 · 2 invoices", "ValidationGBP 8,000.00 · 3 invoices"]);
  });

  it("shows a formatted money figure and the invoice count for each stage", async () => {
    await renderAccruals(DATA);

    expect(document.body.textContent).toContain("GBP 4,400.00");
    expect(document.body.textContent).toContain("2 invoices");
    expect(document.body.textContent).toContain("GBP 8,000.00");
    expect(document.body.textContent).toContain("3 invoices");
  });
});

describe("more than one currency splits into its own labelled, totalled section each", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        total: 12400,
        stages: [{ stageId: "received", stageName: "Received", total: 12400, count: 4 }],
      },
      {
        currency: "EUR",
        total: 3200,
        stages: [{ stageId: "received", stageName: "Received", total: 3200, count: 1 }],
      },
    ],
  };

  it("labels each currency's own total, in the order the route returned them", async () => {
    await renderAccruals(DATA);

    const groups = [...document.querySelectorAll(".accrualcurrency")];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.querySelector(":scope > .muted")?.textContent)).toEqual([
      "GBP 12,400.00 accrued",
      "EUR 3,200.00 accrued",
    ]);
  });

  it("never shows one blended figure across currencies", async () => {
    await renderAccruals(DATA);

    expect(document.body.textContent).toContain("GBP 12,400.00");
    expect(document.body.textContent).toContain("EUR 3,200.00");
    expect(document.body.textContent).not.toContain("15,600.00");
  });
});
