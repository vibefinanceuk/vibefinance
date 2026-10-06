import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import {
  handleCancelGoodsReceipt,
  handleCreateGoodsReceipt,
  handleGetGoodsReceipt,
  handleListGoodsReceipts,
  handleLoadGoodsReceiptsCsv,
  heldByLine,
  orderFigures,
} from "../src/goods-receipts.js";
import { grniReport } from "../src/grni-route.js";
import { handleRejectGoodsReceipt, handleSetUpWarehouseProcess, sendReceiptsThroughProcess, warehouseProcess } from "../src/warehouse-receipts.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleUploadTargets } from "../src/upload-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Warehouse Receipts, slice 2 — decision 0651.** A receipt counts only
 * once registered; the Warehouse Receipts process, set up on request,
 * moves goods receipts from Intake through Matching to Complete, and
 * completing registers the receipt.
 *
 * PO-300 (Northwind, Receipting required): line 1, 50 rolls at £10.
 * INV-A invoices 40 of line 1 and waits at Matching on an *Awaiting
 * receipt* task (as in 0648's test).
 */

const AWAITING = { conditions: { field: "po.line_receipt_matched", operator: "is", value: false }, actions: [{ type: "assign_task", params: { team: "team-match", permission: "AP.Match" } }] };

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-sam', 's@x.com', 'Sam'), ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Receive","AP.Match","AP.Analysis"]'), ('admin', 'admin', '["Admin.Configure"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-sam', 'r'), ('u-dan', 'admin')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('u1', 'Acme')").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('team-match', 'AP Matching', 'u1')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', 'three_way', datetime('now'))"
  ).run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, issue_date, currency, seller_party_id, payable_amount, status) VALUES ('po', 'PO-300', '2026-09-01', 'GBP', 'GB111', 500, 'active')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES ('l1', 'po', 1, 50, 'EA', 500, 'Bubble wrap', 10)"
  ).run();
});

const CSV = (rows: string[]) => ["receipt_number,receipt_line,receipt_date,order_number,order_line,quantity", ...rows].join("\n");

/** Stored pending, not sent: what a receipt stopped on the way looks like. */
async function pending(n: string, qty: number) {
  const r = await handleLoadGoodsReceiptsCsv(env.DB, "u-sam", CSV([`${n},1,2026-10-05,PO-300,1,${qty}`]), new Date(), { pending: true });
  return (r.body as { pendingIds: string[] }).pendingIds[0];
}

