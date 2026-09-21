import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Liabilities and accruals by entity — decision 0431, the Multi-
 * Enterprise CFO View's second real card
 * (`workers/vf-app/src/executive-liabilities-by-entity-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape every card on this tab already uses, `load()` and
 * `renderCard()` for the tab shell (`ap-analytics.js`) to call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "executiveiq.liabilitiesbyentity": "Liabilities and accruals by entity",
    "executiveiq.liabilitiesbyentitysub": "Every entity, by currency",
    "executiveiq.noliabilitiesbyentity": "No accruing invoices yet",
    "financialperformance.invoicecount": "{n} invoices",
  },
};

function stubLiabilities(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/executive/liabilities-by-entity")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderLiabilities(data: unknown, seen: string[] = []) {
  stubLiabilities(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/executive-liabilities-by-entity.js");
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
    await renderLiabilities({ currencies: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Liabilities and accruals by entity");
  });

  it("says no accruing invoices yet rather than drawing an empty list", async () => {
    await renderLiabilities({ currencies: [] });

    expect(document.body.textContent).toContain("No accruing invoices yet");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route with no ?org= query at all", async () => {
    const seen: string[] = [];
    await renderLiabilities({ currencies: [] }, seen);

    const call = seen.find((u) => u.startsWith("/api/executive/liabilities-by-entity"));
    expect(call).toBe("/api/executive/liabilities-by-entity");
  });
});

describe("a single currency reads as the plain simple list", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        total: 1500,
        entities: [
          { orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 1000, count: 4 },
          { orgUnitId: "de", orgUnitName: "Acme Germany", orgUnitKind: "legal_entity", total: 500, count: 2 },
        ],
      },
    ],
  };

  it("draws one row per entity, with no currency label wrapper", async () => {
    await renderLiabilities(DATA);

    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    expect(document.querySelector(".spendcurrency")).toBeNull();
  });

  it("shows a formatted money figure and each entity's own invoice count", async () => {
    await renderLiabilities(DATA);

    expect(document.body.textContent).toContain("GBP 1,000.00");
    expect(document.body.textContent).toContain("4 invoices");
  });

  it("ranks the bar widths by total, largest first", async () => {
    await renderLiabilities(DATA);

    const fills = [...document.querySelectorAll(".barlist-fill")].map((f) => (f as HTMLElement).style.width);
    expect(fills[0]).toBe("100%");
  });
});

describe("more than one currency splits into its own labelled group each, with its own total", () => {
  const DATA = {
    currencies: [
      { currency: "GBP", total: 1000, entities: [{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 1000, count: 3 }] },
      { currency: "EUR", total: 500, entities: [{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 500, count: 1 }] },
    ],
  };

  it("labels each currency's own group with its own total", async () => {
    await renderLiabilities(DATA);

    const groups = [...document.querySelectorAll(".spendcurrency")];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.querySelector(":scope > .muted")?.textContent)).toEqual([
      "GBP · GBP 1,000.00",
      "EUR · EUR 500.00",
    ]);
  });

  it("never shows one blended figure for an entity accruing in more than one currency", async () => {
    await renderLiabilities(DATA);

    expect(document.body.textContent).toContain("GBP 1,000.00");
    expect(document.body.textContent).toContain("EUR 500.00");
    expect(document.body.textContent).not.toContain("1,500.00");
  });
});
