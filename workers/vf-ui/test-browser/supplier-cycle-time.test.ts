import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Average cycle time by supplier — decision 0421. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.cycletime": "Average cycle time",
    "supplierperformance.cycletimesub": "Receipt to payment-eligible, by supplier",
    "supplierperformance.nocycletime": "No completed invoices yet",
    "supplierperformance.dayscount": "{n} days",
    "supplierperformance.invoicecount": "{n} invoices",
  },
};

function stubCycleTime(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/cycle-time")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderCycleTime(data: unknown, seen: string[] = []) {
  stubCycleTime(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-cycle-time.js");
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
    await renderCycleTime({ suppliers: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Average cycle time");
  });

  it("says no completed invoices rather than drawing an empty list", async () => {
    await renderCycleTime({ suppliers: [] });
    expect(document.body.textContent).toContain("No completed invoices yet");
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderCycleTime({ suppliers: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/cycle-time"))).toBe(true);
  });
});

describe("the ranked list, slowest first — already ranked by the route", () => {
  const DATA = {
    suppliers: [
      { supplierId: "s1", supplierName: "Slow Co", averageDays: 12.3, invoiceCount: 4 },
      { supplierId: "s2", supplierName: "Fast Co", averageDays: 2, invoiceCount: 9 },
    ],
  };

  it("draws one row per supplier, in the order the route returned them", async () => {
    await renderCycleTime(DATA);
    const rows = [...document.querySelectorAll(".barlist-row")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Slow Co");
    expect(rows[1].textContent).toContain("Fast Co");
  });

  it("shows the average days, rounded to one decimal place, and the invoice count", async () => {
    await renderCycleTime(DATA);
    expect(document.body.textContent).toContain("12.3 days");
    expect(document.body.textContent).toContain("4 invoices");
  });
});
