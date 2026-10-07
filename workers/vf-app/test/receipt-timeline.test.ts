import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleGetGoodsReceipt, handleListGoodsReceipts, handleLoadGoodsReceiptsCsv } from "../src/goods-receipts.js";
import {
  handleFixReceiptLine,
  handleRegisterGoodsReceipt,
  handleSetUpWarehouseProcess,
  releaseWaitingReceipts,
  sendReceiptsThroughProcess,
} from "../src/warehouse-receipts.js";
import {
  handleAddReceiptCollaborator,
  handleGetReceiptTimeline,
  handlePostReceiptComment,
  handleRemoveReceiptCollaborator,
  handleSearchReceiptPeople,
  receiptEmail,
  type TimelineDeps,
  type TimelineItem,
} from "../src/receipt-timeline.js";
import { handleClaimTask, handleReleaseTask } from "../src/task-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import type { SendEmailInput } from "../src/resend-client.js";

/**
 * **A goods receipt's Timeline and Chat — decision 0658.**
 *
 * PO-300 (Northwind): line 1, 50 EA of Bubble wrap at £10. Sam holds
 * AP.Receive (and is in AP Receiving once the process is set up); Vic
 * holds AP.Validate; Wendy holds Warehouse.Collaborate, in German; Will
 * is in the Warehouse team with no permission at all.
 */

let sent: SendEmailInput[];
const deps = (): TimelineDeps => ({
  email: { apiKey: "k", from: "ap@acme.test" },
  appUrl: "https://app.acme.test",
  send: async (_k, input) => (sent.push(input), { ok: true, messageId: "m" }),
});

beforeEach(async () => {
  sent = [];
  await applyTestSchema();
  await env.DB.prepare(
    "INSERT INTO org_users (id, email, name, locale) VALUES ('u-sam', 's@x.com', 'Sam', 'en'), ('u-vic', 'v@x.com', 'Vic', 'en'), ('u-wendy', 'w@x.com', 'Wendy', 'de'), ('u-will', 'will@x.com', 'Will', 'en'), ('u-pete', 'p@x.com', 'Pete', 'en')"
  ).run();
  await env.DB.prepare(
    `INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Receive"]'), ('val', 'val', '["AP.Validate"]'), ('wh', 'wh', '["Warehouse.Collaborate"]')`
  ).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-sam', 'r'), ('u-vic', 'val'), ('u-wendy', 'wh')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-wh', 'Warehouse', 'u1')").run();
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('team-wh', 'u-wendy'), ('team-wh', 'u-will')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', 'three_way', datetime('now'))").run();
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, issue_date, currency, seller_party_id, payable_amount, status) VALUES ('po', 'PO-300', '2026-09-01', 'GBP', 'GB111', 500, 'active')").run();
  await env.DB.prepare(
    "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES ('l1', 'po', 1, 50, 'EA', 500, 'Bubble wrap', 10)"
  ).run();
  await handleSetUpWarehouseProcess(env.DB, {});
});

const CSV = (rows: string[]) => ["receipt_number,receipt_line,receipt_date,order_number,order_line,quantity,unit", ...rows].join("\n");
async function loadThrough(rows: string[]) {
  const loaded = await handleLoadGoodsReceiptsCsv(env.DB, "u-sam", CSV(rows), new Date(), { pending: true });
  await sendReceiptsThroughProcess(env.DB, (loaded.body as { pendingIds: string[] }).pendingIds);
}
const idOf = async (n: string) => (await env.DB.prepare("SELECT id FROM goods_receipts WHERE receipt_number = ?").bind(n).first<{ id: string }>())!.id;
const taskOf = async () => (await env.DB.prepare("SELECT id FROM tasks WHERE status = 'open'").first<{ id: string }>())!.id;
const timeline = async (id: string, who = "u-sam") => (await handleGetReceiptTimeline(env.DB, who, id)).body as { items: TimelineItem[]; collaborators: Record<string, unknown>[]; canManage: boolean };
const kinds = (items: TimelineItem[]) => items.map((i) => i.kind);

