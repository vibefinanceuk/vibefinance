import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Cross-entity supplier concentration — decision 0431, the Multi-
 * Enterprise CFO View's third real card
 * (`workers/vf-app/src/executive-supplier-concentration-route.ts`).
 *
 * **A table, not a bar list** — see the card's own doc comment for
 * why: the figure here is which entities a supplier appears in, not
 * one number per entity.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "executiveiq.supplierconcentration": "Cross-entity supplier concentration",
    "executiveiq.supplierconcentrationsub": "Suppliers ranking as a top-5 vendor in 2 or more entities",
    "executiveiq.nosupplierconcentration": "No supplier ranks as a top vendor in more than one entity",
    "executiveiq.supplier": "Supplier",
    "executiveiq.entitycount": "Entities",
    "executiveiq.entities": "Appears as a top vendor in",
  },
};

function stubConcentration(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/executive/supplier-concentration")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderConcentration(data: unknown, seen: string[] = []) {
  stubConcentration(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/executive-supplier-concentration.js");
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
    await renderConcentration({ suppliers: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Cross-entity supplier concentration");
  });

  it("says no supplier concentration rather than drawing an empty table", async () => {
    await renderConcentration({ suppliers: [] });

    expect(document.body.textContent).toContain("No supplier ranks as a top vendor in more than one entity");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route with no ?org= query at all", async () => {
    const seen: string[] = [];
    await renderConcentration({ suppliers: [] }, seen);

    const call = seen.find((u) => u.startsWith("/api/executive/supplier-concentration"));
    expect(call).toBe("/api/executive/supplier-concentration");
  });
});

describe("one row per flagged supplier", () => {
  const DATA = {
    suppliers: [
      {
        supplierId: "acme-co",
        supplierName: "Acme Co",
        entityCount: 2,
        appearances: [
          { orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", currency: "GBP", rank: 1, total: 5000 },
          { orgUnitId: "de", orgUnitName: "Acme Germany", orgUnitKind: "legal_entity", currency: "GBP", rank: 3, total: 2000 },
        ],
      },
    ],
  };

  it("draws the supplier's own name, entity count, and every entity it appears in", async () => {
    await renderConcentration(DATA);

    const row = document.querySelector("tbody tr")!;
    expect(row.textContent).toContain("Acme Co");
    expect(row.textContent).toContain("2");
    expect(row.textContent).toContain("Acme France");
    expect(row.textContent).toContain("Acme Germany");
    expect(row.textContent).toContain("#1");
    expect(row.textContent).toContain("#3");
  });

  it("shows each appearance's own formatted money figure", async () => {
    await renderConcentration(DATA);

    expect(document.querySelector("tbody tr")!.textContent).toContain("GBP 5,000.00");
    expect(document.querySelector("tbody tr")!.textContent).toContain("GBP 2,000.00");
  });
});
