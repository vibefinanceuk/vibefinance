import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCancelGoodsReceipt, handleCreateGoodsReceipt } from "../src/goods-receipts.js";
import { recheckReceiptTasks, readsReceiptFacts } from "../src/receipt-recheck.js";
import { handleGetActivity } from "../src/activity-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **The re-check when goods arrive — decision 0648.** INV-A (Northwind,
 * Receipting required) invoices 40 on PO-300 line 1, nothing received.
 * At Matching it waits on an *Awaiting receipt* task, and sometimes on a
 * price task too. Matching is followed by AP Review, which has no rules.
 */

const AWAITING = { conditions: { field: "po.line_receipt_matched", operator: "is", value: false }, actions: [{ type: "assign_task", params: { team: "team-match", permission: "AP.Match" } }] };
const PRICE = { conditions: { field: "po.line_price_matched", operator: "is", value: false }, actions: [{ type: "assign_task", params: { team: "team-match", permission: "AP.Match" } }] };

async function rule(id: string, name: string, compiled: unknown) {
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, 'rs-match', 0, 1, ?)").bind(id, name).run();
  await env.DB.prepare("INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at) VALUES (?, 1, ?, ?, 'test', 'u-dan', '2026-10-01')")
    .bind(id, name, JSON.stringify(compiled))
    .run();
}

async function task(id: string, ruleId: string) {
  await env.DB.prepare("INSERT INTO stage_visit_steps (stage_visit_id, seq, rule_id, rule_version, matched, line_number) VALUES ('sv1', ?, ?, 1, 1, 1)")
    .bind(id === "t-await" ? 0 : 1, ruleId)
    .run();
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, rule_id, stage_visit_id, line_number, created_at) VALUES (?, 's-match', 'team-match', 'AP.Match', ?, 'sv1', 1, ?)"
  )
    .bind(id, ruleId, id === "t-await" ? "2026-10-01 10:00:00" : "2026-10-01 10:00:01")
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-sam', 's@x.com', 'Sam'), ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Receive","AP.Match"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-sam', 'r'), ('u-dan', 'r')").run();
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
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-a', ?, 'nw')")
    .bind(JSON.stringify({ "BT-1": "INV-A", "BT-13": "PO-300", "BT-112": 400 }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES ('il1', 'inv-a', 1, json_set(?1, '$.BT-131', 400))")
    .bind(JSON.stringify({ "BT-132": "1", "BT-129": 40, "BT-130": "EA", "BT-131": 400, "BT-146": 10 }))
    .run();

  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-match', 'Matching', 'all_matches', 'active')").run();
  await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
  await handleCreateStage(env.DB, "p1", { id: "s-match", name: "Matching", sequence: 1, ruleSetId: "rs-match", evaluationScope: "line" });
  await handleCreateStage(env.DB, "p1", { id: "s-review", name: "AP Review", sequence: 2 });
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi1', 'p1', 'invoice', 'inv-a', 's-match', 'in_progress')"
  ).run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('sv1', 'pi1', 's-match', 'matched')").run();
  await rule("r-await", "Standard rule: Awaiting receipt", AWAITING);
  await task("t-await", "r-await");
});

const receive = (n: string, qty: number, movement = "received") =>
  handleCreateGoodsReceipt(env.DB, "u-sam", {
    receiptNumber: n,
    receiptDate: "2026-10-05",
    lines: [{ orderNumber: "PO-300", orderLine: 1, quantity: qty, ...(movement === "returned" ? { movement, returnReason: "damaged" } : {}) }],
  });
const recheck = async (r: { body: unknown }) =>
  recheckReceiptTasks(env.DB, (r.body as { touched: { orderNumber: string; receiptNumber: string }[] }).touched, "u-sam", async () => {});
const statusOf = async (id: string) => (await env.DB.prepare("SELECT status, end_reason, ended_by FROM tasks WHERE id = ?").bind(id).first<{ status: string; end_reason: string | null; ended_by: string | null }>())!;
const instance = async () => (await env.DB.prepare("SELECT status, current_stage_id FROM process_instances WHERE id = 'pi1'").first<{ status: string; current_stage_id: string }>())!;

describe("which rules count as receipt rules", () => {
  it("are those that read a receipt fact", () => {
    expect(readsReceiptFacts(JSON.stringify(AWAITING))).toBe(true);
    expect(readsReceiptFacts(JSON.stringify({ conditions: { all: [{ field: "BT-112", operator: "greater_than", value: 1000 }, { field: "po.line_credit_expected", operator: "is", value: true }] } }))).toBe(true);
    expect(readsReceiptFacts(JSON.stringify(PRICE))).toBe(false);
    expect(readsReceiptFacts(null)).toBe(false);
  });
});

