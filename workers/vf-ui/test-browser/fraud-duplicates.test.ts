import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Potential duplicate invoices — decision 0420, the first real card in
 * the Fraud Prevention tab
 * (`workers/vf-app/src/fraud-duplicates-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape `accruals.js` and `spend-under-management.js` were
 * already built with, `load()` and `renderCard()` for the tab shell
 * (`ap-analytics.js`) to call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "fraudprevention.duplicates": "Potential duplicate invoices",
    "fraudprevention.duplicatessub": "Same supplier, amount and date — sorted by confidence",
    "fraudprevention.noduplicates": "No potential duplicates right now",
    "fraudprevention.invoicenumber": "Invoice",
    "fraudprevention.supplier": "Supplier",
    "fraudprevention.amount": "Amount",
    "fraudprevention.issuedate": "Issue date",
    "fraudprevention.confidence": "Confidence",
  },
};

function stubDuplicates(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/fraud/duplicates")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderDuplicates(data: unknown, seen: string[] = []) {
  stubDuplicates(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/fraud-duplicates.js");
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
    await renderDuplicates({ invoices: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Potential duplicate invoices");
  });

  it("says no potential duplicates rather than drawing an empty table", async () => {
    await renderDuplicates({ invoices: [] });

    expect(document.body.textContent).toContain("No potential duplicates right now");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderDuplicates({ invoices: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/fraud/duplicates"))).toBe(true);
  });
});

describe("the table itself, in the order the route returned it — decision 0420's own suggested visualization", () => {
  const DATA = {
    invoices: [
      {
        id: "inv-1",
        invoiceNumber: "INV-001",
        supplierName: "Acme Supplies",
        supplierVatId: "GB123",
        totalWithVat: 4400,
        currency: "GBP",
        issueDate: "2026-09-01",
        duplicateConfidence: 0.95,
      },
      {
        id: "inv-2",
        invoiceNumber: "INV-002",
        supplierName: "Beta Traders",
        supplierVatId: "GB456",
        totalWithVat: 1200,
        currency: "EUR",
        issueDate: "2026-09-05",
        duplicateConfidence: 0.6,
      },
    ],
  };

  it("draws one row per invoice, in the order the route returned them (already sorted by confidence)", async () => {
    await renderDuplicates(DATA);

    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("INV-001");
    expect(rows[1].textContent).toContain("INV-002");
  });

  it("shows the invoice number, supplier, formatted money, issue date, and confidence as a percentage", async () => {
    await renderDuplicates(DATA);

    const firstRow = document.querySelector("tbody tr")!;
    const cells = [...firstRow.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells).toEqual(["INV-001", "Acme Supplies", "GBP 4,400.00", "2026-09-01", "95%"]);
  });

  it("falls back to the supplier VAT id when there is no supplier name", async () => {
    await renderDuplicates({
      invoices: [{ ...DATA.invoices[0], supplierName: null }],
    });

    expect(document.querySelector("tbody tr")?.textContent).toContain("GB123");
  });
});
