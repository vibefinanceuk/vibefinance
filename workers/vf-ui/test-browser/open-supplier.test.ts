import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Opening one supplier — decision 0619.** A supplier named in a Fraud
 * Prevention list opens its card on the Suppliers screen, for someone who
 * may see suppliers; the rest of the row still opens the invoice.
 */

const SUPPLIER = {
  id: "sup-1",
  erpIdentifier: "17300032",
  name: "Lager Nord GmbH",
  vatId: "DE123456789",
  onHold: true,
  holdReason: "Bank details changed",
  status: "active",
};

const STRINGS = {
  locale: "en",
  strings: {
    "fraudprevention.statisticaloutliers": "Statistical outliers",
    "fraudprevention.opensupplier": "Open this supplier",
    "suppliers.heading": "Suppliers",
    "suppliers.notvisible": "{name} is not among the suppliers you can see for the organisation chosen",
  },
};

function stub(permissions: string[], suppliersById: Record<string, unknown> = { "sup-1": SUPPLIER }, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const [path, qs] = String(url).split("?");
      const params = new URLSearchParams(qs ?? "");
      seen.push(String(url));
      const ok = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
      if (path === "/api/ui-strings") return ok(STRINGS);
      if (path === "/api/whoami") return ok({ id: "u-dan", name: "Dan", permissions });
      if (path === "/api/fraud/statistical-outliers")
        return ok({
          invoices: [
            { id: "inv-1", invoiceNumber: "RE-1", supplierId: "sup-1", supplierName: "Lager Nord GmbH", totalWithVat: 900, currency: "EUR", issueDate: "2026-09-29", historicalMean: 300, zScore: 4 },
            { id: "inv-2", invoiceNumber: "RE-2", supplierId: "sup-gone", supplierName: "Gone Ltd", totalWithVat: 900, currency: "EUR", issueDate: "2026-09-29", historicalMean: 300, zScore: 3 },
            { id: "inv-3", invoiceNumber: "RE-3", supplierId: null, supplierName: "Printed Name Only", totalWithVat: 900, currency: "EUR", issueDate: "2026-09-29", historicalMean: 300, zScore: 3 },
          ],
        });
      if (path === "/api/suppliers/status-counts") return ok({ counts: null });
      if (path === "/api/suppliers") {
        const id = params.get("id");
        const one = id ? suppliersById[id] : null;
        const list = id ? (one ? [one] : []) : [SUPPLIER];
        return ok({ suppliers: list, total: list.length, page: 1, pageSize: 50, lastLoad: null, fedByLoad: false });
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

/** Signed in as someone with these permissions, the outliers card drawn on its own. */
async function outliersAs(permissions: string[], seen: string[] = [], suppliersById?: Record<string, unknown>) {
  stub(permissions, suppliersById, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const outliers = await import("/fraud-statistical-outliers.js");
  await outliers.load();
  document.getElementById("card-under-test")!.replaceChildren(outliers.renderCard());
}

beforeEach(() => {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll(".backdrop").forEach((b) => b.remove());
});

describe("a supplier's name in a Fraud Prevention list", () => {
  it("is a link to the supplier for someone who may see suppliers, and plain text where none is matched", async () => {
    await outliersAs(["AP.FraudReview", "AP.Supplier"]);
    const rows = [...document.querySelectorAll("#card-under-test tbody tr")];
    expect(rows[0].querySelector("button.suppliername")?.textContent).toBe("Lager Nord GmbH");
    expect(rows[0].querySelector("button.suppliername")?.getAttribute("title")).toBe("Open this supplier");
    expect(rows[2].querySelector("button.suppliername")).toBeNull();
    expect(rows[2].textContent).toContain("Printed Name Only");
  });

  it("is plain text for someone who may not see suppliers", async () => {
    await outliersAs(["AP.FraudReview"]);
    expect(document.querySelector("#card-under-test button.suppliername")).toBeNull();
    expect(document.querySelector("#card-under-test tbody")?.textContent).toContain("Lager Nord GmbH");
  });

  it("opens the Suppliers screen with that supplier's card open, not the invoice", async () => {
    const seen: string[] = [];
    await outliersAs(["AP.FraudReview", "AP.Supplier"], seen);
    document.querySelector<HTMLElement>("#card-under-test button.suppliername")!.click();

    await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/suppliers?") && u.includes("id=sup-1"))).toBe(true));
    await vi.waitFor(() => expect(document.querySelector(".backdrop")).not.toBeNull());
    const values = [...document.querySelectorAll<HTMLInputElement>(".backdrop input")].map((i) => i.value);
    expect(values).toContain("Lager Nord GmbH");
    // The invoice was not opened.
    expect(document.getElementById("viewer")!.hidden).toBe(true);
  });

  it("says so, on the Suppliers screen, when the supplier is not one the person can see", async () => {
    await outliersAs(["AP.FraudReview", "AP.Supplier"], [], { "sup-1": SUPPLIER });
    document.querySelectorAll<HTMLElement>("#card-under-test button.suppliername")[1].click();
    await vi.waitFor(() =>
      expect(document.getElementById("suppliers-note")?.textContent).toBe(
        "Gone Ltd is not among the suppliers you can see for the organisation chosen"
      )
    );
    expect(document.querySelector(".backdrop")).toBeNull();
  });
});
