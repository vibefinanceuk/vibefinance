import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Matching stage's PO matching panel, phase 1 — decision 0530.
 * Every figure comes from the server; these check the panel shows it
 * as agreed in the mock-up, and that Use this PO posts the choice.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "action.close": "Close",
    "pomatch.title": "Purchase order matching",
    "pomatch.loading": "Loading…",
    "pomatch.loadfailed": "Could not load.",
    "pomatch.linked": "Linked purchase order",
    "pomatch.how": "Linked by the order number on the invoice ({po})",
    "pomatch.none": "No purchase order is linked. The invoice has no order number.",
    "pomatch.notheld": "The invoice names purchase order {po}, which is not held in VibeFinance.",
    "pomatch.ponumber": "PO number",
    "pomatch.supplier": "Supplier",
    "pomatch.buyer": "Buyer",
    "pomatch.issued": "Issued",
    "pomatch.status": "Status",
    "pomatch.used": "How much of this PO is used",
    "pomatch.usedpct": "{pct}% used once this invoice is paid",
    "pomatch.over": "Over by {amount}",
    "pomatch.already": "Already invoiced",
    "pomatch.thisinvoice": "This invoice",
    "pomatch.left": "Left",
    "pomatch.of": "of {total}",
    "pomatch.lines": "Invoice lines against the PO",
    "pomatch.clear": "{n} of {total} lines clear",
    "pomatch.tolerance": "price tolerance {pct}",
    "pomatch.invoiceline": "Invoice line",
    "pomatch.poline": "PO line",
    "pomatch.result": "Result",
    "pomatch.byref": "By line reference {ref}",
    "pomatch.noref": "No line reference on the invoice",
    "pomatch.refnotfound": "The PO has no line {ref}",
    "pomatch.r.matched": "Matched",
    "pomatch.r.price": "Amount differs {pct}",
    "pomatch.r.qty": "Quantity differs {pct}",
    "pomatch.r.unit": "Unit differs",
    "pomatch.r.nopoline": "No PO line",
    "pomatch.r.nocompare": "Cannot compare",
    "pomatch.unused": "PO lines this invoice does not use:",
    "pomatch.search.title": "Find a different purchase order",
    "pomatch.search.titlenone": "Find the purchase order",
    "pomatch.search.placeholder": "PO number",
    "pomatch.f.supplier": "This supplier only",
    "pomatch.f.active": "Active POs only",
    "pomatch.f.covers": "Enough left",
    "pomatch.col.po": "PO number",
    "pomatch.col.supplier": "Supplier",
    "pomatch.col.issued": "Issued",
    "pomatch.col.total": "PO total",
    "pomatch.col.used": "Used",
    "pomatch.col.left": "Left",
    "pomatch.col.status": "Status",
    "pomatch.col.why": "Why it fits",
    "pomatch.why.supplier": "Same supplier",
    "pomatch.why.covers": "Enough left",
    "pomatch.why.currency": "Same currency",
    "pomatch.use": "Use this PO",
    "pomatch.current": "Linked",
    "pomatch.noresults": "No purchase orders match.",
    "pomatch.relinkhint": "Only the person whose task this is can link a different purchase order.",
    "pomatch.linkfailed": "Could not link.",
    "pomatch.foot": "Recorded in the Timeline.",
    "pomatch.pair.own": "The invoice's own reference (line {ref})",
    "pomatch.pair.choose": "Choose a PO line…",
    "pomatch.pair.option": "Line {n}: {name}",
    "pomatch.pair.label": "PO line for invoice line {n}",
    "pomatch.pairedby": "Paired by {who}",
    "pomatch.supplierref": "the invoice says line {ref}",
    "pomatch.pairfailed": "Could not pair.",
    "pomatch.lineuse": "Ordered {ordered} · invoiced before {before} · this invoice {mine} · left {left}",
    "pomatch.unusedleft": "{n} left",
    "pomatch.suggest": "Suggested: line {n}, {name}",
    "pomatch.suggest.score": "{pct}% match",
    "pomatch.suggest.accept": "Accept",
    "pomatch.suggest.why.description": "similar description",
    "pomatch.suggest.why.price": "same price",
    "pomatch.suggest.why.fits": "fits what is left",
    "pomatch.why.lines": "{n} of {total} lines look alike",
    "pomatch.col.match": "Match",
    "pomatch.legend.ok": "Green: matches its PO line",
    "pomatch.legend.warn": "Amber: PO line found, but outside tolerance",
    "pomatch.legend.bad": "Red: no PO line for this invoice line",
    "pomatch.legend.dot": "Dot: paired by a person, not by the supplier's reference",
    "pomatch.chip.matched": "L{n} ✓",
    "pomatch.chip.over": "L{n} · {pct}",
    "pomatch.chip.unit": "L{n} · unit",
    "pomatch.chip.check": "L{n} · check",
    "pomatch.chip.nopoline": "No PO line",
    "pomatch.suggestedby": "Suggestion accepted by {who}",
    "pomatch.pop.title": "Line {n} against the PO",
    "pomatch.pop.sub": "Purchase order {po}",
    "pomatch.pop.invoice": "Invoice line",
    "pomatch.pop.po": "PO line",
    "pomatch.pop.open": "Open PO matching",
    "pomatch.pop.readonly": "Read-only here. To change the matching, return the invoice to the Matching stage.",
    "pomatch.pair.nonpo": "Non-PO line (code manually)",
    "pomatch.nonpoby": "Marked Non-PO by {who}",
    "pomatch.r.nonpo": "Non-PO line",
    "pomatch.chip.nonpo": "Non-PO",
    "pomatch.legend.nonpo": "Grey: Non-PO line, not on the order and coded by hand",
    "pomatch.codingcleared": "Line {n} now has a PO line, so the coding keyed on it was removed.",
    "pomatch.pop.nonpo": "Not on the order. Coded by hand in the Coding column, like a Non-PO invoice line.",
    "pomatch.nonpoexcluded": "This invoice's Non-PO lines ({amount} with VAT) are left out.",
    "purchaseorders.status.active": "Active",
    "purchaseorders.status.invoicedpart": "Invoiced (Part)",
    "purchaseorders.status.closed": "Closed",
  },
};