describe("the Timeline — decision 0658", () => {
  it("logs a receipt from arriving to registered: stopped at Matching, claimed, each line changed, and who registered it", async () => {
    await loadThrough(["WH-1,1,2026-10-06,PO-300,1,10,EA", "WH-1,2,2026-10-06,PO-300,9,5,EA", "WH-1,3,2026-10-06,PO-300,1,2,BOX"]);
    const id = await idOf("WH-1");
    const task = await taskOf();
    expect((await handleClaimTask(env.DB, task, "u-sam")).status).toBe(200);
    await handleFixReceiptLine(env.DB, "u-sam", id, 3, { unitCode: "EA", quantity: 24 });
    await handleFixReceiptLine(env.DB, "u-sam", id, 2, { orderNumber: "PO-300", orderLine: 1 });
    await handleFixReceiptLine(env.DB, "u-sam", id, 2, { reject: true, reason: "Counted twice" });
    expect((await handleRegisterGoodsReceipt(env.DB, "u-sam", id)).body).toMatchObject({ status: "registered" });

    const { items } = await timeline(id);
    expect(kinds(items)).toEqual(["received", "stopped", "claimed", "line_corrected", "line_repointed", "line_rejected", "registered"]);
    expect(items[0]).toMatchObject({ by: "Sam", detail: { source: "csv", lines: 3 } });
    expect(items[1]).toMatchObject({ by: null, detail: { stage: "Matching", team: "AP Receiving" } });
    expect(items[3]).toMatchObject({ by: "Sam", lineNumber: 3, detail: { from: { quantity: 2, unit: "BOX" }, to: { quantity: 24, unit: "EA" } } });
    expect(items[4]).toMatchObject({ lineNumber: 2, detail: { from: { order: "PO-300", line: 9 }, to: { order: "PO-300", line: 1 } } });
    expect(items[5]).toMatchObject({ lineNumber: 2, detail: { reason: "Counted twice" } });
    expect(items[6]).toMatchObject({ by: "Sam", detail: { how: "register", partial: false } });
    // Every moment is ISO, so they sort as written.
    expect(items.every((i) => /^\d{4}-\d\d-\d\dT.*Z$/.test(i.at))).toBe(true);
  });

  it("says a line counted when its order loaded, and that loading the order registered the receipt; a release is logged", async () => {
    await loadThrough(["WH-2,1,2026-10-06,PO-800,1,5,EA"]);
    const id = await idOf("WH-2");
    const task = await taskOf();
    await handleClaimTask(env.DB, task, "u-sam");
    await handleReleaseTask(env.DB, task, { id: "u-sam" } as never);
    await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, issue_date, currency, seller_party_id, payable_amount, status) VALUES ('p8', 'PO-800', '2026-10-01', 'GBP', 'GB111', 50, 'active')").run();
    await env.DB.prepare("INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES ('l8', 'p8', 1, 5, 'EA', 50, 'Tape', 10)").run();
    expect(await releaseWaitingReceipts(env.DB, ["PO-800"], "u-vic")).toMatchObject({ registered: 1 });
    const { items } = await timeline(id);
    expect(kinds(items)).toEqual(["received", "stopped", "claimed", "released", "lines_released", "registered"]);
    expect(items[4]).toMatchObject({ by: "Vic", detail: { orders: ["PO-800"], lines: 1, counted: false } });
    expect(items[5]).toMatchObject({ by: "Vic", detail: { how: "order_loaded", orders: "PO-800" } });
  });
});

