import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **A purchase order's Timeline and Chat, and its Attachments — decision
 * 0754**, on the order's page: its history in words, what each change did
 * line by line, the conversation, and the three tabs on the right. The
 * real English strings, read from every strings migration.
 */

const migrations = import.meta.glob("../../vf-licence/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
const strings: Record<string, string> = {};
for (const file of Object.keys(migrations).sort()) {
  for (const m of migrations[file].matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

const DETAIL = {
  order: { order_number: "PO-9", issue_date: "2026-10-01", currency: "GBP", seller_party_id: "Kingsway", org_unit_name: "Acme UK", status: "active", effective_status: "active", payable_amount: 1610 },
  lines: [{ line_number: 1, item_name: "Office chair", quantity: 12, unit_code: "EA", price_amount: 125, line_extension_amount: 1500 }],
};
const at = (d: number) => `2026-10-0${d}T09:00:00.000Z`;
const TIMELINE = {
  orderNumber: "PO-9",
  canManage: true,
  collaborators: [],
  items: [
    { kind: "order_arrived", at: at(1), by: "erp@acme.example", detail: { orderKind: "order", source: "Orders by email", sender: "erp@acme.example", lines: 2, uploaded: false } },
    { kind: "order_released", at: at(1), by: null, detail: { orderKind: "order", first: true, override: false } },
    { kind: "order_arrived", at: at(3), by: "erp@acme.example", detail: { orderKind: "change", source: "Orders by email", sender: "erp@acme.example", lines: 2, uploaded: false, changeReference: "CHG-2" } },
    { kind: "stopped", at: at(3), by: null, detail: { stage: "Checking", team: "Purchasing" } },
    { kind: "claimed", at: at(3), by: "Pat Lee" },
    {
      kind: "order_released",
      at: at(4),
      by: "Pat Lee",
      detail: {
        orderKind: "change",
        override: true,
        changes: {
          header: [{ field: "payable", from: 1450, to: 1610 }],
          lines: [
            { line: 1, change: "changed", item: "Office chair", fields: [{ field: "quantity", from: 10, to: 12 }, { field: "amount", from: 1250, to: 1500 }] },
            { line: 2, change: "removed", item: "Footrest", fields: [] },
            { line: 3, change: "added", item: "Desk lamp", fields: [{ field: "item", from: null, to: "Desk lamp" }, { field: "quantity", from: null, to: 2 }, { field: "unit", from: null, to: "EA" }, { field: "price", from: null, to: 55 }] },
          ],
          receiptWarnings: [{ orderNumber: "PO-9", line: 2, kind: "line_removed", net: 8 }],
        },
      },
    },
    { kind: "order_held", at: at(5), by: "Pat Lee", detail: { from: "active", reason: "price dispute" } },
    { kind: "order_hold_released", at: at(6), by: "Pat Lee", detail: { from: "on_hold" } },
    { kind: "goods_received", at: at(7), by: "Wes", detail: { receiptNumber: "GR-1", quantity: 18, lines: [1, 2], pending: false, cancelled: false } },
    { kind: "goods_returned", at: at(7), by: "Wes", detail: { receiptNumber: "GR-1", quantity: 2, lines: [1], pending: false, cancelled: false } },
    { kind: "order_invoiced", at: at(8), by: null, detail: { number: "INV-1", currency: "GBP", total: 1450 } },
    { kind: "supplier_opened", at: at(8), by: null },
    { kind: "supplier_asked", at: at(8), by: "Pat Lee" },
    { kind: "comment", at: at(9), by: "Pat Lee", body: "Did the lamps come?", mine: true },
  ],
};

function stub(routes: Record<string, [number, unknown]> = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path, body: init?.body ? JSON.parse(String(init.body)) : null });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      const own = routes[`${method} ${path}`];
      if (own) return reply(...own);
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/whoami") return reply(200, { id: "u-pat", name: "Pat Lee", permissions: ["AP.Purchasing"] });
      if (path === "/api/purchase-orders/PO-9") return reply(200, DETAIL);
      if (path === "/api/purchase-orders/PO-9/timeline") return reply(200, TIMELINE);
      if (path === "/api/purchase-orders/PO-9/attachments") return reply(200, { messages: [], files: [] });
      return reply(404, {});
    })
  );
  return calls;
}