const VIEW = {
  invoice: { id: "inv-1", number: "INV-1", supplierName: "Northwind", currency: "GBP", total: 1735, orderReference: "PO-A" },
  tolerance: { amountPct: 2, quantityPct: 0, quantityMatchingEnabled: true, source: "org" },
  referenceNotFound: false,
  po: {
    orderNumber: "PO-A",
    issueDate: "2026-09-01",
    currency: "GBP",
    sellerPartyId: "GB111",
    supplierName: "Northwind",
    buyerName: "Sarah Kent",
    payableAmount: 2484,
    status: "invoiced_part",
  },
  header: { matched: false, variancePct: 30 },
  usage: { poTotal: 2484, invoicedByOthers: 420, otherInvoices: [{ id: "inv-0", number: "INV-0", amount: 420 }], thisInvoice: 1735, left: 329 },
  lines: [
    {
      lineNumber: 1, name: "Toner", quantity: 10, unit: "EA", price: 42, amount: 420, orderLineReference: "1", pairing: null,
      poLine: { lineNumber: 1, name: "Toner cartridge", quantity: 10, unit: "EA", price: 42, amount: 420 },
      result: { matched: true, referenceFound: true, priceMatched: true, quantityMatched: true, unitMismatch: false, variancePct: 0, quantityVariancePct: 0 },
    },
    {
      lineNumber: 2, name: "Paper", quantity: 50, unit: "EA", price: 24.5, amount: 1225, orderLineReference: "2", pairing: null,
      poLine: { lineNumber: 2, name: "A4 paper", quantity: 60, unit: "EA", price: 23.5, amount: 1410 },
      result: { matched: false, referenceFound: true, priceMatched: false, quantityMatched: true, unitMismatch: false, variancePct: 13.1, quantityVariancePct: 16.7 },
    },
    {
      lineNumber: 3, name: "Organiser", quantity: 5, unit: "EA", price: 18, amount: 90, orderLineReference: null, pairing: null, poLine: null,
      result: { matched: false, referenceFound: false, priceMatched: null, quantityMatched: null, unitMismatch: false, variancePct: null, quantityVariancePct: null },
    },
  ],
  unusedPoLines: [{ lineNumber: 3, name: "Stapler", quantity: 6, unit: "EA", price: 15, amount: 90 }],
  poLineOptions: [
    { lineNumber: 1, name: "Toner cartridge", quantity: 10, unit: "EA", price: 42 },
    { lineNumber: 2, name: "A4 paper", quantity: 60, unit: "EA", price: 23.5 },
    { lineNumber: 3, name: "Stapler", quantity: 6, unit: "EA", price: 15 },
  ],
  canRelink: true,
};