describe("people and teams in the conversation — decision 0658", () => {
  it("adds a person with Warehouse.Collaborate and emails them in their language; refuses one who could not open it", async () => {
    await loadThrough(["WH-1,1,2026-10-06,PO-300,1,2,BOX"]);
    const id = await idOf("WH-1");
    const people = (await handleSearchReceiptPeople(env.DB, "u-sam", id, "w")).body as { users: { id: string; canSee: boolean }[]; teams: { id: string; members: number }[] };
    expect(people.users.map((u) => [u.id, u.canSee])).toEqual([
      ["u-wendy", true],
      ["u-will", false],
    ]);
    expect(people.teams).toEqual([{ id: "team-wh", name: "Warehouse", members: 2 }]);

    const pete = await handleAddReceiptCollaborator(env.DB, "u-sam", id, { userId: "u-pete" }, deps());
    expect([pete.status, pete.body]).toMatchObject([422, { reason: "cannot_see", name: "Pete" }]);
    await handlePostReceiptComment(env.DB, "u-sam", id, { body: "Is this 2 boxes of 12?" }, deps());
    const added = await handleAddReceiptCollaborator(env.DB, "u-sam", id, { userId: "u-wendy" }, deps());
    expect(added.status).toBe(201);
    expect((added.body as { notified: unknown }).notified).toEqual({ sent: 1, failed: 0, emailReady: true });
    expect(sent[0]).toMatchObject({ to: "w@x.com", subject: "Wareneingang WH-1: Sam hat Sie zur Unterhaltung hinzugefügt" });
    expect(sent[0].text).toContain("Is this 2 boxes of 12?");
    expect(sent[0].text).toContain(`https://app.acme.test/?receipt=${id}`);
    // Again is no change, and no email.
    expect((await handleAddReceiptCollaborator(env.DB, "u-sam", id, { userId: "u-wendy" }, deps())).body).toMatchObject({ added: false });
    expect(sent).toHaveLength(1);
  });

  it("adds a team: those of its members who can open the receipt are emailed; removing keeps the history", async () => {
    await loadThrough(["WH-1,1,2026-10-06,PO-300,1,2,BOX"]);
    const id = await idOf("WH-1");
    const added = await handleAddReceiptCollaborator(env.DB, "u-sam", id, { teamId: "team-wh" }, deps());
    expect((added.body as { notified: { sent: number } }).notified.sent).toBe(1);
    expect(sent.map((m) => m.to)).toEqual(["w@x.com"]);
    expect(sent[0].subject).toBe("Wareneingang WH-1: Sam hat Warehouse zur Unterhaltung hinzugefügt");
    const t1 = await timeline(id);
    expect(t1.collaborators).toEqual([expect.objectContaining({ kind: "team", teamId: "team-wh", name: "Warehouse", members: 2, addedBy: "Sam" })]);
    expect(t1.canManage).toBe(true);

    // Wendy, through the team, sees it; Vic (AP.Validate) sees it but may not manage.
    expect((await handleGetGoodsReceipt(env.DB, "u-wendy", id)).status).toBe(200);
    expect((await timeline(id, "u-vic")).canManage).toBe(false);
    expect((await handleAddReceiptCollaborator(env.DB, "u-vic", id, { userId: "u-wendy" }, deps())).body).toMatchObject({ reason: "cannot_manage" });

    const collab = t1.collaborators[0].id as string;
    expect((await handleRemoveReceiptCollaborator(env.DB, "u-sam", id, collab)).status).toBe(200);
    expect((await handleGetGoodsReceipt(env.DB, "u-wendy", id)).status).toBe(404);
    expect((await handleGetReceiptTimeline(env.DB, "u-wendy", id)).status).toBe(404);
    const t2 = await timeline(id);
    expect(t2.collaborators).toEqual([]);
    expect(kinds(t2.items).slice(-2)).toEqual(["collaborator_added", "collaborator_removed"]);
    expect(t2.items.at(-1)).toMatchObject({ by: "Sam", detail: { kind: "team", name: "Warehouse" } });
  });

  it("the Warehouse sees only the receipts it is in, and posts; everyone else in the conversation is emailed, but not the author", async () => {
    await loadThrough(["WH-1,1,2026-10-06,PO-300,1,2,BOX"]);
    await loadThrough(["WH-9,1,2026-10-06,PO-300,1,3,EA"]);
    const id = await idOf("WH-1");
    await handleClaimTask(env.DB, (await env.DB.prepare("SELECT t.id FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id JOIN process_instances pi ON pi.id = v.process_instance_id WHERE pi.subject_id = ?").bind(id).first<{ id: string }>())!.id, "u-sam");
    await handleAddReceiptCollaborator(env.DB, "u-sam", id, { userId: "u-wendy" }, deps());
    sent = [];

    const list = (await handleListGoodsReceipts(env.DB, "u-wendy", {})).body as { receipts: { receiptNumber: string }[] };
    expect(list.receipts.map((r) => r.receiptNumber)).toEqual(["WH-1"]);
    // Sam sees both, and can narrow to the ones with a conversation he is in (none by name).
    expect(((await handleListGoodsReceipts(env.DB, "u-sam", {})).body as { receipts: unknown[] }).receipts).toHaveLength(2);

    expect((await handlePostReceiptComment(env.DB, "u-wendy", id, { body: "  " }, deps())).body).toMatchObject({ reason: "comment_empty" });
    expect((await handlePostReceiptComment(env.DB, "u-wendy", id, { body: "x".repeat(4001) }, deps())).body).toMatchObject({ reason: "comment_too_long" });
    const posted = await handlePostReceiptComment(env.DB, "u-wendy", id, { body: "Yes: 2 boxes of 12, so 24 each." }, deps());
    expect(posted.status).toBe(201);
    // Sam holds the task, so he hears; Wendy wrote it, so she does not.
    expect(sent.map((m) => [m.to, m.subject])).toEqual([["s@x.com", "Goods receipt WH-1: Wendy wrote"]]);
    expect(sent[0].html).toContain("Yes: 2 boxes of 12, so 24 each.");

    const { items } = await timeline(id, "u-wendy");
    expect(items.at(-1)).toMatchObject({ kind: "comment", by: "Wendy", body: "Yes: 2 boxes of 12, so 24 each.", mine: true });
    expect((await handlePostReceiptComment(env.DB, "u-will", id, { body: "hi" }, deps())).status).toBe(404);
    // Without Resend set up, the post stands and nobody is emailed.
    expect((await handlePostReceiptComment(env.DB, "u-sam", id, { body: "Thanks" }, { email: null, appUrl: null })).body).toMatchObject({ notified: { sent: 0, emailReady: false } });
  });

  it("through the router: Wendy opens the receipt, its Timeline and posts with her key, but cannot fix a line or add people", async () => {
    await loadThrough(["WH-1,1,2026-10-06,PO-300,1,2,BOX"]);
    const id = await idOf("WH-1");
    await handleAddReceiptCollaborator(env.DB, "u-sam", id, { userId: "u-wendy" }, deps());
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-wendy'").bind(await hashApiKey(key)).run();
    const call = (path: string, method = "GET", body?: unknown) =>
      SELF.fetch(`https://example.com${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect((await call(`/goods-receipts/${id}`)).status).toBe(200);
    expect((await call(`/goods-receipts`)).status).toBe(200);
    const tl = await call(`/goods-receipts/${id}/timeline`);
    expect(tl.status).toBe(200);
    expect(((await tl.json()) as { canManage: boolean }).canManage).toBe(false);
    expect((await call(`/goods-receipts/${id}/comments`, "POST", { body: "On it" })).status).toBe(201);
    expect((await call(`/goods-receipts/${id}/lines/1`, "POST", { unitCode: "EA", quantity: 24 })).status).toBe(403);
    expect((await call(`/goods-receipts/${id}/collaborators`, "POST", { userId: "u-vic" })).status).toBe(403);
    expect((await call(`/goods-receipts/${id}/people?q=v`)).status).toBe(403);
    expect((await call(`/goods-receipts/status-counts`)).status).toBe(403);
  });
});

describe("the email — decision 0658", () => {
  it("says who did what, quotes the message, and links to the receipt, in English and German", () => {
    const en = receiptEmail("en", { kind: "posted", actor: "Wendy", team: null, number: "WH-1", latest: { by: "Wendy", body: "Two <boxes>" }, link: "https://a/?receipt=r1" });
    expect(en.subject).toBe("Goods receipt WH-1: Wendy wrote");
    expect(en.text).toBe("Wendy wrote on goods receipt WH-1:\n\nTwo <boxes>\n\nOpen the receipt: https://a/?receipt=r1\n\nYou get this because you are in this receipt's conversation in VibeFinance.");
    expect(en.html).toContain("Two &lt;boxes&gt;");
    const de = receiptEmail("de", { kind: "added", actor: "Sam", team: "Warehouse", number: "WH-1", latest: null, link: null });
    expect(de.subject).toBe("Wareneingang WH-1: Sam hat Warehouse zur Unterhaltung hinzugefügt");
    expect(de.text).not.toContain("http");
  });
});
