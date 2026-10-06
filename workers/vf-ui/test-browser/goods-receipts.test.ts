import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **Goods Receipts — decision 0645.** The screen over the register
 * (0644): the list and chart, a receipt in its pop-out, recording a
 * receipt or a return, cancelling, and loading a CSV.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "nav.goodsreceipts": "Goods Receipts",
    "receipts.readonly": "You can see receipts here. Recording them needs AP.Receive.",
    "receipts.recordreceipt": "Record a receipt",
    "receipts.recordreturn": "Record a return",
    "receipts.state.not_received": "Not received",
    "receipts.state.partially_received": "Partially received",
    "receipts.state.fully_received": "Fully received",
    "receipts.state.over_received": "Over-received",
    "receipts.movement.received": "Receipt",
    "receipts.movement.returned": "Return",
    "receipts.creditexpected": "Credit expected",
    "receipts.creditexpectedn": "Credit expected {n}",
    "receipts.creditorders": "{n} orders expect a credit note for goods returned after invoicing.",
    "receipts.cancelreceipt": "Cancel receipt",
    "receipts.cancelconfirm": "Cancel it",
    "receipts.form.receivednow": "Received now",
    "receipts.form.returnednow": "Returned now",
    "receipts.form.willover": "That makes {held}, more than the {ordered} ordered. It will be saved, and the line shows over-received.",
    "receipts.saved.receipt": "Receipt {number} recorded.",
    "receipts.overline": "{order} line {line} now holds {held}, more than the {ordered} ordered.",
    "receipts.error.online": "Line {line}: {why}",
    "receipts.error.return_exceeds_received": "More than is held on that line.",
    "receipts.error.returns_depend_on_it": "Goods on this receipt were later returned. Cancel the return first.",
    "receipts.loaded": "{lines} lines loaded, {receipts} new receipts.",
    "receipts.refusedrow": "Row {row}: {why}",
    "receipts.error.order_line_not_found": "The purchase order has no such line.",
    "receipts.recheck.closed": "Invoice tasks waiting on these goods that have now closed: {n}.",
    "receipts.recheck.open": "Invoice tasks still waiting, as more is invoiced than is in: {n}.",
    "action.save": "Save",
    "action.close": "Close",
  },
};

const LIST = {
  receipts: [
    {
      id: "gr-2",
      receiptNumber: "GR-1002",
      receiptDate: "2026-10-03",
      deliveryNote: null,
      source: "screen",
      createdBy: "Priya",
      cancelled: false,
      lineCount: 1,
      movements: ["returned"],
      returnReason: "Damaged",
      orders: [{ orderNumber: "PO-4501", state: "partially_received", creditExpected: true, supplier: "Northwind Packaging" }],
    },
  ],
  total: 1,
  page: 1,
  pageSize: 50,
};

const ORDER = {
  orderNumber: "PO-4501",
  status: "active",
  orgUnitId: "acme-uk",
  currency: "GBP",
  supplier: { id: "northwind", name: "Northwind Packaging" },
  receiptingRequired: true,
  tolerancePct: 0,
  state: "partially_received",
  creditExpected: true,
  lines: [
    { lineNumber: 1, itemName: "Shipping carton", unitCode: "EA", onOrder: true, ordered: 200, received: 200, returned: 0, net: 200, outstanding: 0, invoiced: 200, state: "fully_received", creditExpected: 0 },
    { lineNumber: 2, itemName: "Bubble wrap roll", unitCode: "EA", onOrder: true, ordered: 50, received: 40, returned: 5, net: 35, outstanding: 15, invoiced: 40, state: "partially_received", creditExpected: 5 },
  ],
};

interface Call {
  method: string;
  path: string;
  body: unknown;
}