const CANDIDATES = {
  candidates: [
    { orderNumber: "PO-A", issueDate: "2026-09-01", currency: "GBP", supplierName: "Northwind", sellerPartyId: "GB111", payableAmount: 2484, invoicedByOthers: 420, left: 2064, status: "invoiced_part", current: true, reasons: { sameSupplier: true, coversInvoice: true, sameCurrency: true } },
    { orderNumber: "PO-B", issueDate: "2026-08-21", currency: "GBP", supplierName: "Northwind", sellerPartyId: "GB111", payableAmount: 5000, invoicedByOthers: 0, left: 5000, status: "active", current: false, reasons: { sameSupplier: true, coversInvoice: true, sameCurrency: true } },
  ],
};

type Call = { path: string; query: string; body?: unknown };

function stub(routes: Record<string, unknown | (() => unknown)>, calls: Call[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, query = ""] = String(url).split("?");
      calls.push({ path, query, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      const value = routes[path];
      return { ok: true, json: async () => (typeof value === "function" ? (value as () => unknown)() : value) } as Response;
    })
  );
}

async function open(view: unknown = VIEW, calls: Call[] = [], extra: Record<string, unknown> = {}) {
  stub(
    {
      "/api/ui-strings": STRINGS,
      "/api/invoices/inv-1/po-match": view,
      "/api/invoices/inv-1/po-candidates": CANDIDATES,
      ...extra,
    },
    calls
  );
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { openPoMatchingPanel } = await import("/po-match.js");
  const onRelinked = vi.fn();
  await openPoMatchingPanel("inv-1", { onRelinked });
  return { onRelinked };
}

