import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unapproved-supplier invoices — decision 0422, the second real card
 * in the Fraud Prevention tab
 * (`workers/vf-app/src/fraud-unapproved-suppliers-route.ts`).
 *
 * **A content module from the start, never a standalone screen** —
 * the same shape `fraud-duplicates.js` was already built with,
 * `load()` and `renderCard()` for the tab shell (`ap-analytics.js`)
 * to call.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "fraudprevention.unapprovedsuppliers": "Unapproved-supplier invoices",
    "fraudprevention.unapprovedsupplierssub": "A supplier not on file, or one currently on hold",
    "fraudprevention.nounapprovedsuppliers": "No unapproved-supplier invoices right now",
    "fraudprevention.invoicenumber": "Invoice",
    "fraudprevention.supplier": "Supplier",
    "fraudprevention.amount": "Amount",
    "fraudprevention.issuedate": "Issue date",
    "fraudprevention.reason": "Reason",
    "fraudprevention.reasonnotonfile": "Not on file",
    "fraudprevention.reasononhold": "On hold",
  },
};

function stubUnapproved(data: unknown, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      if (path.startsWith("/api/fraud/unapproved-suppliers")) return { ok: true, json: async () => data } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

async function renderUnapproved(data: unknown, seen: string[] = []) {
  stubUnapproved(data, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { load, renderCard } = await import("/fraud-unapproved-suppliers.js");
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
    await renderUnapproved({ invoices: [] });

    expect(document.querySelector(".cardhead h3")?.textContent).toBe("Unapproved-supplier invoices");
  });

  it("says no unapproved-supplier invoices rather than drawing an empty table", async () => {
    await renderUnapproved({ invoices: [] });

    expect(document.body.textContent).toContain("No unapproved-supplier invoices right now");
    expect(document.querySelector("table")).toBeNull();
  });

  it("asks the route for the chosen org, the same treatment every other analysis screen gives it", async () => {
    const seen: string[] = [];
    await renderUnapproved({ invoices: [] }, seen);

    expect(seen.some((u) => u.startsWith("/api/fraud/unapproved-suppliers"))).toBe(true);
  });
});

describe("the table itself, in the order the route returned it", () => {
  const DATA = {
    invoices: [
      {
        id: "inv-1",
        invoiceNumber: "INV-001",
        supplierName: null,
        supplierVatId: "GB123",
        totalWithVat: 4400,
        currency: "GBP",
        issueDate: "2026-09-01",
        reason: "notonfile",
        holdReason: null,
      },
      {
        id: "inv-2",
        invoiceNumber: "INV-002",
        supplierName: "Held Supplies Ltd",
        supplierVatId: "GB456",
        totalWithVat: 1200,
        currency: "EUR",
        issueDate: "2026-09-05",
        reason: "onhold",
        holdReason: "Under investigation",
      },
    ],
  };

  it("draws one row per invoice, in the order the route returned them", async () => {
    await renderUnapproved(DATA);

    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("INV-001");
    expect(rows[1].textContent).toContain("INV-002");
  });

  it("shows the reason as a plain label, not on file for an unmatched invoice", async () => {
    await renderUnapproved(DATA);

    const firstRow = document.querySelector("tbody tr")!;
    expect(firstRow.textContent).toContain("Not on file");
  });

  it("shows on hold, plus the supplier's own hold reason, for a held invoice", async () => {
    await renderUnapproved(DATA);

    const rows = [...document.querySelectorAll("tbody tr")];
    expect(rows[1].textContent).toContain("On hold");
    expect(rows[1].textContent).toContain("Under investigation");
  });

  it("falls back to the supplier VAT id when there is no supplier name", async () => {
    await renderUnapproved(DATA);

    expect(document.querySelector("tbody tr")?.textContent).toContain("GB123");
  });

  it("shows the invoice number, supplier and formatted money", async () => {
    await renderUnapproved({
      invoices: [{ ...DATA.invoices[1] }],
    });

    const firstRow = document.querySelector("tbody tr")!;
    const cells = [...firstRow.querySelectorAll("td")].map((td) => td.textContent);
    expect(cells[0]).toBe("INV-002");
    expect(cells[1]).toBe("Held Supplies Ltd");
    expect(cells[2]).toBe("EUR 1,200.00");
    expect(cells[3]).toBe("2026-09-05");
  });

  it("does not show a hold reason on a not-on-file row", async () => {
    await renderUnapproved({ invoices: [DATA.invoices[0]] });

    expect(document.querySelector("tbody tr")?.textContent).not.toContain("Under investigation");
  });
});
