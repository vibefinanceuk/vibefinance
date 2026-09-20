import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Invoice variance to order value, ranked by supplier — decision 0421. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.povariance": "Invoice variance to order value",
    "supplierperformance.povariancesub": "Average variance from the matched purchase order, by supplier",
    "supplierperformance.nopovariance": "No PO-matched invoices yet",
    "supplierperformance.invoicecount": "{n} invoices",
  },
};

function stubVariance(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/po-variance")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderVariance(data: unknown, seen: string[] = []) {
  stubVariance(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-po-variance.js");
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
    await renderVariance({ suppliers: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Invoice variance to order value");
  });

  it("says no PO-matched invoices rather than drawing an empty list", async () => {
    await renderVariance({ suppliers: [] });
    expect(document.body.textContent).toContain("No PO-matched invoices yet");
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderVariance({ suppliers: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/po-variance"))).toBe(true);
  });
});

describe("the ranked list, highest variance first — already ranked by the route", () => {
  const DATA = {
    suppliers: [
      { supplierId: "s1", supplierName: "Way off plan", averageVariancePct: 42.7, invoiceCount: 2 },
      { supplierId: "s2", supplierName: "Close to plan", averageVariancePct: 1, invoiceCount: 6 },
    ],
  };

  it("draws one row per supplier, in the order the route returned them", async () => {
    await renderVariance(DATA);
    const rows = [...document.querySelectorAll(".barlist-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Way off plan");
    expect(rows[1].textContent).toContain("Close to plan");
  });

  it("shows the average variance rounded to one decimal place as a percentage", async () => {
    await renderVariance(DATA);
    expect(document.body.textContent).toContain("42.7%");
  });
});