const panel = () => document.querySelector(".pompanel") as HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the PO matching panel — decision 0530", () => {
  it("shows the linked PO, how it was linked, and its status in the Purchase Orders screen's own words", async () => {
    await open();
    const text = panel().textContent ?? "";
    expect(text).toContain("PO-A");
    expect(text).toContain("Linked by the order number on the invoice (PO-A)");
    expect(text).toContain("Sarah Kent");
    expect(text).toContain("Invoiced (Part)");
  });

  it("shows how much of the PO is used: already invoiced in grey, this invoice in blue, and what is left", async () => {
    await open();
    const bar = panel().querySelector(".pmbar.big") as HTMLElement;
    const [others, mine] = [...bar.querySelectorAll(".pmseg")] as HTMLElement[];
    expect(others.classList.contains("others")).toBe(true);
    expect(mine.classList.contains("mine")).toBe(true);
    expect(parseFloat(others.style.width)).toBeCloseTo((420 / 2484) * 100, 1);
    expect(parseFloat(mine.style.width)).toBeCloseTo((1735 / 2484) * 100, 1);
    const legend = panel().querySelector(".pmlegend")?.textContent ?? "";
    expect(legend).toContain("INV-0");
    expect(legend).toContain("329.00");
    expect(panel().textContent).toContain("87% used once this invoice is paid");

    // The mock-up's one change, from the real stylesheet: grey, then blue.
    const css = (await import("virtual:stylesheets")).default["app.css"];
    const rule = (sel: string) => css.slice(css.indexOf(`${sel} {`), css.indexOf("}", css.indexOf(`${sel} {`)));
    expect(rule(".pmseg.others")).toContain("var(--text-muted)");
    expect(rule(".pmseg.mine")).toContain("var(--chart-1)");
  });

  it("turns the bar red when this invoice would take the PO past its total", async () => {
    await open({ ...VIEW, usage: { ...VIEW.usage, thisInvoice: 2500, left: -436 } });
    expect(panel().querySelector(".pmseg.mine")?.classList.contains("over")).toBe(true);
    expect(panel().textContent).toContain("Over by 436.00");
  });

  it("shows each invoice line against its PO line with the server's verdict, and PO lines not used", async () => {
    await open();
    const row = (n: number) => panel().querySelector(`tr[data-line="${n}"]`) as HTMLElement;
    expect(row(1).textContent).toContain("Matched");
    expect(row(1).textContent).toContain("By line reference 1");
    expect(row(2).textContent).toContain("Amount differs 13.1%");
    expect(row(3).textContent).toContain("No line reference on the invoice");
    expect(row(3).textContent).toContain("No PO line");
    expect(panel().textContent).toContain("1 of 3 lines clear");
    expect(panel().querySelector(".pmunused")?.textContent).toContain("Stapler");
  });

  it("says plainly when the invoice names a PO that is not held, or none at all", async () => {
    await open({ ...VIEW, po: null, usage: null, referenceNotFound: true, lines: [], unusedPoLines: [] });
    expect(panel().querySelector(".pmempty")?.textContent).toContain("names purchase order PO-A, which is not held");
    expect(panel().textContent).toContain("Find the purchase order");
  });

  it("searches with this supplier and active POs switched on to start with", async () => {
    const calls: Call[] = [];
    await open(VIEW, calls);
    const search = calls.find((c) => c.path === "/api/invoices/inv-1/po-candidates")!;
    const params = new URLSearchParams(search.query);
    expect(params.get("supplierOnly")).toBe("1");
    expect(params.get("activeOnly")).toBe("1");
    expect(params.get("coversInvoice")).toBeNull();
    const current = panel().querySelector('tr[data-po="PO-A"]') as HTMLElement;
    expect(current.classList.contains("current")).toBe(true);
    expect(current.textContent).toContain("Linked");
    expect(panel().querySelector('tr[data-po="PO-B"]')?.textContent).toContain("Same supplier · Enough left · Same currency");
  });

  it("links a different PO, reloads, and tells the viewer to redraw when closed", async () => {
    const calls: Call[] = [];
    const { onRelinked } = await open(VIEW, calls, { "/api/invoices/inv-1/po-link": { orderNumber: "PO-B" } });
    (panel().querySelector('tr[data-po="PO-B"] .pmuse') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-link")?.body).toEqual({ orderNumber: "PO-B" });
    expect(calls.filter((c) => c.path === "/api/invoices/inv-1/po-match")).toHaveLength(2);
    expect(onRelinked).not.toHaveBeenCalled();
    (panel().querySelector(".cardhead .actionlink") as HTMLButtonElement).click();
    expect(onRelinked).toHaveBeenCalledOnce();
    expect(document.querySelector(".pompanel")).toBeNull();
  });

  it("offers no Use this PO to somebody whose task it is not, and says why", async () => {
    await open({ ...VIEW, canRelink: false });
    expect(panel().querySelector(".pmuse")).toBeNull();
    expect(panel().textContent).toContain("Only the person whose task this is");
  });
});

