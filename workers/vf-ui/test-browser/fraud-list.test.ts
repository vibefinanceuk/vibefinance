import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Fraud Prevention's lists and tiles — decision 0618.** Each check
 * shows its first five, with *Show all N* opening Documents at exactly
 * those; a row opens its invoice; a tile takes you to its list.
 */

function mountShell() {
  document.body.innerHTML = `<div id="card-under-test"></div><main id="shell"></main><main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "fraudprevention.duplicates": "Potential duplicate invoices",
    "fraudprevention.duplicatessub": "Same supplier, amount and date",
    "fraudprevention.unapprovedsuppliers": "Unapproved-supplier invoices",
    "fraudprevention.unapprovedsupplierssub": "A supplier not on file, or one on hold",
    "fraudprevention.statisticaloutliers": "Statistical outliers",
    "fraudprevention.statisticaloutlierssub": "An amount well outside the supplier's range",
    "fraudprevention.segregationofduties": "Segregation-of-duties flags",
    "fraudprevention.segregationofdutiessub": "The same person claiming and approving",
    "fraudprevention.showall": "Show all {n}",
    "documents.showing.check": "Showing the invoices in {check}",
    "documents.showing.duplicates": "Showing possible duplicates only",
  },
};

function stub(routes: Record<string, unknown>, seen: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url);
      seen.push(path);
      if (path.startsWith("/api/ui-strings")) return { ok: true, json: async () => STRINGS } as Response;
      for (const [prefix, body] of Object.entries(routes)) {
        if (path.startsWith(prefix)) return { ok: true, json: async () => body } as Response;
      }
      if (path.startsWith("/api/org/units")) return { ok: true, json: async () => ({ units: [] }) } as Response;
      if (path.startsWith("/api/documents")) return { ok: true, json: async () => ({ documents: [], searched: 0 }) } as Response;
      // The viewer asks for more than these tests read; an empty answer is enough.
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

async function render(module: string, route: string, body: unknown, seen: string[] = []) {
  stub({ [route]: body }, seen);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const mod = await import(/* @vite-ignore */ module);
  await mod.load();
  document.getElementById("card-under-test")!.replaceChildren(mod.renderCard());
  return mod;
}

const invoice = (n: number) => ({
  id: `inv-${n}`,
  invoiceId: `inv-${n}`,
  invoiceNumber: `RE-${n}`,
  supplierName: "Lager Nord GmbH",
  totalWithVat: 100 + n,
  currency: "EUR",
  issueDate: "2026-09-29",
  duplicateConfidence: 0.9,
  reason: "notonfile",
  historicalMean: 50,
  zScore: 3,
  userId: "u1",
  userName: "Rae",
  stages: [{ requiredPermission: "AP.Approve", stageName: "Approval", completedAt: "2026-09-29" }],
});
const many = (n: number) => Array.from({ length: n }, (_, i) => invoice(i + 1));

async function documentsAsked(seen: string[]) {
  await vi.waitFor(() => expect(seen.some((u) => u.startsWith("/api/documents"))).toBe(true));
  return new URL(seen.find((u) => u.startsWith("/api/documents"))!, "http://x").searchParams;
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("each check full width, its first five, and Show all", () => {
  it("shows a check's first five of seven, its count beside the title, and a full-width card", async () => {
    await render("/fraud-duplicates.js", "/api/fraud/duplicates", { invoices: many(7) });
    const card = document.querySelector(".fraudlist")!;
    expect(card.classList.contains("card-list")).toBe(true);
    expect(card.id).toBe("fraud-duplicates");
    expect(card.querySelector(".cardhead h3")?.textContent).toBe("Potential duplicate invoices");
    expect(card.querySelector(".fraudcount")?.textContent).toBe("7");
    expect(card.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(card.querySelector(".fraudshowall")?.textContent).toBe("Show all 7");
  });

  it("offers no Show all where everything is already shown", async () => {
    await render("/fraud-unapproved-suppliers.js", "/api/fraud/unapproved-suppliers", { invoices: many(5) });
    expect(document.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(document.querySelector(".fraudshowall")).toBeNull();
  });

  it("duplicates' Show all opens Documents' own duplicates list", async () => {
    const seen: string[] = [];
    await render("/fraud-duplicates.js", "/api/fraud/duplicates", { invoices: many(6) }, seen);
    document.querySelector<HTMLElement>(".fraudshowall")!.click();
    expect((await documentsAsked(seen)).get("duplicates")).toBe("1");
  });

  it("outliers' Show all opens Documents at exactly those invoices, named in the banner", async () => {
    const seen: string[] = [];
    await render("/fraud-statistical-outliers.js", "/api/fraud/statistical-outliers", { invoices: many(6) }, seen);
    document.querySelector<HTMLElement>(".fraudshowall")!.click();
    expect((await documentsAsked(seen)).get("ids")).toBe("inv-1,inv-2,inv-3,inv-4,inv-5,inv-6");
    await vi.waitFor(() => expect(document.querySelector(".alertbanner")?.textContent).toContain("Showing the invoices in Statistical outliers"));
  });

  it("segregation of duties sends each invoice once, though two people may flag it", async () => {
    const seen: string[] = [];
    const flags = [...many(6), { ...invoice(1), userId: "u2", userName: "Sam" }];
    await render("/fraud-segregation-of-duties.js", "/api/fraud/segregation-of-duties", { invoices: flags }, seen);
    document.querySelector<HTMLElement>(".fraudshowall")!.click();
    expect((await documentsAsked(seen)).get("ids")).toBe("inv-1,inv-2,inv-3,inv-4,inv-5,inv-6");
  });

  it("each module gives its tile a count", async () => {
    const dup = await render("/fraud-duplicates.js", "/api/fraud/duplicates", { invoices: many(3) });
    expect(dup.summary()).toMatchObject({ key: "duplicates", count: 3, label: "Potential duplicate invoices" });
  });
});

describe("a row opens its invoice", () => {
  it("opens the viewer for that invoice, by mouse or keyboard, with the screen set aside", async () => {
    const seen: string[] = [];
    await render("/fraud-statistical-outliers.js", "/api/fraud/statistical-outliers", { invoices: many(2) }, seen);
    const row = document.querySelectorAll<HTMLElement>("tbody tr")[1];
    expect(row.classList.contains("clickable")).toBe(true);
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await vi.waitFor(() => expect(document.getElementById("viewer")!.hidden).toBe(false));
    expect(document.getElementById("shell")!.hidden).toBe(true);
    await vi.waitFor(() => expect(seen.some((u) => u.includes("inv-2"))).toBe(true));
  });
});

describe("the tiles", () => {
  it("draws one per check with its count, flags the ones with something, and takes you to its list", async () => {
    stub({});
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { fraudTiles } = await import("/fraud-list.js");
    const target = document.createElement("div");
    target.id = "fraud-outliers";
    const scrolled = vi.fn();
    target.scrollIntoView = scrolled;
    document.body.append(target);

    const tiles = fraudTiles([
      { key: "duplicates", label: "Potential duplicate invoices", count: 0 },
      { key: "outliers", label: "Statistical outliers", count: 3 },
      { key: "trends", label: "Exceptions", count: 41, weekly: [1, 2, 3, 4, 5, 6, 7, 13] },
    ]);
    document.getElementById("card-under-test")!.replaceChildren(tiles);

    const each = [...document.querySelectorAll<HTMLElement>(".fraudtile")];
    expect(each.map((n) => n.querySelector(".fraudtilecount")?.textContent)).toEqual(["0", "3", "41"]);
    expect(each.map((n) => n.classList.contains("flagged"))).toEqual([false, true, true]);
    expect(each[2].querySelector("svg")).not.toBeNull();
    each[1].click();
    expect(scrolled).toHaveBeenCalled();
  });
});
