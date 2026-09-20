import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Exception rate by supplier, and exception type mix — decision 0421. */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "supplierperformance.exceptions": "Exception rate",
    "supplierperformance.exceptionssub": "Suppliers with the most validation exceptions, last 90 days",
    "supplierperformance.noexceptions": "No exceptions recorded",
    "supplierperformance.supplier": "Supplier",
    "supplierperformance.exceptioncount": "Exceptions",
    "supplierperformance.visitcount": "Checked",
    "supplierperformance.exceptionrate": "Rate",
    "supplierperformance.typemix": "Most common",
  },
};

function stubExceptions(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/suppliers/exceptions")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderExceptions(data: unknown, seen: string[] = []) {
  stubExceptions(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/supplier-exceptions.js");
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
    await renderExceptions({ suppliers: [], typeMix: [] });
    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Exception rate");
  });

  it("says no exceptions rather than drawing an empty table", async () => {
    await renderExceptions({ suppliers: [], typeMix: [] });
    expect(document.body.textContent).toContain("No exceptions recorded");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org", async () => {
    const seen: string[] = [];
    await renderExceptions({ suppliers: [], typeMix: [] }, seen);
    expect(seen.some((u) => u.startsWith("/api/suppliers/exceptions"))).toBe(true);
  });
});

describe("the table, already ranked highest rate first by the route", () => {
  const DATA = {
    suppliers: [
      { supplierId: "s1", supplierName: "Frequently wrong", exceptionCount: 4, visitCount: 5, exceptionRate: 0.8 },
      { supplierId: "s2", supplierName: "Mostly fine", exceptionCount: 1, visitCount: 10, exceptionRate: 0.1 },
    ],
    typeMix: [
      { type: "amount_mismatch", count: 3 },
      { type: "duplicate_suspected", count: 2 },
    ],
  };

  it("draws one row per supplier, in the order the route returned them", async () => {
    await renderExceptions(DATA);
    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Frequently wrong");
    expect(rows[1].textContent).toContain("Mostly fine");
  });

  it("shows exception count, visit count, and rate as a percentage", async () => {
    await renderExceptions(DATA);
    const firstRow = document.querySelector("tbody tr")!;
    const cells = [...firstRow.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["Frequently wrong", "4", "5", "80%"]);
  });

  it("shows the type mix beneath the table", async () => {
    await renderExceptions(DATA);
    expect(document.body.textContent).toContain("amount_mismatch (3)");
    expect(document.body.textContent).toContain("duplicate_suspected (2)");
  });

  it("shows no type mix line when there is none", async () => {
    await renderExceptions({ ...DATA, typeMix: [] });
    expect(document.body.textContent).not.toContain("Most common");
  });
});