describe("receipt status — decision 0651", () => {
  it("registers a receipt keyed on the screen at once, and a CSV load too while the process is not set up", async () => {
    const keyed = await handleCreateGoodsReceipt(env.DB, "u-sam", { receiptNumber: "GR-1", receiptDate: "2026-10-05", lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: 10 }] });
    expect(keyed.body).toMatchObject({ status: "registered" });
    const loaded = await handleLoadGoodsReceiptsCsv(env.DB, "u-sam", CSV(["GR-2,1,2026-10-05,PO-300,1,5"]));
    expect((loaded.body as { pendingIds: string[] }).pendingIds).toEqual([]);
    const rows = (await env.DB.prepare("SELECT receipt_number, status, registered_at IS NOT NULL AS stamped FROM goods_receipts ORDER BY receipt_number").all()).results;
    expect(rows).toEqual([
      { receipt_number: "GR-1", status: "registered", stamped: 1 },
      { receipt_number: "GR-2", status: "registered", stamped: 1 },
    ]);
  });

  it("does not count a pending receipt: not held, not in the order's figures, not in GRNI", async () => {
    await handleCreateGoodsReceipt(env.DB, "u-sam", { receiptNumber: "GR-1", receiptDate: "2026-10-05", lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: 10 }] });
    await pending("WH-1", 30);
    expect((await heldByLine(env.DB, "PO-300")).get(1)).toEqual({ received: 10, returned: 0 });
    expect((await orderFigures(env.DB, "PO-300"))?.lines[0]).toMatchObject({ received: 10, state: "partially_received" });
    const grni = await grniReport(env.DB, "u-sam", null, "2026-10-31");
    expect("error" in grni ? null : grni.lines.map((l) => l.notInvoiced)).toEqual([10]);
  });

  it("lists pending and rejected receipts, says which on opening one, and cancels only a registered one", async () => {
    const id = await pending("WH-1", 30);
    const listed = (await handleListGoodsReceipts(env.DB, "u-sam", { kind: "pending" })).body as { receipts: { receiptNumber: string; status: string }[] };
    expect(listed.receipts).toEqual([expect.objectContaining({ receiptNumber: "WH-1", status: "pending" })]);
    expect(((await handleGetGoodsReceipt(env.DB, "u-sam", id)).body as { receipt: { status: string } }).receipt.status).toBe("pending");
    expect((await handleCancelGoodsReceipt(env.DB, "u-sam", id, { reason: "x" })).body).toMatchObject({ reason: "receipt_pending" });
  });

  it("rejects a pending receipt with a reason; it never counts, and a CSV cannot add to it", async () => {
    const id = await pending("WH-1", 30);
    expect((await handleRejectGoodsReceipt(env.DB, "u-sam", id, {})).body).toMatchObject({ reason: "reject_reason_missing" });
    const done = await handleRejectGoodsReceipt(env.DB, "u-sam", id, { reason: "Not our delivery" }, new Date("2026-10-06T09:00:00Z"));
    expect(done).toMatchObject({ status: 200, body: { status: "rejected" } });
    const got = (await handleGetGoodsReceipt(env.DB, "u-sam", id)).body as { receipt: Record<string, unknown> };
    expect(got.receipt).toMatchObject({ status: "rejected", rejectedBy: "Sam", rejectReason: "Not our delivery", rejectedAt: "2026-10-06T09:00:00.000Z" });
    expect((await handleRejectGoodsReceipt(env.DB, "u-sam", id, { reason: "again" })).body).toMatchObject({ reason: "already_rejected" });
    expect((await handleCancelGoodsReceipt(env.DB, "u-sam", id, { reason: "x" })).body).toMatchObject({ reason: "receipt_rejected" });
    const more = await handleLoadGoodsReceiptsCsv(env.DB, "u-sam", CSV(["WH-1,2,2026-10-05,PO-300,1,5"]));
    expect((more.body as { refused: { reason: string }[] }).refused.map((r) => r.reason)).toEqual(["receipt_rejected"]);
    expect((await heldByLine(env.DB, "PO-300")).size).toBe(0);

    const keyed = await handleCreateGoodsReceipt(env.DB, "u-sam", { receiptNumber: "GR-1", receiptDate: "2026-10-05", lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: 10 }] });
    expect((await handleRejectGoodsReceipt(env.DB, "u-sam", (keyed.body as { id: string }).id, { reason: "x" })).body).toMatchObject({ reason: "receipt_registered" });
  });
});