async function openOrder(routes: Record<string, [number, unknown]> = {}) {
  const calls = stub(routes);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { openPurchaseOrder } = await import("/purchase-orders.js");
  await openPurchaseOrder({ order_number: "PO-9" });
  await vi.waitFor(() => expect(document.querySelectorAll("#po-timeline .activityfeed > *").length).toBeGreaterThan(1));
  return calls;
}
const cards = () => [...document.querySelectorAll("#po-timeline .activityfeed > *")];
const words = () => cards().map((n) => n.querySelector(".activitymsg, .activitybody")?.textContent);

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the order's panel — decision 0754", () => {
  it("has Attachments, Timeline / Chat and Supplier, as a receipt's, Timeline / Chat first", async () => {
    await openOrder();
    const tabs = [...document.querySelectorAll(".poview .receiptside .doctabs .doctab")];
    expect(tabs.map((b) => b.textContent)).toEqual(["Attachments", `Timeline / Chat${TIMELINE.items.length}`, "Supplier"]);
    expect(document.getElementById("po-tab-timeline")?.className).toBe("doctab on");
    expect(document.getElementById("po-attachments")?.hidden).toBe(true);
    expect(document.getElementById("po-supplier-none")?.hidden).toBe(true);
    // Attachments load when first opened, from the order's own address.
    const calls = (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0]));
    expect(calls).not.toContain("/api/purchase-orders/PO-9/attachments");
    (document.getElementById("po-tab-attachments") as HTMLElement).click();
    await vi.waitFor(() => expect(document.getElementById("po-attachments")?.textContent).toContain("Nothing was received with this order"));
  });
});

describe("the order's Timeline — decision 0754", () => {
  it("says its history in words, oldest first, with the conversation among it", async () => {
    await openOrder();
    expect(words()).toEqual([
      "The order came in by Orders by email from erp@acme.example: 2 lines.",
      "Released to Purchase Orders.",
      "A change came in by Orders by email from erp@acme.example: 2 lines.",
      "Stopped at Checking: a task for Purchasing to check its lines.",
      "Pat Lee claimed the task.",
      "Pat Lee released the change.",
      "Pat Lee put it on hold: price dispute",
      "Pat Lee released the hold.",
      "GR-1: 18 received on line 1, 2.",
      "GR-1: 2 returned on line 1.",
      "Invoice INV-1 names it: 1,450 GBP.",
      "The supplier first opened it in the supplier network.",
      "Pat Lee asked the supplier. The words are on the Supplier tab.",
      "Did the lamps come?",
    ]);
    expect(cards().map((c) => c.querySelector(".tllabel")?.textContent ?? null)).toEqual([
      "Received",
      "Released",
      "Received",
      "Needs checking",
      "Claimed",
      "Changed",
      "On hold",
      "Hold released",
      "Goods arrived",
      "Returned",
      "Invoiced",
      "Seen by supplier",
      "Asked supplier",
      null,
    ]);
  });

  it("says what a change did beneath it, line by line, from what to what", async () => {
    await openOrder();
    const subs = (i: number) => [...cards()[i].querySelectorAll(".activityactioncomment")].map((n) => n.textContent);
    expect(subs(2)).toEqual(["Change reference: CHG-2"]);
    expect(subs(5)).toEqual([
      "Released although Checking still found something.",
      "Payable: 1,450 → 1,610",
      "Line 1 (Office chair): Quantity: 10 → 12; Amount: 1,250 → 1,500",
      "Line 2 removed: Footrest",
      "Line 3 added: Desk lamp, 2 EA at 55",
      "PO-9 line 2 is no longer on the order, but 8 was received against it.",
    ]);
  });

  it("posts at the order's own address", async () => {
    const calls = await openOrder({ "POST /api/purchase-orders/PO-9/comments": [201, { id: "c-1", notified: { sent: 1, failed: 0, emailReady: true } }] });
    (document.getElementById("po-chat-input") as HTMLTextAreaElement).value = "Lamps?";
    document.getElementById("po-chat-post")!.click();
    await vi.waitFor(() => expect(document.getElementById("po-chat-sent")?.textContent).toBe("Emailed: 1."));
    expect(calls.find((c) => c.method === "POST")).toEqual({ method: "POST", path: "/api/purchase-orders/PO-9/comments", body: { body: "Lamps?" } });
  });

  it("someone who could not open an order is shown but not offered, saying what they need", async () => {
    await openOrder({ "GET /api/purchase-orders/PO-9/people": [200, { users: [{ id: "u-nia", name: "Nia", email: "nia@x", canSee: false }], teams: [] }] });
    document.getElementById("po-addpeople")!.click();
    const search = document.getElementById("po-people-search") as HTMLInputElement;
    search.value = "ni";
    search.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(document.querySelector("[data-user='u-nia']")).not.toBeNull());
    expect((document.querySelector("[data-user='u-nia']") as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector("[data-user='u-nia']")?.textContent).toContain("Needs AP.Validate, AP.Purchasing, AP.Receive or Warehouse.Collaborate");
  });
});