function stub(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      let body: unknown = null;
      if (init?.body) {
        try {
          body = JSON.parse(String(init.body));
        } catch {
          body = String(init.body);
        }
      }
      calls.push({ method, path, body });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      const own = routes[`${method} ${path}`];
      if (own) return reply(...own);
      if (path === "/api/ui-strings") return reply(200, STRINGS);
      if (path === "/api/whoami") return reply(200, { id: "u-sam", name: "Sam", permissions });
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      if (path === "/api/goods-receipts") return reply(200, LIST);
      if (path === "/api/goods-receipts/status-counts")
        return reply(200, { counts: { not_received: 2, partially_received: 1, fully_received: 3, over_received: 0, credit_expected: 1 } });
      if (path === "/api/goods-receipts/csv-format") return reply(200, { fields: [{ key: "receipt_number", columns: ["receipt_number"], required: "yes", description: "The number." }] });
      if (path === "/api/goods-return-reasons") return reply(200, { reasons: [{ id: "damaged", label: "Damaged" }] });
      if (path === "/api/goods-receipts/order/PO-4501") return reply(200, { order: ORDER, movements: [] });
      if (path === "/api/goods-receipts/gr-2")
        return reply(200, {
          receipt: { id: "gr-2", receiptNumber: "GR-1002", receiptDate: "2026-10-03", source: "screen", createdBy: "Priya", cancelled: false },
          lines: [{ lineNumber: 1, orderNumber: "PO-4501", orderLine: 2, movement: "returned", quantity: 5, unitCode: "EA", returnReason: "Damaged" }],
          orders: [ORDER],
        });
      return reply(404, {});
    })
  );
  return calls;
}

async function openScreen(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls = stub(permissions, routes);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open } = await import("/goods-receipts.js");
  await open();
  return calls;
}

