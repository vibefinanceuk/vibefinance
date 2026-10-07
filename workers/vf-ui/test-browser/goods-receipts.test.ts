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
    "receipts.status.pending": "Pending",
    "receipts.status.rejected": "Rejected",
    "receipts.pendingat": "Pending at {stage} in {process}: it counts once registered.",
    "receipts.rejectreceipt": "Reject receipt",
    "receipts.rejectconfirm": "Reject it",
    "receipts.rejected.done": "Receipt {number} rejected.",
    "receipts.sent": "Sent through {process}. Registered: {registered}. Waiting: {waiting}.",
    "receipts.process.direct": "Receipts loaded here register at once.",
    "receipts.process.through": "Receipts loaded here go through {process} and count once registered.",
    "receipts.process.setup": "Set up Warehouse Receipts",
    "receipts.process.name": "Warehouse Receipts",
    "receipts.process.teamname": "AP Receiving",
    "receipts.process.stage.intake": "Intake",
    "receipts.process.stage.matching": "Matching",
    "receipts.process.stage.complete": "Complete",
    "receipts.process.done": "{process} is set up. Receipts loaded here now go through it.",
    "receipts.register": "Register",
    "receipts.registered.done": "Receipt {number} registered.",
    "receipts.col.check": "Check",
    "receipts.col.fix": "Fix",
    "receipts.check.matched": "Matched",
    "receipts.check.rejected": "Rejected",
    "receipts.fix.change": "Change",
    "receipts.task.mine": "You have claimed this receipt's task. Fix its lines, then Register or Reject.",
    "receipts.task.other": "{who} has claimed this receipt's task. Only they can work on it.",
    "receipts.task.none": "Nobody has claimed this receipt's task. Claim it to fix lines, register or reject.",
    "receipts.task.claim": "Claim",
    "receipts.task.release": "Release",
    "receipts.fix.quantity": "Quantity",
    "receipts.fix.unit": "Unit",
    "receipts.orderline": "{item} · ordered {qty} {unit}",
    "receipts.orderline.missing": "Not a line on this order",
    "receipts.corrected": "Was {was}, corrected by {who}",
    "receipts.fix.rejectline": "Reject line",
    "receipts.fix.rejectprompt": "Why is line {line} rejected? It will never count.",
    "receipts.error.lines_need_attention": "Some lines still need attention: fix or reject them first.",
    "receipts.process.team": "Matching's tasks go to the {team} team. Members: {n}.",
    "create.kind.invoices": "Invoices",
    "create.kind.receipts": "Goods receipts",
    "create.gr.status.ready": "Ready",
    "create.gr.status.attention": "Lines needing attention at Matching: {n}",
    "create.gr.status.skipped": "Already loaded, skipped",
    "create.gr.status.refused": "Rows refused: {n}",
    "create.gr.status.registered": "Registered",
    "create.gr.status.pending": "Waiting at {n}",
    "create.gr.lineneeds": "Line {line}: {why}",
    "create.gr.sendn": "Send {n} receipts",
    "create.gr.message": "Route monitor message: {id}",
    "receipts.waiting.line": "Waiting for its PO · days: {days}",
    "receipts.waiting.receipt": "Lines waiting for a PO: {n} · days: {days}",
    "receipts.check.counted": "Counted",
    "receipts.heldback": "Registered. Lines held back waiting for their purchase order: {n}. Each counts once its order is loaded and it matches.",
    "action.save": "Save",
    "action.close": "Close",
    "action.claim": "Claim",
    "action.release": "Release",
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
    (await import("/goods-receipts.js")).openRecord("received");
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
    (await import("/goods-receipts.js")).openRecord("returned");
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

  it("opens Create → Goods receipts from its Load and Record buttons, on the matching tab — decision 0653", async () => {
    await openScreen(["AP.Receive"]);
    document.getElementById("receipts-toupload")!.click();
    await vi.waitFor(() => expect(document.getElementById("create-grdrop")).not.toBeNull());
    expect(document.getElementById("create-grtab-upload")?.className).toBe("doctab on");
    const { open } = await import("/goods-receipts.js");
    await open();
    button("Record a return")!.click();
    await vi.waitFor(() => expect(document.getElementById("record-reason")).not.toBeNull());
    expect(document.getElementById("create-grtab-return")?.className).toBe("doctab on");
    await settle();
  });
});

