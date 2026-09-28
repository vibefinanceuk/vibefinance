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

    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-pairing")?.body).toEqual({ lineNumber: 3, poLineNumber: 3 });
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
    expect(calls.find((c) => c.path === "/api/invoices/inv-1/po-pairing")?.body).toEqual({ lineNumber: 2, poLineNumber: null });
  });

  it("shows no picker to somebody whose task it is not", async () => {
    await open({ ...VIEW, canRelink: false });
    expect(panel().querySelector("select.pmpair")).toBeNull();
  });
});

