import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Payment terms held vs. negotiated, and on-time-payment rate — decision 0421. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.paymentterms": "Payment terms held vs. negotiated",
    "supplierperformance.paymenttermssub": "What was agreed, what was invoiced, and how often it was on time",
    "supplierperformance.nopaymentterms": "No comparable payment terms yet",
    "supplierperformance.supplier": "Supplier",
    "supplierperformance.negotiatedterms": "Negotiated",
    "supplierperformance.heldterms": "Invoiced",
    "supplierperformance.ontimerate": "On time",
    "supplierperformance.dayscount": "{n} days",
  },
};

function stubTerms(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/payment-terms")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderTerms(data: unknown, seen: string[] = []) {
  stubTerms(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-payment-terms.js");
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
    await renderTerms({ suppliers: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Payment terms held vs. negotiated");
  });

  it("says no comparable terms rather than drawing an empty table", async () => {
    await renderTerms({ suppliers: [] });
    expect(document.body.textContent).toContain("No comparable payment terms yet");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderTerms({ suppliers: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/payment-terms"))).toBe(true);
  });
});

describe("the table, already ranked by the route", () => {
  const DATA = {
    suppliers: [
      {
        supplierId: "s1",
        supplierName: "Northwind",
        negotiatedDays: 30,
        averageHeldDays: 32.4,
        onTimeRate: 0.75,
        invoiceCount: 4,
      },
      {
        supplierId: "s2",
        supplierName: "Southwind",
        negotiatedDays: 45,
        averageHeldDays: 45,
        onTimeRate: null,
        invoiceCount: 1,
      },
    ],
  };

  it("draws one row per supplier, in the order the route returned them", async () => {
    await renderTerms(DATA);
    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Northwind");
    expect(rows[1].textContent).toContain("Southwind");
  });

  it("shows negotiated days, held days, and the on-time rate as a percentage", async () => {
    await renderTerms(DATA);
    const firstRow = document.querySelector("tbody tr")!;
    const cells = [...firstRow.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["Northwind", "30 days", "32.4 days", "75%"]);
  });

  it("shows a dash, not 0%, when the on-time rate is null", async () => {
    await renderTerms(DATA);
    const rows = [...document.querySelectorAll("tbody tr")];
    const cells = [...rows[1].querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["Southwind", "45 days", "45 days", "—"]);
  });
});