const WAREHOUSE = { id: "warehouse-receipts", name: "Warehouse Receipts", stages: [] };

describe("Warehouse Receipts — decision 0651", () => {
  it("says a CSV registers at once until the process is set up, and lets Admin.Configure set it up", async () => {
    const calls = await openScreen(["AP.Receive", "Admin.Configure"], {
      "GET /api/goods-receipts/process": [200, { process: null }],
      "POST /api/goods-receipts/process": [201, { process: WAREHOUSE, created: true, team: { id: "ap-receiving", name: "AP Receiving", members: 3 } }],
    });
    expect(document.getElementById("receipts-process")?.textContent).toContain("Receipts loaded here register at once.");
    button("Set up Warehouse Receipts")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipts-process")?.textContent).toBe("Receipts loaded here go through Warehouse Receipts and count once registered."));
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/goods-receipts/process")?.body).toEqual({
      name: "Warehouse Receipts",
      teamName: "AP Receiving",
      stageNames: { intake: "Intake", matching: "Matching", complete: "Complete" },
    });
    expect(document.getElementById("receipts-note")?.textContent).toContain("Warehouse Receipts is set up.");
    expect(document.getElementById("receipts-team")?.textContent).toBe("Matching's tasks go to the AP Receiving team. Members: 3.");
  });

  it("offers no set-up without Admin.Configure", async () => {
    await openScreen(["AP.Receive"], { "GET /api/goods-receipts/process": [200, { process: null }] });
    expect(document.getElementById("receipts-process")?.textContent).toContain("Receipts loaded here register at once.");
    expect(button("Set up Warehouse Receipts")).toBeUndefined();
  });

  it("marks a pending receipt, says where it waits, and rejects it with a reason instead of cancelling", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/process": [200, { process: WAREHOUSE }],
      "GET /api/goods-receipts": [200, { ...LIST, receipts: [{ ...LIST.receipts[0], id: "wh-1", receiptNumber: "WH-1", status: "pending", movements: ["received"], returnReason: null }] }],
      "GET /api/goods-receipts/wh-1": [
        200,
        {
          receipt: { id: "wh-1", receiptNumber: "WH-1", receiptDate: "2026-10-05", source: "csv", createdBy: "Sam", cancelled: false, status: "pending" },
          lines: [{ lineNumber: 1, orderNumber: "PO-4501", orderLine: 2, movement: "received", quantity: 5, unitCode: "EA", returnReason: null }],
          orders: [ORDER],
          process: { instanceId: "pi", status: "in_progress", processName: "Warehouse Receipts", stageName: "Matching" },
        },
      ],
      "POST /api/goods-receipts/wh-1/reject": [200, { id: "wh-1", receiptNumber: "WH-1", status: "rejected" }],
    });
    const row = document.querySelector<HTMLElement>('[data-receipt="wh-1"]')!;
    expect(row.textContent).toContain("Pending");
    row.click();
    await vi.waitFor(() => expect(document.getElementById("receipt-pending")).not.toBeNull());
    expect(document.getElementById("receipt-pending")!.textContent).toBe("Pending at Matching in Warehouse Receipts: it counts once registered.");
    expect(button("Cancel receipt")).toBeUndefined();
    button("Reject receipt")!.click();
    (document.getElementById("receipt-rejectreason") as HTMLInputElement).value = "Not our delivery";
    document.getElementById("receipt-rejectconfirm")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipts-note")?.textContent).toContain("Receipt WH-1 rejected."));
    expect(calls.find((c) => c.path === "/api/goods-receipts/wh-1/reject")?.body).toEqual({ reason: "Not our delivery" });
  });
});