describe("pairing a line by hand — decision 0532", () => {
  it("offers every PO line on each invoice line, starting from what is in force now", async () => {
    await open();
    const picker = (n: number) => panel().querySelector(`tr[data-line="${n}"] select.pmpair`) as HTMLSelectElement;
    expect([...picker(1).options].map((o) => o.textContent)).toEqual([
      "The invoice's own reference (line 1)",
      "Line 1: Toner cartridge (10 EA × 42.00)",
      "Line 2: A4 paper (60 EA × 23.50)",
      "Line 3: Stapler (6 EA × 15.00)",
      // Decision 0537 — last, as the one choice that is not a PO line.
      "Non-PO line (code manually)",
    ]);
    expect(picker(1).value).toBe("");
    expect(picker(3).options[0].textContent).toBe("Choose a PO line…");
  });

  it("saves a choice, reloads, and tells the viewer to redraw when closed", async () => {
    const calls: Call[] = [];
    const paired = {
      ...VIEW,
      lines: VIEW.lines.map((l) =>
        l.lineNumber === 3
          ? { ...l, pairing: { poLineNumber: 3, pairedByName: "Dan", pairedAt: "2026-09-28" }, poLine: { lineNumber: 3, name: "Stapler", quantity: 6, unit: "EA", price: 15, amount: 90 } }
          : l
      ),
    };
    let served = 0;
    const { onRelinked } = await open(VIEW, calls, {
      "/api/invoices/inv-1/po-pairing": { lineNumber: 3, poLineNumber: 3 },
      "/api/invoices/inv-1/po-match": () => (served++ === 0 ? VIEW : paired),
    });
    const picker = panel().querySelector('tr[data-line="3"] select.pmpair') as HTMLSelectElement;
    picker.value = "3";
    picker.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 20));

    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-pairing")?.body).toEqual({ lineNumber: 3, poLineNumber: 3, source: "manual" });
    const row = panel().querySelector('tr[data-line="3"]') as HTMLElement;
    expect(row.querySelector(".pmpaired")?.textContent).toBe("Paired by Dan");
    expect((row.querySelector("select.pmpair") as HTMLSelectElement).value).toBe("3");

    (panel().querySelector(".cardhead .actionlink") as HTMLButtonElement).click();
    expect(onRelinked).toHaveBeenCalledOnce();
  });

  it("clears a pairing by choosing the invoice's own reference", async () => {
    const calls: Call[] = [];
    const withPairing = {
      ...VIEW,
      lines: VIEW.lines.map((l) => (l.lineNumber === 2 ? { ...l, pairing: { poLineNumber: 3, pairedByName: "Dan", pairedAt: "x" } } : l)),
    };
    await open(withPairing, calls, { "/api/invoices/inv-1/po-pairing": { lineNumber: 2, poLineNumber: null } });
    const row = panel().querySelector('tr[data-line="2"]') as HTMLElement;
    expect(row.querySelector(".pmpaired")?.textContent).toBe("Paired by Dan · the invoice says line 2");
    const picker = row.querySelector("select.pmpair") as HTMLSelectElement;
    expect(picker.value).toBe("3");
    picker.value = "";
    picker.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-pairing")?.body).toEqual({ lineNumber: 2, poLineNumber: null, source: "manual" });
  });

  it("shows no picker to somebody whose task it is not", async () => {
    await open({ ...VIEW, canRelink: false });
    expect(panel().querySelector("select.pmpair")).toBeNull();
  });
});

describe("how much of each PO line is used — decision 0533", () => {
  const use = (o: Record<string, number | null>) => ({
    orderedQuantity: 60, orderedAmount: 1410, beforeQuantity: 4, beforeAmount: 94,
    thisQuantity: 50, thisAmount: 1225, leftQuantity: 6, leftAmount: 91, ...o,
  });
  const withUse = (u: ReturnType<typeof use>) => ({
    ...VIEW,
    lines: VIEW.lines.map((l) => (l.lineNumber === 2 && l.poLine ? { ...l, poLine: { ...l.poLine, use: u } } : l)),
  });

  it("shows ordered, invoiced before, this invoice and left under the PO line, with a bar", async () => {
    await open(withUse(use({})));
    const row = panel().querySelector('tr[data-line="2"] .pmlineuse') as HTMLElement;
    expect(row.textContent).toContain("Ordered 60 · invoiced before 4 · this invoice 50 · left 6");
    const [before, mine] = [...row.querySelectorAll(".pmseg")] as HTMLElement[];
    expect(parseFloat(before.style.width)).toBeCloseTo((4 / 60) * 100, 1);
    expect(parseFloat(mine.style.width)).toBeCloseTo((50 / 60) * 100, 1);
    expect(mine.classList.contains("over")).toBe(false);
  });

  it("turns red when this invoice takes the line past what was ordered", async () => {
    await open(withUse(use({ beforeQuantity: 20, leftQuantity: -10 })));
    const row = panel().querySelector('tr[data-line="2"] .pmlineuse') as HTMLElement;
    expect(row.querySelector(".pmseg.mine")?.classList.contains("over")).toBe(true);
    expect(row.textContent).toContain("left -10");
  });

  it("falls back to amounts for a PO line with no quantity", async () => {
    await open(withUse(use({ orderedQuantity: null, leftQuantity: null })));
    expect(panel().querySelector('tr[data-line="2"] .pmlineuse')?.textContent).toContain("Ordered 1,410.00");
  });
});

