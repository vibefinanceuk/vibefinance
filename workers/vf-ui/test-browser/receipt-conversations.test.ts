import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import receiptsSql from "../../vf-licence/migrations/0288_goods_receipts_strings.sql?raw";
import timelineSql from "../../vf-licence/migrations/0300_receipt_timeline_strings.sql?raw";
import conversationsSql from "../../vf-licence/migrations/0302_receipt_conversations_strings.sql?raw";

/**
 * **Conversations on Tasks — decision 0660**, as agreed with Dan against
 * a mock-up: receipts a person was added to, or with new messages, at the
 * top of Tasks, with Open and Done, and a count on the menu. The real
 * English strings, read from their migrations.
 */

const strings: Record<string, string> = { "action.close": "Close", "nav.tasks": "Tasks", "nav.goodsreceipts": "Goods Receipts" };
for (const sql of [receiptsSql, timelineSql, conversationsSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

const ADDED = {
  receiptId: "wh-1",
  receiptNumber: "WH-S-1002",
  organisation: "Acme UK Ltd",
  supplier: "Northwind Packaging",
  orders: ["SAMPLE-PO-7001"],
  added: { by: "Sam Ward", team: "Warehouse", at: "2026-10-07T08:41:00.000Z" },
  newMessages: 1,
  latest: { by: "Sam Ward", body: "How many cartons per box?", at: "2026-10-07T08:42:00.000Z" },
  lastAt: "2026-10-07T08:42:00.000Z",
};
const NEW = {
  receiptId: "wh-2",
  receiptNumber: "WH-S-1003",
  organisation: "Acme UK Ltd",
  supplier: "Northwind Packaging",
  orders: ["SAMPLE-PO-7002", "SAMPLE-PO-7003"],
  added: null,
  newMessages: 2,
  latest: { by: "Sam Ward", body: "Has PO-7003 arrived on site yet?", at: "2026-10-07T09:12:00.000Z" },
  lastAt: "2026-10-07T09:12:00.000Z",
};

interface Call {
  method: string;
  path: string;
}

function stub(permissions: string[], conversations: () => unknown[]) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const method = init?.method ?? "GET";
      calls.push({ method, path });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/whoami") return reply(200, { id: "u-wendy", name: "Wendy", permissions });
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      if (path === "/api/goods-receipts") return reply(200, { receipts: [], total: 0, page: 1, pageSize: 50 });
      if (path === "/api/receipt-conversations") return reply(200, { conversations: conversations() });
      if (path.startsWith("/api/receipt-conversations/") && method === "POST") return reply(200, { done: true });
      return reply(404, {});
    })
  );
  return calls;
}

async function start(permissions: string[], conversations: () => unknown[]) {
  const calls = stub(permissions, conversations);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const tasks = await import("/tasks.js");
  await tasks.start();
  return calls;
}
const badge = (screen: string) => document.querySelector(`.navitem[data-screen="${screen}"] .navbadge`)?.textContent ?? null;

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("Conversations on Tasks — decision 0660", () => {
  it("lists what is new: added to a chat, or new messages, with who, when, the supplier, the orders and the latest message; the menu counts them", async () => {
    await start(["AP.TaskView", "AP.Receive"], () => [NEW, ADDED]);
    await vi.waitFor(() => expect(document.querySelectorAll(".receiptconv").length).toBe(2));
    const section = document.getElementById("receiptconversations")!;
    expect(section.hidden).toBe(false);
    expect(section.querySelector("h3")?.textContent).toBe("Conversations");
    const [first, second] = [...section.querySelectorAll(".receiptconv")];
    expect(first.querySelector(".agentnotename")?.textContent).toBe("Goods receipt WH-S-1003 · Acme UK Ltd");
    expect([...first.querySelectorAll(".agentnotetag")].map((p) => p.textContent)).toEqual(["New messages", "New messages: 2"]);
    expect(first.querySelector(".agentnotewhy")?.textContent).toBe("Sam Ward: “Has PO-7003 arrived on site yet?”");
    expect(first.querySelector(".muted")?.textContent).toContain("Northwind Packaging · PO SAMPLE-PO-7002, SAMPLE-PO-7003");
    expect([...second.querySelectorAll(".agentnotetag")].map((p) => p.textContent)).toEqual(["Added to chat", "New messages: 1"]);
    expect(second.querySelector(".muted")?.textContent).toContain("Sam Ward added you (through the Warehouse team)");
    expect(badge("tasks")).toBe("2");
  });

  it("keeps to about four rows high and scrolls past that, so the tasks below stay in view", async () => {
    const css = (await import("virtual:stylesheets")).default as Record<string, string>;
    const style = document.createElement("style");
    style.textContent = `${css["tokens.css"] ?? ""}\n${css["app.css"]}`;
    document.head.append(style);
    const many = Array.from({ length: 7 }, (_, i) => ({ ...NEW, receiptId: `wh-${i}`, receiptNumber: `WH-${i}` }));
    await start(["AP.TaskView", "AP.Receive"], () => many);
    await vi.waitFor(() => expect(document.querySelectorAll(".receiptconv").length).toBe(7));
    const list = document.getElementById("receiptconvlist")!;
    expect(getComputedStyle(list).overflowY).toBe("auto");
    // And a gap before the task search below it (Dan: "they are touching").
    expect(getComputedStyle(document.getElementById("receiptconversations")!).marginBottom).toBe("16px");
    // 23rem: about four rows of two or three lines each (the screenshots measured them).
    expect(getComputedStyle(list).maxHeight).toBe(`${23 * parseFloat(getComputedStyle(document.documentElement).fontSize)}px`);
  });

  it("Done takes one off and the count with it; Open catches up and opens the receipt", async () => {
    let list = [NEW, ADDED];
    const calls = await start(["AP.TaskView", "AP.Receive"], () => list);
    await vi.waitFor(() => expect(document.querySelectorAll(".receiptconv").length).toBe(2));
    list = [ADDED];
    [...document.querySelectorAll<HTMLButtonElement>('.receiptconv[data-receipt="wh-2"] .actionlink')].find((b) => b.textContent === "Done")!.click();
    await vi.waitFor(() => expect(document.querySelectorAll(".receiptconv").length).toBe(1));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/receipt-conversations/wh-2/done")).toBe(true);
    expect(badge("tasks")).toBe("1");

    [...document.querySelectorAll<HTMLButtonElement>('.receiptconv[data-receipt="wh-1"] .actionlink')].find((b) => b.textContent === "Open")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/api/receipt-conversations/wh-1/done")).toBe(true));
    await vi.waitFor(() => expect(calls.some((c) => c.method === "GET" && c.path === "/api/goods-receipts/wh-1")).toBe(true));
  });

  it("shows nothing, and no count, when nothing is new", async () => {
    await start(["AP.TaskView"], () => []);
    await vi.waitFor(() => expect(document.getElementById("receiptconversations")).not.toBeNull());
    await new Promise((r) => setTimeout(r, 20));
    expect(document.getElementById("receiptconversations")?.hidden).toBe(true);
    expect(badge("tasks")).toBeNull();
  });

  it("for the Warehouse, at the top of Goods Receipts, with the count there", async () => {
    await start(["Warehouse.Collaborate"], () => [ADDED]);
    await vi.waitFor(() => expect(document.querySelectorAll("#receiptconversations .receiptconv").length).toBe(1));
    expect(badge("goodsreceipts")).toBe("1");
  });
});