describe("working a receipt at Matching — decision 0652", () => {
  const detail = (lines: unknown[]) => ({
    receipt: { id: "wh-1", receiptNumber: "WH-1", receiptDate: "2026-10-05", source: "csv", createdBy: "Sam", cancelled: false, status: "pending" },
    lines,
    orders: [ORDER],
    process: { instanceId: "pi", status: "in_progress", processName: "Warehouse Receipts", stageName: "Matching" },
  });
  const LINES = [
    { lineNumber: 1, orderNumber: "PO-4501", orderLine: 1, movement: "received", quantity: 10, unitCode: "EA", checkReason: null, lineStatus: "active" },
    { lineNumber: 2, orderNumber: "PO-4501", orderLine: 9, movement: "received", quantity: 5, unitCode: "EA", checkReason: "order_line_not_found", lineStatus: "active" },
  ];

  it("says what each line's check found, refuses Register in words, and points a line at another order line", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1": [200, detail(LINES)],
      "POST /api/goods-receipts/wh-1/register": [409, { reason: "lines_need_attention" }],
      "POST /api/goods-receipts/wh-1/lines/2": [200, { attention: 0 }],
    });
    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-1");
    const checks = [...document.querySelector(".popout table")!.querySelectorAll("tbody tr[data-line]")].map((r) => r.children[5]?.textContent);
    expect(checks).toEqual(["Matched", "The purchase order has no such line."]);
    expect(document.getElementById("fix-change-1")).toBeNull();
    button("Register")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipt-problem")?.textContent).toBe("Some lines still need attention: fix or reject them first."));
    (document.getElementById("fix-line-2") as HTMLInputElement).value = "2";
    document.getElementById("fix-change-2")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/goods-receipts/wh-1/lines/2")).toBe(true));
    expect(calls.find((c) => c.path === "/api/goods-receipts/wh-1/lines/2")?.body).toEqual({ orderNumber: "PO-4501", orderLine: 2 });
    // The pop-out opens again, checked.
    await vi.waitFor(() => expect(calls.filter((c) => c.path === "/api/goods-receipts/wh-1").length).toBe(2));
  });

  it("rejects one line with a reason, and registers", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1": [200, detail(LINES)],
      "POST /api/goods-receipts/wh-1/lines/2": [200, { attention: 0 }],
      "POST /api/goods-receipts/wh-1/register": [200, { status: "registered", recheck: { closed: 1, stillOpen: 0 } }],
    });
    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-1");
    document.getElementById("fix-reject-2")!.click();
    expect(document.getElementById("receipt-problem")?.textContent).toContain("Why is line 2 rejected? It will never count.");
    (document.getElementById("line-rejectreason") as HTMLInputElement).value = "Not ours";
    document.getElementById("line-rejectconfirm")!.click();
    await vi.waitFor(() => expect(calls.find((c) => c.path === "/api/goods-receipts/wh-1/lines/2")?.body).toEqual({ reject: true, reason: "Not ours" }));
    await vi.waitFor(() => expect(document.getElementById("receipt-register")).not.toBeNull());
    document.getElementById("receipt-register")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipts-note")?.textContent).toContain("Receipt WH-1 registered."));
    expect(document.getElementById("receipts-note")?.textContent).toContain("Invoice tasks waiting on these goods that have now closed: 1.");
  });
});

