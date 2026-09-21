import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Consolidated spend across org units / legal entities — decision
 * 0425, the Multi-Enterprise CFO View's first real card
 * (`workers/vf-app/src/executive-consolidated-spend-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape every card on every other AP Analytics tab already
 * uses, `load()` and `renderCard()` for the tab shell
 * (`ap-analytics.js`) to call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "executiveiq.consolidatedspend": "Consolidated spend across org units / legal entities",
    "executiveiq.consolidatedspendsub": "Every entity, by currency",
    "executiveiq.noconsolidatedspend": "No priced, placed invoices yet",
    "executiveiq.legalentity": "Legal entity",
    "executiveiq.operatingunit": "Operating unit",
  },
};

function stubSpend(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/executive/consolidated-spend")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderConsolidatedSpend(data: unknown, seen: string[] = []) {
  stubSpend(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/executive-consolidated-spend.js");
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
    await renderConsolidatedSpend({ currencies: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe(
      "Consolidated spend across org units / legal entities"
    );
  });

  it("says no priced, placed invoices yet rather than drawing an empty list", async () => {
    await renderConsolidatedSpend({ currencies: [] });

    expect(document.body.textContent).toContain("No priced, placed invoices yet");
    expect(document.querySelector(".barlist-row")).toBeNull();
  });

  it("asks the route with no ?org= query at all — deliberately, unlike every other card on this screen", async () => {
    const seen: string[] = [];
    await renderConsolidatedSpend({ currencies: [] }, seen);

    const call = seen.find((u) => u.startsWith("/api/executive/consolidated-spend"));
    expect(call).toBe("/api/executive/consolidated-spend");
  });
});

describe("a single currency reads as the plain simple list", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        total: 15600,
        entities: [
          { orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 12400 },
          { orgUnitId: "de", orgUnitName: "Acme Germany", orgUnitKind: "legal_entity", total: 3200 },
        ],
      },
    ],
  };

  it("draws one row per entity, with no currency label wrapper", async () => {
    await renderConsolidatedSpend(DATA);

    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
    expect(document.querySelector(".spendcurrency")).toBeNull();
  });

  it("shows a formatted money figure and each entity's own kind", async () => {
    await renderConsolidatedSpend(DATA);

    expect(document.body.textContent).toContain("GBP 12,400.00");
    expect(document.body.textContent).toContain("Legal entity");
  });

  it("ranks the bar widths by total, largest first", async () => {
    await renderConsolidatedSpend(DATA);

    const fills = [...document.querySelectorAll(".barlist-fill")].map((f) => (f as HTMLElement).style.width);
    expect(fills[0]).toBe("100%");
  });

  it("labels an operating unit as such, distinct from a legal entity", async () => {
    await renderConsolidatedSpend({
      currencies: [
        {
          currency: "GBP",
          total: 200,
          entities: [{ orgUnitId: "fr-sales", orgUnitName: "Acme France Sales", orgUnitKind: "operating_unit", total: 200 }],
        },
      ],
    });

    expect(document.body.textContent).toContain("Operating unit");
    expect(document.body.textContent).not.toContain("Legal entity");
  });
});

describe("more than one currency splits into its own labelled group each, with its own total", () => {
  const DATA = {
    currencies: [
      {
        currency: "GBP",
        total: 12400,
        entities: [{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 12400 }],
      },
      {
        currency: "EUR",
        total: 3200,
        entities: [{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 3200 }],
      },
    ],
  };

  it("labels each currency's own group with its own total, in the order the route returned them", async () => {
    await renderConsolidatedSpend(DATA);

    const groups = [...document.querySelectorAll(".spendcurrency")];
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.querySelector(":scope > .muted")?.textContent)).toEqual([
      "GBP · GBP 12,400.00",
      "EUR · EUR 3,200.00",
    ]);
  });

  it("never shows one blended figure for an entity billed in more than one currency", async () => {
    await renderConsolidatedSpend(DATA);

    expect(document.body.textContent).toContain("GBP 12,400.00");
    expect(document.body.textContent).toContain("EUR 3,200.00");
    expect(document.body.textContent).not.toContain("15,600.00");
    expect(document.querySelectorAll(".barlist-row")).toHaveLength(2);
  });
});