const button = (label: string, root: ParentNode = document) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === label);
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the Goods Receipts screen", () => {
  it("lets AP.Validate look, with the order's state and credit expected, but not record", async () => {
    await openScreen(["AP.Validate"]);
    expect([...document.querySelectorAll(".navitem")].some((n) => n.textContent === "Goods Receipts")).toBe(true);
    expect(document.body.textContent).toContain("You can see receipts here.");
    expect(button("Record a receipt")).toBeUndefined();
    const row = document.querySelector('[data-receipt="gr-2"]')!;
    expect(row.textContent).toContain("GR-1002");
    expect(row.textContent).toContain("Northwind Packaging");
    expect(row.textContent).toContain("Return Damaged");
    expect(row.textContent).toContain("Partially received");
    expect(row.textContent).toContain("Credit expected");
    expect(document.getElementById("receipts-chart")?.textContent).toContain("1 orders expect a credit note");
  });

  it("opens a receipt with its lines and where the order stands, and says why a cancel was refused", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "POST /api/goods-receipts/gr-2/cancel": [409, { reason: "returns_depend_on_it" }],
    });
    (document.querySelector('[data-receipt="gr-2"]') as HTMLElement).click();
    await vi.waitFor(() => expect(document.querySelector(".popout")).not.toBeNull());
    const pop = document.querySelector(".popout")!;
    expect(pop.textContent).toContain("PO-4501 / 2");
    const line2 = pop.querySelector('.receiptfigures [data-line="2"]')!;
    expect([...line2.querySelectorAll("td")].map((c) => c.textContent)).toEqual(["2", "Bubble wrap roll", "50", "40", "5", "35", "40", "Partially receivedCredit expected 5"]);
    button("Cancel receipt", pop)!.click();
    (document.getElementById("receipt-cancelreason") as HTMLInputElement).value = "Wrong order";
    button("Cancel it", pop)!.click();
    await vi.waitFor(() => expect(document.getElementById("receipt-problem")?.textContent).toBe("Goods on this receipt were later returned. Cancel the return first."));
    expect(calls.find((c) => c.path === "/api/goods-receipts/gr-2/cancel")?.body).toEqual({ reason: "Wrong order" });
  });

  it("records a receipt: finds the order, fills in what is outstanding, warns of over-receipt, and says what was saved", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "POST /api/goods-receipts": [201, { id: "gr-3", receiptNumber: "GR-1003", lines: 1, warnings: [{ orderNumber: "PO-4501", orderLine: 2, ordered: 50, netAfter: 55 }], recheck: { closed: 2, stillOpen: 1 } }],
    });
    button("Record a receipt")!.click();
    const order = document.getElementById("record-order") as HTMLInputElement;
    order.value = "PO-4501";
    order.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector('#record-lines input[data-line="2"]')).not.toBeNull());
    // Line 1 is all in: nothing filled in. Line 2 has 15 outstanding.
    const one = document.querySelector('#record-lines input[data-line="1"]') as HTMLInputElement;
    const two = document.querySelector('#record-lines input[data-line="2"]') as HTMLInputElement;
    expect(one.value).toBe("");
    expect(two.value).toBe("15");
    two.value = "20";
    two.dispatchEvent(new Event("input"));
    expect(two.parentElement?.textContent).toContain("That makes 55, more than the 50 ordered.");
    (document.getElementById("record-number") as HTMLInputElement).value = "GR-1003";
    (document.getElementById("record-date") as HTMLInputElement).value = "2026-10-05";
    button("Save")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipts-saved")).not.toBeNull());
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/goods-receipts")?.body).toEqual({
      receiptNumber: "GR-1003",
      receiptDate: "2026-10-05",
      deliveryNote: "",
      lines: [{ orderNumber: "PO-4501", orderLine: 2, quantity: 20 }],
    });
    expect(document.getElementById("receipts-saved")?.textContent).toBe(
      "Receipt GR-1003 recorded.PO-4501 line 2 now holds 55, more than the 50 ordered.Invoice tasks waiting on these goods that have now closed: 2.Invoice tasks still waiting, as more is invoiced than is in: 1."
    );
  });

  it("records a return with its reason, and shows the refusal on its line", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "POST /api/goods-receipts": [422, { reason: "return_exceeds_received", line: 1 }],
    });
    button("Record a return")!.click();
    const order = document.getElementById("record-order") as HTMLInputElement;
    order.value = "PO-4501";
    order.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector('#record-lines input[data-line="2"]')).not.toBeNull());
    const two = document.querySelector('#record-lines input[data-line="2"]') as HTMLInputElement;
    expect(two.value).toBe("");
    two.value = "3";
    (document.getElementById("record-reason") as HTMLSelectElement).value = "damaged";
    (document.getElementById("record-number") as HTMLInputElement).value = "RT-1";
    button("Save")!.click();
    await vi.waitFor(() => expect(document.getElementById("record-problem")?.textContent).toBe("Line 1: More than is held on that line."));
    expect((calls.find((c) => c.method === "POST")?.body as { lines: unknown[] }).lines).toEqual([
      { orderNumber: "PO-4501", orderLine: 2, quantity: 3, movement: "returned", returnReason: "damaged" },
    ]);
  });

  it("loads a CSV and says what it loaded and refused, row by row", async () => {
    await openScreen(["AP.Receive"], {
      "POST /api/goods-receipts/csv-load": [200, { receiptsCreated: 1, linesLoaded: 2, linesSkipped: 0, warnings: [], refused: [{ row: 4, receiptNumber: "GR-9", reason: "order_line_not_found", message: "x" }] }],
    });
    const picker = document.getElementById("receiptsfile") as HTMLInputElement;
    const file = new File(["receipt_number\nGR-9"], "gr.csv", { type: "text/csv" });
    Object.defineProperty(picker, "files", { value: [file] });
    button("purchaseorders.loadbutton")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipts-outcome")).not.toBeNull());
    const outcome = document.getElementById("receipts-outcome")!.textContent;
    expect(outcome).toContain("2 lines loaded, 1 new receipts.");
    expect(outcome).toContain("Row 4: The purchase order has no such line.");
    await settle();
  });
});
