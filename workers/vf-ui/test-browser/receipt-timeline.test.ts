import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import receiptsSql from "../../vf-licence/migrations/0288_goods_receipts_strings.sql?raw";
import matchingSql from "../../vf-licence/migrations/0294_receipt_matching_strings.sql?raw";
import claimSql from "../../vf-licence/migrations/0299_receipt_claim_and_correct_strings.sql?raw";
import timelineSql from "../../vf-licence/migrations/0300_receipt_timeline_strings.sql?raw";

/**
 * **A goods receipt's Timeline and Chat — decision 0658**, in the
 * receipt's pop-out: what happened in words, the conversation, adding
 * a person or a team, and the Warehouse's own view of the receipts it
 * was added to. The real English strings, read from their migrations.
 */

const strings: Record<string, string> = { "action.close": "Close", "nav.goodsreceipts": "Goods Receipts" };
for (const sql of [receiptsSql, matchingSql, claimSql, timelineSql]) {
  for (const m of sql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");
}

const ORDER = {
  orderNumber: "PO-300",
  status: "active",
  currency: "GBP",
  supplier: { id: "nw", name: "Northwind" },
  receiptingRequired: true,
  tolerancePct: 0,
  state: "partially_received",
  creditExpected: false,
  lines: [{ lineNumber: 1, itemName: "Bubble wrap", unitCode: "EA", onOrder: true, ordered: 50, received: 0, returned: 0, net: 0, outstanding: 50, invoiced: 0, state: "not_received", creditExpected: 0 }],
};
const DETAIL = {
  receipt: { id: "wh-1", receiptNumber: "WH-1", receiptDate: "2026-10-06", source: "csv", createdBy: "Sam", cancelled: false, status: "pending" },
  lines: [{ lineNumber: 1, orderNumber: "PO-300", orderLine: 1, movement: "received", quantity: 2, unitCode: "BOX", checkReason: "unit_mismatch", lineStatus: "active", correction: null }],
  orders: [ORDER],
  process: { instanceId: "pi", status: "in_progress", processName: "Warehouse Receipts", stageName: "Matching" },
  task: { id: "t-1", claimedBy: "Sam", mine: true, canClaim: false, canRelease: true },
};
const at = (m: number) => `2026-10-07T09:${String(m).padStart(2, "0")}:00.000Z`;
const TIMELINE = {
  receiptNumber: "WH-1",
  canManage: true,
  collaborators: [{ id: "c-1", kind: "team", teamId: "team-wh", name: "Warehouse", members: 3, addedBy: "Sam" }],
  items: [
    { kind: "received", at: at(0), by: "Sam", detail: { source: "csv", messageId: "MSG-AAAA-BBBB-CCCC", sourceName: "Receipts upload", lines: 1 } },
    { kind: "stopped", at: at(1), by: null, detail: { stage: "Matching", team: "AP Receiving" } },
    { kind: "claimed", at: at(2), by: "Sam" },
    { kind: "collaborator_added", at: at(3), by: "Sam", detail: { kind: "team", name: "Warehouse" } },
    { kind: "comment", at: at(4), by: "Sam", body: "Is this 2 boxes of 12?", mine: true },
    { kind: "comment", at: at(5), by: "Wendy", body: "Yes, 24 each.", mine: false },
    { kind: "line_corrected", at: at(6), by: "Sam", lineNumber: 1, detail: { from: { quantity: 2, unit: "BOX" }, to: { quantity: 24, unit: "EA" } } },
    { kind: "registered", at: at(7), by: "Sam", detail: { how: "register", partial: false } },
  ],
};

interface Call {
  method: string;
  path: string;
  body: unknown;
  query: string;
}

function stub(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const [path, query = ""] = String(url).split("?");
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, path, body, query });
      const reply = (status: number, b: unknown) => ({ ok: status < 400, status, json: async () => b }) as Response;
      const own = routes[`${method} ${path}`];
      if (own) return reply(...own);
      if (path === "/api/ui-strings") return reply(200, { locale: "en", strings });
      if (path === "/api/whoami") return reply(200, { id: "u-sam", name: "Sam", permissions });
      if (path === "/api/tasks") return reply(200, { tasks: [], total: 0, counts: {}, page: 1, pageSize: 25 });
      if (path === "/api/goods-receipts/wh-1") return reply(200, DETAIL);
      if (path === "/api/goods-receipts/wh-1/timeline") return reply(200, TIMELINE);
      return reply(404, {});
    })
  );
  return calls;
}

