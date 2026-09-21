import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Early-payment / discount eligibility by supplier — decision 0427.
 * Reported as eligibility, not the design's own literal "capture
 * rate" — see the route's own doc comment for why.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.discounteligibility": "Early-payment discount eligibility",
    "supplierperformance.discounteligibilitysub": "Invoices currently inside their supplier's own discount window, by currency",
    "supplierperformance.nodiscounteligibility": "No invoices currently eligible for an early-payment discount",
    "supplierperformance.discounteligiblenote": "{n} invoices eligible at {pct}% within {days} days",
  },
};

function stubEligibility(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/discount-eligibility")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderEligibility(data: unknown, seen: string[] = []) {
  stubEligibility(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-discount-eligibility.js");
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
    await renderEligibility({ currencies: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Early-payment discount eligibility");
  });

  it("says no invoices currently eligible rather than drawing an empty list", async () => {
    await renderEligibility({ currencies: [] });
    expect(document.body.textContent).toContain("No invoices currently eligible for an early-payment discount");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderEligibility({ currencies: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/discount-eligibility"))).toBe(true);
  });
});

describe("a single currency reads as the plain simple list", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        totalAmount: 1000,
        potentialDiscount: 20,
        entities: [
          { supplierId: "s1", supplierName: "Northwind", discountPct: 2, discountDays: 10, invoiceCount: 1, totalAmount: 1000, potentialDiscount: 20 },
        ],
      },
    ],
  };

  it("draws one row per supplier, with no currency label wrapper", async () => {
    await renderEligibility(DATA);
    expect(document.querySelectorAll(".barlist-row")).toHaveLength(1);
    expect(document.querySelector(".spendcurrency")).toBeNull();
  });

  it("shows the potential discount as money, and the terms/count as a note", async () => {
    await renderEligibility(DATA);
    expect(document.body.textContent).toContain("GBP 20.00");
    expect(document.body.textContent).toContain("1 invoices eligible at 2% within 10 days");
  });
});

describe("more than one currency splits into its own labelled group each", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        totalAmount: 1000,
        potentialDiscount: 20,
        entities: [{ supplierId: "s1", supplierName: "Northwind", discountPct: 2, discountDays: 10, invoiceCount: 1, totalAmount: 1000, potentialDiscount: 20 }],
      },
      {
        currency: "EUR",
        totalAmount: 500,
        potentialDiscount: 5,
        entities: [{ supplierId: "s2", supplierName: "Acme France", discountPct: 1, discountDays: 15, invoiceCount: 1, totalAmount: 500, potentialDiscount: 5 }],
      },
    ],
  };

  it("labels each currency's own group, in the order the route returned them", async () => {
    await renderEligibility(DATA);
    const groups = [...document.querySelectorAll(".spendcurrency")];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.querySelector(":scope > .muted")?.textContent)).toEqual(["GBP", "EUR"]);
  });
});