describe("Create → Goods receipts — decision 0653", () => {
  const PREVIEW = {
    receiptsCreated: 0,
    linesLoaded: 3,
    linesSkipped: 1,
    warnings: [],
    pendingIds: [],
    dryRun: true,
    process: { id: "warehouse-receipts", name: "Warehouse Receipts" },
    refused: [{ row: 6, receiptNumber: "WH-4", reason: "quantity_invalid", message: "x" }],
    receipts: [
      { receiptId: "a", receiptNumber: "WH-1", receiptDate: "2026-10-05", existing: false, orders: ["PO-4501"], lines: 2, attention: [{ line: 2, reason: "order_line_not_found" }], skipped: 0, refused: 0 },
      { receiptId: "b", receiptNumber: "WH-2", receiptDate: "2026-10-05", existing: false, orders: ["PO-4501"], lines: 1, attention: [], skipped: 0, refused: 0 },
      { receiptId: "c", receiptNumber: "WH-3", receiptDate: "2026-10-01", existing: true, orders: [], lines: 0, attention: [], skipped: 1, refused: 0 },
      { receiptId: "d", receiptNumber: "WH-4", receiptDate: null, existing: false, orders: [], lines: 0, attention: [], skipped: 0, refused: 1 },
    ],
  };
  const LOADED = { ...PREVIEW, dryRun: undefined, receiptsCreated: 2, messageId: "MSG-RCPT-0001-0002", recheck: { closed: 1, stillOpen: 0 }, process: { ...PREVIEW.process, sent: [{ receiptId: "a", status: "pending", stage: "Matching" }, { receiptId: "b", status: "registered", stage: null }] } };

  async function openCreate(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
    const calls = await openScreen(permissions, { "GET /api/goods-receipts/process": [200, { process: WAREHOUSE }], ...routes });
    const { open } = await import("/create.js");
    await open();
    return calls;
  }

  it("offers Invoices or Goods receipts to someone who may do both, and only receipts to someone who only receives", async () => {
    await openCreate(["AP.Receive", "AP.Create"]);
    expect(document.getElementById("create-kind-invoices")?.getAttribute("aria-pressed")).toBe("true");
    document.getElementById("create-kind-receipts")!.click();
    await vi.waitFor(() => expect(document.getElementById("create-grdrop")).not.toBeNull());
    expect(document.getElementById("create-grdest")?.textContent).toBe("Warehouse Receipts");

    document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
    vi.resetModules();
    await openCreate(["AP.Receive"]);
    expect(document.getElementById("create-kind-invoices")).toBeNull();
    expect(document.getElementById("create-grdrop")).not.toBeNull();
  });

  it("previews a CSV receipt by receipt, sends it, and lists what each became with Open", async () => {
    const calls = await openCreate(["AP.Receive"], {
      "POST /api/goods-receipts/csv-preview": [200, PREVIEW],
      "POST /api/goods-receipts/csv-load": [200, LOADED],
    });
    const picker = document.getElementById("create-grfile") as HTMLInputElement;
    Object.defineProperty(picker, "files", { value: [new File(["receipt_number\nWH-1"], "wh.csv", { type: "text/csv" })] });
    picker.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.getElementById("create-grpreview")).not.toBeNull());
    const rows = [...document.querySelectorAll("#create-grpreview tbody tr")].map((r) => r.children[4]?.textContent);
    expect(rows).toEqual([
      "Lines needing attention at Matching: 1Line 2: The purchase order has no such line.",
      "Ready",
      "Already loaded, skipped",
      "Rows refused: 1",
    ]);
    expect(document.getElementById("create-grpreview")!.textContent).toContain("Row 6:");
    expect(document.getElementById("create-grsend")?.textContent).toBe("Send 2 receipts");
    // Nothing is sent by the preview.
    expect(calls.some((c) => c.path === "/api/goods-receipts/csv-load")).toBe(false);

    document.getElementById("create-grsend")!.click();
    await vi.waitFor(() => expect(document.getElementById("create-grresult")).not.toBeNull());
    expect(calls.find((c) => c.path === "/api/goods-receipts/csv-load")?.body).toBe("receipt_number\nWH-1");
    const made = [...document.querySelectorAll("#create-grresult tbody tr")].map((r) => [r.children[0].textContent, r.children[2].textContent]);
    expect(made).toEqual([
      ["WH-1", "Waiting at Matching"],
      ["WH-2", "Registered"],
    ]);
    expect(document.getElementById("create-grresult")!.textContent).toContain("Invoice tasks waiting on these goods that have now closed: 1.");
    expect(document.getElementById("create-gropen-WH-1")).not.toBeNull();
    // Decision 0655: one upload is one message of Receipts upload, named by the file.
    expect(document.getElementById("create-grmessage")?.textContent).toBe("Route monitor message: MSG-RCPT-0001-0002");
    expect(String(globalThis.fetch && (vi.mocked(globalThis.fetch).mock.calls.find((c) => String(c[0]).startsWith("/api/goods-receipts/csv-load"))?.[0]))).toBe("/api/goods-receipts/csv-load?name=wh.csv");
  });

  it("keys a receipt with today's form, says what was saved, and has a fresh form ready", async () => {
    const calls = await openCreate(["AP.Receive"], {
      "POST /api/goods-receipts": [201, { id: "gr-3", receiptNumber: "GR-1003", lines: 1, warnings: [] }],
    });
    document.getElementById("create-grtab-receipt")!.click();
    await vi.waitFor(() => expect(document.getElementById("record-panel")).not.toBeNull());
    const order = document.getElementById("record-order") as HTMLInputElement;
    order.value = "PO-4501";
    order.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(document.querySelector('#record-lines input[data-line="2"]')).not.toBeNull());
    (document.getElementById("record-number") as HTMLInputElement).value = "GR-1003";
    button("Save")!.click();
    await vi.waitFor(() => expect(document.getElementById("create-grside")?.textContent).toContain("Receipt GR-1003 recorded."));
    expect(calls.find((c) => c.method === "POST" && c.path === "/api/goods-receipts")?.body).toMatchObject({ receiptNumber: "GR-1003" });
    expect((document.getElementById("record-order") as HTMLInputElement).value).toBe("");
  });
});

