import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Goods received not invoiced — decision 0650.** The card on AP
 * Analytics' Financial Performance tab.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "grni.heading": "Goods received not invoiced",
    "grni.sub": "In, not yet invoiced, at the purchase order's price",
    "grni.asat": "As at",
    "grni.download": "Download CSV",
    "grni.lines": "Order lines: {n}",
    "grni.over60": "{amount} over 60 days",
    "grni.unpriced": "Lines with no price on the order: {n}",
    "grni.none": "Nothing received and not yet invoiced at this date.",
    "grni.col.supplier": "Supplier",
    "grni.col.orders": "Orders",
    "grni.col.d30": "0–30 days",
    "grni.col.d60": "31–60",
    "grni.col.over60": "Over 60",
    "grni.col.total": "Total",
  },
};

const REPORT = {
  asAt: "2026-09-30",
  currencies: [{ currency: "GBP", total: 330, lines: 2, over60: 250, unpriced: 0 }],
  suppliers: [{ supplier: "Northwind", currency: "GBP", orders: ["PO-300"], d30: 80, d60: 0, over60: 250, total: 330 }],
  lines: [{}, {}],
};

let asked: string[] = [];

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main>`;
  vi.resetModules();
  asked = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      asked.push(String(url));
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/grni" && String(url).includes("format=csv")) return { ok: true, blob: async () => new Blob(["as_at\r\n"]) } as unknown as Response;
      if (path === "/api/grni") return { ok: true, json: async () => (String(url).includes("asAt=2026-08-31") ? { asAt: "2026-08-31", currencies: [], suppliers: [], lines: [] } : REPORT) } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
});
afterEach(() => vi.unstubAllGlobals());

async function card() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const grni = await import("/grni.js");
  await grni.load();
  const node = grni.renderCard();
  document.getElementById("shell")!.append(node);
  return node;
}

describe("the GRNI card", () => {
  it("shows each currency's total and what is over 60 days, then each supplier aged", async () => {
    const node = await card();
    expect(node.querySelector("h3")?.textContent).toBe("Goods received not invoiced");
    expect(node.querySelector(".grnitile")?.textContent).toContain("GBP 330.00");
    expect(node.querySelector(".grnitile")?.textContent).toContain("Order lines: 2");
    expect(node.querySelector(".grnitile")?.textContent).toContain("GBP 250.00 over 60 days");
    const cells = [...node.querySelectorAll(".grnitable tbody td")].map((c) => c.textContent);
    expect(cells).toEqual(["Northwind", "PO-300", "GBP 80.00", "—", "GBP 250.00", "GBP 330.00"]);
    expect((document.getElementById("grni-asat") as HTMLInputElement).value).toBe("2026-09-30");
  });

  it("works it out again as at another date, and downloads the CSV for the date shown", async () => {
    await card();
    const date = document.getElementById("grni-asat") as HTMLInputElement;
    date.value = "2026-08-31";
    date.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.getElementById("grni-card")?.textContent).toContain("Nothing received and not yet invoiced at this date."));
    expect(asked.some((u) => u.includes("asAt=2026-08-31"))).toBe(true);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    (document.getElementById("grni-download") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(asked.some((u) => u.includes("format=csv") && u.includes("asAt=2026-08-31"))).toBe(true));
  });
});