describe("the re-check — decision 0648", () => {
  it("leaves the task while too little is in, then closes it once the goods are, and the invoice moves on", async () => {
    const part = await receive("GR-1", 30);
    expect(await recheck(part)).toEqual({ closed: [], stillOpen: 1 });
    expect((await statusOf("t-await")).status).toBe("open");

    const rest = await receive("GR-2", 10);
    const outcome = await recheck(rest);
    expect(outcome.closed).toEqual([{ taskId: "t-await", invoiceId: "inv-a", orderNumber: "PO-300" }]);
    expect(await statusOf("t-await")).toEqual({ status: "cancelled", end_reason: "receipt:GR-2", ended_by: "u-sam" });
    // AP Review has no rules, and is the last stage: the invoice is done.
    expect(await instance()).toMatchObject({ status: "completed" });

    // On the Timeline, in words the screen can say.
    const items = ((await handleGetActivity(env.DB, "inv-a")).body as { items: Record<string, unknown>[] }).items;
    expect(items.find((i) => i.action === "receipt_closed")).toMatchObject({
      kind: "action_taken",
      userName: "Sam",
      receiptNumber: "GR-2",
      ruleName: "Standard rule: Awaiting receipt",
      lineNumber: 1,
    });
  });

  it("never touches a task another rule raised, and the invoice waits for it", async () => {
    await rule("r-price", "Price mismatch", PRICE);
    await task("t-price", "r-price");
    const outcome = await recheck(await receive("GR-1", 40));
    expect(outcome.closed.map((c) => c.taskId)).toEqual(["t-await"]);
    expect((await statusOf("t-price")).status).toBe("open");
    expect(await instance()).toMatchObject({ status: "in_progress", current_stage_id: "s-match" });
  });

  it("is run by saving a receipt, cancelling one, or loading a CSV through the router, and says what it closed", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-sam'").bind(await hashApiKey(key)).run();
    const post = (path: string, body: unknown, type = "application/json") =>
      SELF.fetch(`https://example.com${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": type },
        body: typeof body === "string" ? body : JSON.stringify(body),
      });
    const loaded = await post(
      "/goods-receipts/csv-load",
      "receipt_number,receipt_line,receipt_date,order_number,order_line,quantity\nGR-9,1,2026-10-05,PO-300,1,40",
      "text/csv"
    );
    expect(((await loaded.json()) as { recheck: unknown }).recheck).toEqual({ closed: 1, stillOpen: 0 });

    // A cancellation is a change too: nothing left to close, and it says so quietly.
    const id = (await env.DB.prepare("SELECT id FROM goods_receipts WHERE receipt_number = 'GR-9'").first<{ id: string }>())!.id;
    const cancelled = await post(`/goods-receipts/${id}/cancel`, { reason: "Wrong order" });
    expect(((await cancelled.json()) as { recheck: unknown }).recheck).toEqual({ closed: 0, stillOpen: 0 });
  });

  it("closes the task when the supplier no longer needs receipting: the rule no longer fires", async () => {
    await env.DB.prepare("UPDATE suppliers SET match_option = 'two_way'").run();
    const outcome = await recheck(await receive("GR-1", 10));
    expect(outcome.closed.map((c) => c.taskId)).toEqual(["t-await"]);
  });
});

describe("through cancellation", () => {
  it("a return or cancel is re-checked too, though it only ever closes", async () => {
    const r = await receive("GR-1", 40);
    await recheck(r);
    expect((await statusOf("t-await")).status).toBe("cancelled");
    const done = await handleCancelGoodsReceipt(env.DB, "u-sam", (r.body as { id: string }).id, { reason: "Wrong order" });
    expect(await recheck(done)).toEqual({ closed: [], stillOpen: 0 });
  });
});

describe("at intake — decision 0649", () => {
  /**
   * Reported live: a partly receipted order, an invoice for more, and no
   * stop at Matching. At intake the PO facts were merged before the
   * supplier was matched, so the first visit could not know Northwind
   * is Receipting required. Through the real intake path, with the
   * supplier known only from the enricher, as the email and route
   * intake give it.
   */
  async function intake(id: string) {
    const { handleCaptureIntake } = await import("../src/intake-capture-route.js");
    const { handleCreateIntakeChannel } = await import("../src/intake-channel-route.js");
    await env.DB.prepare("UPDATE rule_versions SET effective_from = '2026-01-01' WHERE rule_id = 'r-await'").run();
    await handleCreateProcess(env.DB, { id: "p2", name: "AP intake" });
    await handleCreateStage(env.DB, "p2", { id: "p2-match", name: "Matching", sequence: 1, ruleSetId: "rs-match", evaluationScope: "line" });
    await handleCreateStage(env.DB, "p2", { id: "p2-done", name: "Payment-eligible", sequence: 2 });
    await handleCreateIntakeChannel(env.DB, "p2", { id: "ch2", name: "Email" });
    return handleCaptureIntake(env.DB, "ch2", {
      id,
      facts: { "BT-1": id, "BT-13": "PO-300", "BT-112": 400 },
      lines: [{ lineNumber: 1, "BT-132": "1", "BT-129": 40, "BT-130": "EA", "BT-131": 400, "BT-146": 10 }],
      // The supplier, matched by the enricher after the PO facts.
      enrichFacts: async () => ({ "supplier.matched": true, "supplier.awaitingErp": false, "supplier.matchOption": "three_way" }),
    } as never);
  }

  it("stops a Receipting required supplier's invoice at Matching on its first visit when too little is in", async () => {
    await receive("GR-1", 30);
    const short = await intake("inv-short");
    const shortInstance = (short.body as { instanceId: string }).instanceId;
    const waiting = await env.DB.prepare(
      "SELECT t.rule_id, t.line_number FROM tasks t JOIN stage_visits v ON v.id = t.stage_visit_id WHERE v.process_instance_id = ? AND t.status = 'open'"
    )
      .bind(shortInstance)
      .all<{ rule_id: string; line_number: number }>();
    expect(waiting.results).toEqual([{ rule_id: "r-await", line_number: 1 }]);
    expect(await env.DB.prepare("SELECT current_stage_id, status FROM process_instances WHERE id = ?").bind(shortInstance).first()).toEqual({
      current_stage_id: "p2-match",
      status: "in_progress",
    });
  });
});