async function start(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls = stub(permissions, routes);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const tasks = await import("/tasks.js");
  await tasks.start();
  return calls;
}
async function openPopout(permissions: string[], routes: Record<string, [number, unknown]> = {}) {
  const calls = await start(permissions, routes);
  const { openReceipt } = await import("/goods-receipts.js");
  await openReceipt("wh-1");
  await vi.waitFor(() => expect(document.querySelectorAll("#receipt-timeline .activityfeed > *").length).toBeGreaterThan(1));
  return calls;
}
const timelineText = () => [...document.querySelectorAll("#receipt-timeline .activityfeed > *")].map((n) => n.querySelector(".activitymsg, .activitybody")?.textContent);

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the receipt's Timeline — decision 0658", () => {
  it("says what happened in words, oldest first, with the conversation among it", async () => {
    await openPopout(["AP.Receive"]);
    expect(document.querySelector("#receipt-timeline h4")?.textContent).toBe("Timeline and conversation");
    // On the right of a widened pop-out, beside the receipt, as the invoice viewer has it.
    expect(document.querySelector(".popout.receiptpop > .receiptside > #receipt-timeline")).not.toBeNull();
    expect(document.querySelector(".popout.receiptpop > .receiptmain #receipt-timeline")).toBeNull();
    expect(document.querySelector(".popout.receiptpop > .receiptmain h3")?.textContent).toBe("WH-1");
    expect(timelineText()).toEqual([
      "It came in by Receipts upload, message MSG-AAAA-BBBB-CCCC, from Sam: 1 lines.",
      "Stopped at Matching: a task for AP Receiving to check its lines.",
      "Sam claimed the task.",
      "Sam added the team Warehouse to the conversation.",
      "Is this 2 boxes of 12?",
      "Yes, 24 each.",
      "Sam corrected line 1 from 2 BOX to 24 EA.",
      "Sam registered it.",
    ]);
    const comments = [...document.querySelectorAll("#receipt-timeline [data-kind='comment']")];
    expect(comments.map((c) => c.classList.contains("mine"))).toEqual([true, false]);
    expect(document.querySelector("[data-collaborator='c-1']")?.textContent).toContain("Warehouse (team, 3)");
  });

  it("posts a message and says how many were emailed", async () => {
    const calls = await openPopout(["AP.Receive"], { "POST /api/goods-receipts/wh-1/comments": [201, { id: "m-1", notified: { sent: 2, failed: 0, emailReady: true } }] });
    (document.getElementById("receipt-chat-input") as HTMLTextAreaElement).value = "  Can you check the cartons?  ";
    document.getElementById("receipt-chat-post")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipt-chat-sent")?.textContent).toBe("Emailed: 2."));
    expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/comments"))?.body).toEqual({ body: "Can you check the cartons?" });
    expect((document.getElementById("receipt-chat-input") as HTMLTextAreaElement).value).toBe("");
    expect(calls.filter((c) => c.path === "/api/goods-receipts/wh-1/timeline")).toHaveLength(2);
  });

  it("finds people and teams to add: a team is added, someone who could not open it is shown but not offered", async () => {
    const calls = await openPopout(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1/people": [200, { users: [{ id: "u-wendy", name: "Wendy", email: "w@x.com", canSee: true }, { id: "u-will", name: "Will", email: "will@x.com", canSee: false }], teams: [{ id: "team-wh2", name: "Warehouse North", members: 4 }] }],
      "POST /api/goods-receipts/wh-1/collaborators": [201, { added: true, notified: { sent: 3, failed: 0, emailReady: true }, collaborators: [] }],
    });
    document.getElementById("receipt-addpeople")!.click();
    const search = document.getElementById("receipt-people-search") as HTMLInputElement;
    search.value = "wa";
    search.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(document.querySelector("[data-team='team-wh2']")).not.toBeNull());
    expect(calls.find((c) => c.path.endsWith("/people"))?.query).toBe("q=wa");
    const will = document.querySelector<HTMLButtonElement>("[data-user='u-will']")!;
    expect(will.disabled).toBe(true);
    expect(will.textContent).toContain("Needs Warehouse.Collaborate to open receipts");
    expect(document.querySelector<HTMLButtonElement>("[data-user='u-wendy']")!.disabled).toBe(false);
    document.querySelector<HTMLButtonElement>("[data-team='team-wh2']")!.click();
    await vi.waitFor(() => expect(calls.find((c) => c.method === "POST" && c.path.endsWith("/collaborators"))?.body).toEqual({ teamId: "team-wh2" }));
    await vi.waitFor(() => expect(document.getElementById("receipt-chat-sent")?.textContent).toBe("Emailed: 3."));
  });

  it("says in words why someone could not be added, and removes a team", async () => {
    const calls = await openPopout(["AP.Receive"], {
      "GET /api/goods-receipts/wh-1/people": [200, { users: [{ id: "u-pete", name: "Pete", email: "p@x.com", canSee: true }], teams: [] }],
      "POST /api/goods-receipts/wh-1/collaborators": [422, { reason: "cannot_see", name: "Pete" }],
      "DELETE /api/goods-receipts/wh-1/collaborators/c-1": [200, { removed: true, collaborators: [] }],
    });
    document.getElementById("receipt-addpeople")!.click();
    const search = document.getElementById("receipt-people-search") as HTMLInputElement;
    search.value = "pe";
    search.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(document.querySelector("[data-user='u-pete']")).not.toBeNull());
    document.querySelector<HTMLButtonElement>("[data-user='u-pete']")!.click();
    await vi.waitFor(() => expect(document.getElementById("receipt-timeline-problem")?.textContent).toBe("Pete could not open this receipt. Give them Warehouse.Collaborate first."));
    document.querySelector<HTMLButtonElement>("[data-collaborator='c-1'] .collabchipremove")!.click();
    await vi.waitFor(() => expect(calls.some((c) => c.method === "DELETE" && c.path === "/api/goods-receipts/wh-1/collaborators/c-1")).toBe(true));
  });
});