describe("Waiting for the PO — decision 0654", () => {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86400000 - 3600000).toISOString();

  it("marks a receipt with lines waiting, flagged after 7 days, and filters for them", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts": [200, { ...LIST, receipts: [{ ...LIST.receipts[0], id: "wh-2", receiptNumber: "WH-2", status: "registered", waitingLines: 1, waitingSince: daysAgo(9) }] }],
    });
    const pill = [...document.querySelectorAll('[data-receipt="wh-2"] .rmpill')].find((p) => p.textContent?.startsWith("Lines waiting"))!;
    expect(pill.textContent).toBe("Lines waiting for a PO: 1 · days: 9");
    expect(pill.className).toBe("rmpill bad");
    const kind = document.getElementById("receiptkind") as HTMLSelectElement;
    expect([...kind.options].map((o) => o.value)).toContain("waiting");
    kind.value = "waiting";
    kind.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/goods-receipts" && c.method === "GET" && calls.length > 0)).toBe(true));
  });

  it("opens a registered receipt with a line held back: which lines count, how long one has waited, and its fix", async () => {
    await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-2": [
        200,
        {
          receipt: { id: "wh-2", receiptNumber: "WH-2", receiptDate: "2026-10-05", source: "csv", createdBy: "Sam", cancelled: false, status: "registered", registeredAt: "2026-10-06T10:00:00Z" },
          lines: [
            { lineNumber: 1, orderNumber: "PO-4501", orderLine: 1, movement: "received", quantity: 10, unitCode: "EA", checkReason: null, lineStatus: "active", waitingSince: null },
            { lineNumber: 2, orderNumber: "PO-800", orderLine: 1, movement: "received", quantity: 3, unitCode: "EA", checkReason: "order_not_loaded", lineStatus: "active", waitingSince: daysAgo(2) },
          ],
          orders: [ORDER],
          process: null,
        },
      ],
    });
    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-2");
    expect(document.getElementById("receipt-heldback")?.textContent).toBe("Registered. Lines held back waiting for their purchase order: 1. Each counts once its order is loaded and it matches.");
    const checks = [...document.querySelector(".popout table")!.querySelectorAll("tbody tr[data-line]")].map((r) => r.children[5]?.textContent);
    expect(checks).toEqual(["Counted", "Waiting for its PO · days: 2"]);
    expect(document.getElementById("fix-change-1")).toBeNull();
    expect(document.getElementById("fix-change-2")).not.toBeNull();
    expect(button("Register")).toBeUndefined();
  });
});