describe("suggesting a PO line — decision 0534", () => {
  const withSuggestion = {
    ...VIEW,
    lines: VIEW.lines.map((l) =>
      l.lineNumber === 3 ? { ...l, suggestion: { poLineNumber: 3, score: 80, reasons: ["description", "price", "fits"] } } : l
    ),
  };

  it("shows the suggested line, how sure, and why", async () => {
    await open(withSuggestion);
    const box = panel().querySelector('tr[data-line="3"] .pmsuggest') as HTMLElement;
    expect(box.textContent).toContain("Suggested: line 3, Stapler");
    expect(box.textContent).toContain("(80% match: similar description · same price · fits what is left)");
    expect(panel().querySelector('tr[data-line="1"] .pmsuggest')).toBeNull();
  });

  it("Accept saves the suggestion as a pairing, recorded as an accepted suggestion (0536)", async () => {
    const calls: Call[] = [];
    await open(withSuggestion, calls, { "/api/invoices/inv-1/po-pairing": { lineNumber: 3, poLineNumber: 3 } });
    (panel().querySelector('tr[data-line="3"] .pmaccept') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-pairing")?.body).toEqual({ lineNumber: 3, poLineNumber: 3, source: "suggestion" });
  });

  it("offers no Accept to somebody whose task it is not", async () => {
    await open({ ...withSuggestion, canRelink: false });
    expect(panel().querySelector(".pmsuggest")).not.toBeNull();
    expect(panel().querySelector(".pmaccept")).toBeNull();
  });

  it("says in the search how many lines look alike", async () => {
    const calls: Call[] = [];
    await open(VIEW, calls, {
      "/api/invoices/inv-1/po-candidates": {
        candidates: CANDIDATES.candidates.map((c) => ({ ...c, reasons: { ...c.reasons, linesAlike: 2, lineCount: 3 } })),
      },
    });
    expect(panel().querySelector('tr[data-po="PO-B"]')?.textContent).toContain("2 of 3 lines look alike");
  });
});


describe("the invoice line Match column — decision 0536", () => {
  const result = (over: Record<string, unknown> = {}) => ({
    matched: false, referenceFound: true, priceMatched: true, quantityMatched: true, unitMismatch: false, variancePct: 0, quantityVariancePct: 0, ...over,
  });
  const use = { orderedQuantity: 10, orderedAmount: 420, beforeQuantity: 0, beforeAmount: 0, thisQuantity: 10, thisAmount: 420, leftQuantity: 0, leftAmount: 0 };
  const LINES = [
    { lineNumber: 1, state: "matched", supplierReference: "1", poLine: { lineNumber: 1, name: "Toner cartridge", quantity: 10, unit: "EA", price: 42, amount: 420 }, use, result: result({ matched: true }), pairing: null },
    { lineNumber: 2, state: "over", supplierReference: "2", poLine: { lineNumber: 2, name: "A4 paper", quantity: 60, unit: "EA", price: 23.5, amount: 1410 }, use, result: result({ priceMatched: false, variancePct: 4.3 }), pairing: null },
    { lineNumber: 3, state: "unit", supplierReference: null, poLine: { lineNumber: 4, name: "Desk organiser", quantity: 8, unit: "BX", price: 18, amount: 144 }, use, result: result({ unitMismatch: true }), pairing: { source: "suggestion", pairedByName: "Dan", pairedAt: "2026-09-28 10:15:00" } },
    { lineNumber: 4, state: "nopoline", supplierReference: "9", poLine: null, use: null, result: result({ referenceFound: false, priceMatched: null, quantityMatched: null }), pairing: null },
  ];
  const SUMMARY = { orderNumber: "PO-A", held: true, lines: LINES };

  async function chips() {
    stub({ "/api/ui-strings": STRINGS });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    return await import("/po-match.js");
  }

  it("colours each chip by the server's verdict: green matched, amber outside tolerance or unit, red no PO line", async () => {
    const { matchChip } = await chips();
    const made = LINES.map((l) => matchChip(l, () => {}));
    expect(made.map((c) => [c.className, c.textContent])).toEqual([
      ["pmchip ok", "L1 ✓"],
      ["pmchip warn", "L2 · +4.3%"],
      ["pmchip warn", "L4 · unit"],
      ["pmchip bad", "No PO line"],
    ]);
    // The dot marks a pairing a person made; the supplier's own reference has none.
    expect(made.map((c) => c.querySelector(".pmdot") !== null)).toEqual([false, false, true, false]);
  });

  it("explains itself on hover: this line's verdict first, then what every colour means", async () => {
    const { matchChip, matchLegend } = await chips();
    const title = matchChip(LINES[2], () => {}).title;
    expect(title.split("\n")[0]).toBe("Unit differs · Suggestion accepted by Dan");
    expect(title).toContain("Green: matches its PO line");
    expect(title).toContain("Amber: PO line found, but outside tolerance");
    expect(title).toContain("Red: no PO line for this invoice line");
    expect(title).toContain("Dot: paired by a person");
    expect(matchLegend().split("\n")).toHaveLength(5);
  });

  it("opens a read-only pop-out: the invoice line against its PO line, how they were paired, and how much is used", async () => {
    const { openLineMatchPopout } = await chips();
    openLineMatchPopout(SUMMARY, LINES[2], { invoiceLine: { "BT-153": "Organiser", "BT-129": "5", "BT-130": "EA", "BT-146": "18", "BT-131": "90" } });
    const pop = document.querySelector(".pmlinepop") as HTMLElement;
    expect(pop.querySelector("h3")?.textContent).toBe("Line 3 against the PO");
    expect(pop.textContent).toContain("Purchase order PO-A");
    expect(pop.querySelector(".pmcompare")?.textContent).toContain("Organiser");
    expect(pop.querySelector(".pmcompare")?.textContent).toContain("5 EA × 18.00 = 90.00");
    expect(pop.querySelector(".pmcompare")?.textContent).toContain("4 Desk organiser");
    expect(pop.querySelector(".pmpill")?.textContent).toBe("Unit differs");
    expect(pop.textContent).toContain("Suggestion accepted by Dan");
    expect(pop.querySelector(".pmlineuse")).not.toBeNull();
    // Nothing to change here: no picker, no Accept, no Open PO matching.
    expect(pop.querySelector("select, .pmaccept, button.primary")).toBeNull();
    expect(pop.textContent).toContain("return the invoice to the Matching stage");
  });

  it("offers Open PO matching when the viewer passes it (Matching, this person's own task), and closes itself first", async () => {
    const { openLineMatchPopout } = await chips();
    const onOpenPanel = vi.fn();
    openLineMatchPopout(SUMMARY, LINES[3], { onOpenPanel });
    const button = document.querySelector(".pmlinepop button.primary") as HTMLButtonElement;
    expect(button.textContent).toBe("Open PO matching");
    expect(document.querySelector(".pmlinepop")?.textContent).not.toContain("return the invoice");
    button.click();
    expect(onOpenPanel).toHaveBeenCalledOnce();
    expect(document.querySelector(".pmlinepop")).toBeNull();
  });

  it("the panel says a pairing came from an accepted suggestion", async () => {
    await open({
      ...VIEW,
      lines: VIEW.lines.map((l) => (l.lineNumber === 3 ? { ...l, pairing: { poLineNumber: 3, pairedByName: "Dan", pairedAt: "2026-09-28", source: "suggestion" } } : l)),
    });
    expect(panel().querySelector('tr[data-line="3"] .pmpaired')?.textContent).toBe("Suggestion accepted by Dan");
  });
});

describe("a Non-PO line — decision 0537", () => {
  const withNonPo = {
    ...VIEW,
    lines: VIEW.lines.map((l) =>
      l.lineNumber === 3
        ? { ...l, nonPo: true, pairing: { poLineNumber: null, pairedByName: "Dan", pairedAt: "2026-09-28", source: "manual", kind: "non_po" } }
        : l
    ),
  };

  it("offers Non-PO in every line's picker, and marking posts it as such", async () => {
    const calls: Call[] = [];
    await open(VIEW, calls, { "/api/invoices/inv-1/po-pairing": { lineNumber: 3, poLineNumber: null, nonPo: true, codingCleared: false } });
    const select = panel().querySelector('tr[data-line="3"] select.pmpair') as HTMLSelectElement;
    expect([...select.options].at(-1)?.textContent).toBe("Non-PO line (code manually)");
    select.value = "non_po";
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-pairing")?.body).toEqual({ lineNumber: 3, nonPo: true });
  });

  it("shows a Non-PO line as resolved: the choice selected, a grey verdict, and who marked it", async () => {
    await open(withNonPo);
    const row = panel().querySelector('tr[data-line="3"]') as HTMLElement;
    expect((row.querySelector("select.pmpair") as HTMLSelectElement).value).toBe("non_po");
    expect(row.querySelector(".pmpill")?.className).toBe("pmpill muted");
    expect(row.querySelector(".pmpill")?.textContent).toBe("Non-PO line");
    expect(row.querySelector(".pmpaired")?.textContent).toBe("Marked Non-PO by Dan");
  });

  it("says when pairing a line removed the coding somebody keyed on it", async () => {
    await open(withNonPo, [], { "/api/invoices/inv-1/po-pairing": { lineNumber: 3, poLineNumber: 3, codingCleared: true } });
    const select = panel().querySelector('tr[data-line="3"] select.pmpair') as HTMLSelectElement;
    select.value = "3";
    select.dispatchEvent(new Event("change"));
    await new Promise((r) => setTimeout(r, 20));
    const notice = panel().querySelector(".pmnotice") as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.textContent).toBe("Line 3 now has a PO line, so the coding keyed on it was removed.");
  });

  it("chips a Non-PO line grey with no dot, and the pop-out says it is coded by hand", async () => {
    stub({ "/api/ui-strings": STRINGS });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { matchChip, openLineMatchPopout, matchLegend } = await import("/po-match.js");
    const line = {
      lineNumber: 5, state: "nonpo", supplierReference: "2", poLine: null, use: null,
      result: { matched: false, referenceFound: false, priceMatched: null, quantityMatched: null, unitMismatch: false, variancePct: null, quantityVariancePct: null },
      pairing: { kind: "non_po", source: "manual", pairedByName: "Dan", pairedAt: "2026-09-28 10:00:00" },
    };
    const chip = matchChip(line, () => {});
    expect([chip.className, chip.textContent]).toEqual(["pmchip muted", "Non-PO"]);
    expect(chip.querySelector(".pmdot")).toBeNull();
    expect(chip.title.split("\n")[0]).toBe("Non-PO line · Marked Non-PO by Dan");
    expect(matchLegend()).toContain("Grey: Non-PO line");
    openLineMatchPopout({ orderNumber: "PO-A", held: true, lines: [line] }, line);
    expect(document.querySelector(".pmlinepop")?.textContent).toContain("Coded by hand in the Coding column");
  });
});

describe("the usage bar leaves Non-PO lines out — decision 0544", () => {
  it("says how much this invoice's Non-PO lines added, and nothing when there are none", async () => {
    await open({ ...VIEW, usage: { ...VIEW.usage, thisInvoice: 1500, nonPoExcluded: 235, left: 564 } });
    expect(panel().querySelector(".pmnonponote")?.textContent).toBe("This invoice's Non-PO lines (235.00 with VAT) are left out.");
    document.body.innerHTML = "";
    await open(VIEW);
    expect(panel().querySelector(".pmnonponote")).toBeNull();
  });
});