describe("the Warehouse Receipts process — decision 0651", () => {
  it("is set up once, with Intake, Matching and Complete, moving goods receipts", async () => {
    expect(await warehouseProcess(env.DB)).toBeNull();
    const made = await handleSetUpWarehouseProcess(env.DB, { name: "Lagereingänge", stageNames: { intake: "Eingang" } });
    expect(made).toMatchObject({ status: 201, body: { created: true } });
    const process = await warehouseProcess(env.DB);
    expect(process).toEqual({
      id: "warehouse-receipts",
      name: "Lagereingänge",
      stages: [
        { id: "warehouse-receipts-intake", name: "Eingang" },
        { id: "warehouse-receipts-matching", name: "Matching" },
        { id: "warehouse-receipts-complete", name: "Complete" },
      ],
    });
    expect(await env.DB.prepare("SELECT subject_type, entry_stage_id, exit_stage_id FROM processes WHERE id = 'warehouse-receipts'").first()).toEqual({
      subject_type: "goods_receipt",
      entry_stage_id: "warehouse-receipts-intake",
      exit_stage_id: "warehouse-receipts-complete",
    });
    expect(await handleSetUpWarehouseProcess(env.DB, {})).toMatchObject({ status: 200, body: { created: false } });
  });

  it("takes no invoice sources and is not offered for uploads", async () => {
    await handleSetUpWarehouseProcess(env.DB, {});
    expect((await handleCreateSource(env.DB, "warehouse-receipts", { id: "s1", name: "Inbox", mechanism: "email" })).body).toMatchObject({ reason: "process_not_invoices" });
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism, status) VALUES ('up', 'warehouse-receipts', 'Upload', 'file_import', 'active')").run();
    expect(((await handleUploadTargets(env.DB)).body as { targets: unknown[] }).targets).toEqual([]);
  });

  it("registers each receipt that reaches the end, one instance per receipt", async () => {
    await handleSetUpWarehouseProcess(env.DB, {});
    const a = await pending("WH-1", 10);
    const b = await pending("WH-2", 5);
    const through = await sendReceiptsThroughProcess(env.DB, [a, b], new Date("2026-10-06T10:00:00Z"));
    expect(through.sent.map((s) => s.status)).toEqual(["registered", "registered"]);
    expect(through.touched).toEqual([
      { orderNumber: "PO-300", receiptNumber: "WH-1" },
      { orderNumber: "PO-300", receiptNumber: "WH-2" },
    ]);
    const instances = (await env.DB.prepare("SELECT subject_type, status FROM process_instances WHERE process_id = 'warehouse-receipts'").all()).results;
    expect(instances).toEqual([
      { subject_type: "goods_receipt", status: "completed" },
      { subject_type: "goods_receipt", status: "completed" },
    ]);
    const visited = (await env.DB.prepare("SELECT stage_id FROM stage_visits v JOIN process_instances pi ON pi.id = v.process_instance_id WHERE pi.subject_id = ? ORDER BY v.created_at").bind(a).all()).results;
    expect(visited.map((v) => v.stage_id)).toEqual(["warehouse-receipts-intake", "warehouse-receipts-matching", "warehouse-receipts-complete"]);
    expect(await env.DB.prepare("SELECT status, registered_at FROM goods_receipts WHERE id = ?").bind(a).first()).toEqual({ status: "registered", registered_at: "2026-10-06T10:00:00.000Z" });
    expect((await heldByLine(env.DB, "PO-300")).get(1)).toEqual({ received: 15, returned: 0 });
  });

  it("leaves a receipt pending where a stage stops it, says where, and rejecting it ends its instance and its tasks", async () => {
    await handleSetUpWarehouseProcess(env.DB, {});
    // A rule on Matching that always raises a task.
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-wh', 'WH', 'all_matches', 'active')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES ('r-wh', 'rs-wh', 0, 1, 'Look at it')").run();
    await env.DB.prepare("INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from) VALUES ('r-wh', 1, 'x', ?, 'test', 'u-dan', '2026-10-01', '2026-01-01')")
      .bind(JSON.stringify({ conditions: { field: "lines", operator: "greater_than", value: 0 }, actions: [{ type: "assign_task", params: { team: "team-match", permission: "AP.Receive" } }] }))
      .run();
    await env.DB.prepare("UPDATE process_stages SET rule_set_id = 'rs-wh' WHERE id = 'warehouse-receipts-matching'").run();

    const id = await pending("WH-1", 10);
    const through = await sendReceiptsThroughProcess(env.DB, [id]);
    expect(through.sent).toEqual([expect.objectContaining({ status: "pending", stage: "Matching" })]);
    expect(through.touched).toEqual([]);
    const got = (await handleGetGoodsReceipt(env.DB, "u-sam", id)).body as { process: Record<string, unknown> };
    expect(got.process).toMatchObject({ status: "in_progress", processName: "Warehouse Receipts", stageName: "Matching" });

    await handleRejectGoodsReceipt(env.DB, "u-sam", id, { reason: "Wrong warehouse" });
    expect(await env.DB.prepare("SELECT status FROM process_instances WHERE subject_id = ?").bind(id).first()).toEqual({ status: "rejected" });
    expect((await env.DB.prepare("SELECT status, end_reason FROM tasks").all()).results).toEqual([{ status: "cancelled", end_reason: "receipt_rejected" }]);
  });

  it("registers the receipt when the last task on it is completed", async () => {
    await handleSetUpWarehouseProcess(env.DB, {});
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-wh', 'WH', 'all_matches', 'active')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES ('r-wh', 'rs-wh', 0, 1, 'Look at it')").run();
    await env.DB.prepare("INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at, effective_from) VALUES ('r-wh', 1, 'x', ?, 'test', 'u-dan', '2026-10-01', '2026-01-01')")
      .bind(JSON.stringify({ conditions: { field: "lines", operator: "greater_than", value: 0 }, actions: [{ type: "assign_task", params: { team: "team-match", permission: "AP.Receive" } }] }))
      .run();
    await env.DB.prepare("UPDATE process_stages SET rule_set_id = 'rs-wh' WHERE id = 'warehouse-receipts-matching'").run();
    const id = await pending("WH-1", 10);
    await sendReceiptsThroughProcess(env.DB, [id]);
    const task = (await env.DB.prepare("SELECT id FROM tasks").first<{ id: string }>())!.id;
    await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES ('team-match', 'u-sam')").run();

    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-sam'").bind(await hashApiKey(key)).run();
    const act = (what: string) => SELF.fetch(`https://example.com/tasks/${task}/${what}`, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: "{}" });
    expect((await act("claim")).status).toBe(200);
    expect((await act("complete")).status).toBe(200);
    expect(await env.DB.prepare("SELECT status FROM goods_receipts WHERE id = ?").bind(id).first()).toEqual({ status: "registered" });
    expect(await env.DB.prepare("SELECT status FROM process_instances WHERE subject_id = ?").bind(id).first()).toEqual({ status: "completed" });
  });

  it("through the router: set up by Admin.Configure, and a CSV load registers the goods and moves the waiting invoice on", async () => {
    const keyOf = async (id: string) => {
      const key = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(key), id).run();
      return key;
    };
    const sam = await keyOf("u-sam");
    const dan = await keyOf("u-dan");
    const call = (key: string, path: string, method = "GET", body?: string, type = "application/json") =>
      SELF.fetch(`https://example.com${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": type }, body });

    expect((await call(sam, "/goods-receipts/process", "POST", "{}")).status).toBe(403);
    expect((await call(dan, "/goods-receipts/process", "POST", "{}")).status).toBe(201);
    expect(((await (await call(sam, "/goods-receipts/process")).json()) as { process: { id: string } }).process.id).toBe("warehouse-receipts");

    // INV-A waits at Matching on Awaiting receipt (0648's set-up).
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-a', ?, 'nw')").bind(JSON.stringify({ "BT-1": "INV-A", "BT-13": "PO-300", "BT-112": 400 })).run();
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, amount, facts_json) VALUES ('il1', 'inv-a', 1, 400, ?)")
      .bind(JSON.stringify({ "BT-132": "1", "BT-129": 40, "BT-130": "EA", "BT-131": 400, "BT-146": 10 }))
      .run();
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-match', 'Matching', 'all_matches', 'active')").run();
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateStage(env.DB, "p1", { id: "s-match", name: "Matching", sequence: 1, ruleSetId: "rs-match", evaluationScope: "line" });
    await handleCreateStage(env.DB, "p1", { id: "s-review", name: "AP Review", sequence: 2 });
    await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi1', 'p1', 'invoice', 'inv-a', 's-match', 'in_progress')").run();
    await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('sv1', 'pi1', 's-match', 'matched')").run();
    await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES ('r-await', 'rs-match', 0, 1, 'Awaiting receipt')").run();
    await env.DB.prepare("INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at) VALUES ('r-await', 1, 'x', ?, 'test', 'u-dan', '2026-10-01')")
      .bind(JSON.stringify(AWAITING))
      .run();
    await env.DB.prepare("INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched, line_number) VALUES ('sv1', 0, 'r-await', 1, 1, 1)").run();
    await env.DB.prepare("INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, rule_id, stage_visit_id, line_number, created_at) VALUES ('t-await', 's-match', 'team-match', 'AP.Match', 'r-await', 'sv1', 1, '2026-10-01 10:00:00')").run();

    const loaded = await call(sam, "/goods-receipts/csv-load", "POST", CSV(["WH-9,1,2026-10-05,PO-300,1,40"]), "text/csv");
    const body = (await loaded.json()) as { process: { name: string; sent: { status: string }[] }; recheck: unknown };
    expect(body.process).toMatchObject({ name: "Warehouse Receipts", sent: [{ status: "registered" }] });
    expect(body.recheck).toEqual({ closed: 1, stillOpen: 0 });
    expect(await env.DB.prepare("SELECT status FROM process_instances WHERE id = 'pi1'").first()).toEqual({ status: "completed" });

    const id = (await env.DB.prepare("SELECT id FROM goods_receipts WHERE receipt_number = 'WH-9'").first<{ id: string }>())!.id;
    expect((await call(sam, `/goods-receipts/${id}/reject`, "POST", JSON.stringify({ reason: "x" }))).status).toBe(409);
  });
});