describe("claim before acting, and correcting the unit and quantity — decision 0657", () => {
  const detail = (task: unknown, lines: unknown[]) => ({
    receipt: { id: "wh-1", receiptNumber: "WH-1", receiptDate: "2026-10-05", source: "csv", createdBy: "Sam", cancelled: false, status: "pending" },
    lines,
    orders: [ORDER],
    process: { instanceId: "pi", status: "in_progress", processName: "Warehouse Receipts", stageName: "Matching" },
    task,
  });
  const BOX = { lineNumber: 1, orderNumber: "PO-4501", orderLine: 2, movement: "received", quantity: 2, unitCode: "BOX", checkReason: "unit_mismatch", lineStatus: "active", correction: null };
  const NOLINE = { lineNumber: 2, orderNumber: "PO-4501", orderLine: 9, movement: "received", quantity: 5, unitCode: "EA", checkReason: "order_line_not_found", lineStatus: "active", correction: null };

  it("shows nobody holds the task, offers Claim, and hides fixing, Register and Reject until it is claimed", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1": [200, detail({ id: "t-1", claimedBy: null, mine: false, canClaim: true, canRelease: false }, [BOX, NOLINE])],
      "POST /api/tasks/t-1/claim": [200, { taskId: "t-1" }],
    });
    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-1");
    expect(document.getElementById("receipt-task")?.textContent).toContain("Nobody has claimed this receipt's task.");
    // Decision 0659: Claim with the other actions, top right, just left of Close, with its icon.
    const actions = [...document.querySelectorAll(".popout .cardhead .statebuttons .actionlink")];
    expect(actions.map((a) => a.textContent)).toEqual(["Claim", "Close"]);
    expect(document.getElementById("receipt-claim")?.querySelector("svg")).not.toBeNull();
    expect(document.getElementById("fix-change-1")).toBeNull();
    expect(button("Register")).toBeUndefined();
    expect(button("Reject receipt")).toBeUndefined();
    // The order line is shown, so the unit to correct to is plain.
    const orderCells = [...document.querySelectorAll(".popout [data-orderline]")].map((c) => c.textContent);
    expect(orderCells).toEqual(["Bubble wrap roll · ordered 50 EA", "Not a line on this order"]);
    document.getElementById("receipt-claim")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/tasks/t-1/claim" && c.method === "POST")).toBe(true));
    await vi.waitFor(() => expect(calls.filter((c) => c.path === "/api/goods-receipts/wh-1").length).toBe(2));
  });

  it("says who holds it when someone else does, and offers nothing to act with", async () => {
    await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1": [200, detail({ id: "t-1", claimedBy: "Ann", mine: false, canClaim: false, canRelease: false }, [BOX])],
    });
    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-1");
    expect(document.getElementById("receipt-task")?.textContent).toBe("Ann has claimed this receipt's task. Only they can work on it.");
    expect(document.getElementById("receipt-claim")).toBeNull();
    expect(document.getElementById("fix-change-1")).toBeNull();
    expect(button("Register")).toBeUndefined();
  });

  it("for its holder: Release, and 2 BOX corrected to 24 EA sends only the unit and quantity; a corrected line says what was sent", async () => {
    const calls = await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1": [200, detail({ id: "t-1", claimedBy: "Sam", mine: true, canClaim: false, canRelease: true }, [BOX])],
      "POST /api/goods-receipts/wh-1/lines/1": [200, { attention: 0 }],
    });
    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-1");
    expect(document.getElementById("receipt-task")?.textContent).toContain("You have claimed this receipt's task.");
    expect(document.getElementById("receipt-release")).not.toBeNull();
    expect([...document.querySelectorAll(".popout .cardhead .statebuttons .actionlink")].map((a) => a.textContent)).toEqual(["Register", "Reject receipt", "Release", "Close"]);
    expect(button("Register")).not.toBeUndefined();
    expect((document.getElementById("fix-unit-1") as HTMLInputElement).value).toBe("BOX");
    (document.getElementById("fix-unit-1") as HTMLInputElement).value = "ea";
    (document.getElementById("fix-qty-1") as HTMLInputElement).value = "24";
    document.getElementById("fix-change-1")!.click();
    await vi.waitFor(() => expect(calls.find((c) => c.path === "/api/goods-receipts/wh-1/lines/1")?.body).toEqual({ unitCode: "ea", quantity: "24" }));

    document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
    vi.resetModules();
    await openScreen(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1": [
        200,
        detail({ id: "t-1", claimedBy: "Sam", mine: true, canClaim: false, canRelease: true }, [
          { ...BOX, quantity: 24, unitCode: "EA", checkReason: null, correction: { unitCode: "BOX", quantity: 2, by: "Sam", at: "2026-10-07T09:00:00Z" } },
        ]),
      ],
    });
    const again = await import("/goods-receipts.js");
    await again.openReceipt("wh-1");
    expect(document.querySelector(".popout [data-corrected]")?.textContent).toBe("Was 2 BOX, corrected by Sam");
  });
});

