import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Segregation-of-duties flags — decision 0424, the fifth real card in
 * the Fraud Prevention tab
 * (`workers/vf-app/src/fraud-segregation-of-duties-route.ts`).
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
    "fraudprevention.segregationofduties": "Segregation-of-duties flags",
    "fraudprevention.segregationofdutiessub": "The same person claiming and approving the same invoice",
    "fraudprevention.nosegregationofduties": "No segregation-of-duties flags right now",
    "fraudprevention.invoicenumber": "Invoice",
    "fraudprevention.user": "User",
    "fraudprevention.stagescompleted": "Stages completed",
  },
};

function stubFlags(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/fraud/segregation-of-duties")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderFlags(data: unknown, seen: string[] = []) {
  stubFlags(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/fraud-segregation-of-duties.js");
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
    await renderFlags({ invoices: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Segregation-of-duties flags");
  });

  it("says no segregation-of-duties flags rather than drawing an empty table", async () => {
    await renderFlags({ invoices: [] });

    expect(document.body.textContent).toContain("No segregation-of-duties flags right now");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderFlags({ invoices: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/fraud/segregation-of-duties"))).toBe(true);
  });
});

describe("the table itself, in the order the route returned it", () => {
  const DATA = {
    invoices: [
      {
        invoiceId: "inv-1",
        invoiceNumber: "INV-201",
        userId: "u1",
        userName: "Priya",
        stages: [
          { requiredPermission: "AP.Code", stageName: "Coding", completedAt: "2026-09-01T09:00:00Z" },
          { requiredPermission: "AP.Approve", stageName: "Approval", completedAt: "2026-09-02T09:00:00Z" },
        ],
      },
      {
        invoiceId: "inv-2",
        invoiceNumber: "INV-202",
        userId: "u2",
        userName: null,
        stages: [
          { requiredPermission: "AP.Validate", stageName: "Validation", completedAt: "2026-09-01T09:00:00Z" },
          { requiredPermission: "AP.Approve", stageName: "Approval", completedAt: "2026-09-03T09:00:00Z" },
        ],
      },
    ],
  };

  it("draws one row per invoice, in the order the route returned them", async () => {
    await renderFlags(DATA);

    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("INV-201");
    expect(rows[1].textContent).toContain("INV-202");
  });

  it("shows the invoice number, user, and every completed stage in order", async () => {
    await renderFlags({ invoices: [DATA.invoices[0]] });

    const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(cells[0]).toBe("INV-201");
    expect(cells[1]).toBe("Priya");
    expect(cells[2]).toBe("Coding → Approval");
  });

  it("falls back to the user id when there is no user name", async () => {
    await renderFlags({ invoices: [DATA.invoices[1]] });

    const cells = [...document.querySelectorAll("tbody tr td")].map((td) => td.textContent);
    expect(cells[1]).toBe("u2");
  });
});