describe("the Warehouse's view — decision 0658", () => {
  it("lands on Goods Receipts showing only the receipts it was added to, and opens one to read and write but not to manage", async () => {
    const calls = await start(["Warehouse.Collaborate"], {
      "GET /api/goods-receipts": [200, { receipts: [{ id: "wh-1", receiptNumber: "WH-1", receiptDate: "2026-10-06", orders: ["PO-300"], suppliers: ["Northwind"], lines: 1, movements: ["received"], status: "pending", source: "csv", createdBy: "Sam" }], total: 1, page: 1, pageSize: 50 }],
      "GET /api/goods-receipts/wh-1/timeline": [200, { ...TIMELINE, canManage: false }],
    });
    await vi.waitFor(() => expect(document.getElementById("receipts-conversations")).not.toBeNull());
    expect([...document.querySelectorAll(".navitem")].some((n) => n.textContent === "Goods Receipts")).toBe(true);
    expect(document.body.textContent).toContain("Receipts you are in a conversation about");
    expect(document.body.textContent).toContain("WH-1");
    expect(calls.some((c) => c.path === "/api/goods-receipts/status-counts" || c.path === "/api/goods-receipts/process")).toBe(false);

    const { openReceipt } = await import("/goods-receipts.js");
    await openReceipt("wh-1");
    await vi.waitFor(() => expect(document.querySelectorAll("#receipt-timeline .activityfeed > *").length).toBeGreaterThan(1));
    expect(document.getElementById("receipt-addpeople")).toBeNull();
    expect(document.querySelector(".collabchipremove")).toBeNull();
    expect(document.getElementById("receipt-chat-input")).not.toBeNull();
    expect(document.getElementById("receipt-register")).toBeNull();
  });

  it("opens the receipt from the email's link", async () => {
    history.replaceState(null, "", "/?receipt=wh-1");
    const calls = await start(["Warehouse.Collaborate"], { "GET /api/goods-receipts": [200, { receipts: [], total: 0, page: 1, pageSize: 50 }] });
    await vi.waitFor(() => expect(calls.some((c) => c.path === "/api/goods-receipts/wh-1")).toBe(true));
    await vi.waitFor(() => expect(document.getElementById("receipt-timeline")).not.toBeNull());
    expect(location.search).toBe("");
  });
});
