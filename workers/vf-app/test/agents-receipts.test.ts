import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { checkQuery, runQuery, type AgentQuery } from "../src/agent-query.js";
import { checkOptions, reportById } from "../src/agents.js";
import { handleCreateGoodsReceipt } from "../src/goods-receipts.js";

/**
 * **Receipts in questions and agents — decision 0656.** Acme UK. Dan
 * holds every permission. Northwind (Receipting required):
 *
 * - PO-300 line 1, 50 rolls at £10: 40 received on 20 August, invoiced
 *   40 on 1 September, 5 returned on 10 September — a credit of 5 owed;
 * - PO-301 line 1, 30 boxes at £5: 20 received on 20 August, not
 *   invoiced — received not invoiced, 46 days old;
 * - PO-302 line 1: INV-B waits at Matching on *Awaiting receipt* since
 *   30 September;
 * - WH-9, pending: a line waiting since 20 September for PO-999.
 */

const NOW = new Date("2026-10-05T12:00:00Z");
const UK = { id: "acme-uk", name: "Acme UK Ltd" };
const AWAITING = { conditions: { field: "po.line_receipt_matched", operator: "is", value: false }, actions: [{ type: "assign_task", params: { team: "ap-team", permission: "AP.Match" } }] };

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-uk', 'Acme UK Ltd', 'legal_entity')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('dan', 'dan@acme.com', 'Dan')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Agents","AP.Analysis","AP.Validate","AP.Receive"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('dan', 'r', NULL)").run();
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES ('ap-team', 'AP', 'acme-uk')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', 'three_way', datetime('now'))",
  ).run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, currency, seller_party_id, status, org_unit_id) VALUES ('p0', 'PO-300', 'GBP', 'GB111', 'active', 'acme-uk'), ('p1', 'PO-301', 'GBP', 'GB111', 'active', 'acme-uk'), ('p2', 'PO-302', 'GBP', 'GB111', 'active', 'acme-uk')",
  ).run();
  await env.DB.prepare(
    `INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount, base_quantity) VALUES
     ('a', 'p0', 1, 50, 'EA', 500, 'Bubble wrap', 10, 1), ('b', 'p1', 1, 30, 'EA', 150, 'Boxes', 5, 1), ('c', 'p2', 1, 10, 'EA', 100, 'Tape', 10, 1)`,
  ).run();
  const receive = (n: string, date: string, order: string, qty: number, movement = "received") =>
    handleCreateGoodsReceipt(env.DB, "dan", {
      receiptNumber: n,
      receiptDate: date,
      lines: [{ orderNumber: order, orderLine: 1, quantity: qty, ...(movement === "returned" ? { movement, returnReason: "damaged" } : {}) }],
    });
  await receive("GR-1", "2026-08-20", "PO-300", 40);
  await receive("GR-2", "2026-08-20", "PO-301", 20);
  await receive("GR-R", "2026-09-10", "PO-300", 5, "returned");
  // INV-A invoiced all 40 of PO-300 line 1 on 1 September.
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, supplier_id) VALUES ('inv-a', json_set(?1, '$.BT-2', '2026-09-01', '$.BT-5', 'GBP', '$.BT-112', 400), 'acme-uk', 'nw')")
    .bind(JSON.stringify({ "BT-1": "INV-A", "BT-13": "PO-300" }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES ('ia1', 'inv-a', 1, ?)").bind(JSON.stringify({ "BT-132": "1", "BT-129": 40 })).run();
  // INV-B waits at Matching on Awaiting receipt since 30 September.
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, supplier_id) VALUES ('inv-b', json_set(?1, '$.BT-5', 'GBP', '$.BT-112', 100, '$.BT-1', 'INV-B'), 'acme-uk', 'nw')")
    .bind(JSON.stringify({ "BT-1": "INV-B", "BT-13": "PO-302" }))
    .run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('s-match', 'ap', 'Matching', 1)").run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-b', 'ap', 'invoice', 'inv-b', 's-match', 'in_progress')").run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('sv-b', 'pi-b', 's-match', 'matched')").run();
  await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs', 'Matching', 'all_matches', 'active')").run();
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES ('r-await', 'rs', 0, 1, 'Awaiting receipt'), ('r-price', 'rs', 1, 1, 'Price')").run();
  await env.DB.prepare("INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, approved_by, approved_at) VALUES ('r-await', 1, 'x', ?, 't', 'dan', '2026-09-01'), ('r-price', 1, 'x', ?, 't', 'dan', '2026-09-01')")
    .bind(JSON.stringify(AWAITING), JSON.stringify({ conditions: { field: "po.line_price_matched", operator: "is", value: false }, actions: [] }))
    .run();
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, owner_team_id, required_permission, rule_id, stage_visit_id, created_at) VALUES ('t-b', 's-match', 'ap-team', 'AP.Match', 'r-await', 'sv-b', '2026-09-30 10:00:00')",
  ).run();
  // WH-9: pending, its one line waiting since 20 September for PO-999.
  await env.DB.prepare("INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_by, created_at, status) VALUES ('wh9', 'WH-9', '2026-09-20', 'csv', 'dan', '2026-09-20T09:00:00Z', 'pending')").run();
  await env.DB.prepare(
    "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, created_at, check_reason, waiting_since) VALUES ('wl', 'wh9', 1, 'PO-999', 1, 'received', 4, '2026-09-20T09:00:00Z', 'order_not_loaded', '2026-09-20T09:00:00Z')",
  ).run();
});

const ok = (input: unknown): AgentQuery => {
  const c = checkQuery(input);
  if (!("query" in c)) throw new Error(c.reason);
  return c.query;
};
const run = (q: unknown) => runQuery(env.DB, "dan", [UK], ok(q), NOW);
const report = async (id: string, options: unknown = {}) => {
  const checked = checkOptions(id, options);
  if (!("options" in checked)) throw new Error(checked.reason);
  return reportById(id)!.gather(env.DB, "dan", [UK], NOW, checked.options);
};

describe("the Receipts dataset", () => {
  it("is one row per receipt line, with its receipt, order, supplier, value and where it stands", async () => {
    const r = await run({
      dataset: "receipts",
      show: ["receipt", "order", "supplier", "item", "movement", "value", "currency", "receiptStatus", "lineStatus", "returnReason", "recordedBy"],
      sort: [{ key: "receipt", dir: "asc" }],
    });
    expect(r.rows.map((x) => [x.receipt, x.order, x.supplier, x.item, x.movement, x.value, x.currency, x.receiptStatus, x.lineStatus, x.returnReason, x.recordedBy])).toEqual([
      ["GR-1", "PO-300", "Northwind", "Bubble wrap", "received", 400, "GBP", "registered", "counted", null, "Dan"],
      ["GR-2", "PO-301", "Northwind", "Boxes", "received", 100, "GBP", "registered", "counted", null, "Dan"],
      ["GR-R", "PO-300", "Northwind", "Bubble wrap", "returned", 50, "GBP", "registered", "counted", "Damaged", "Dan"],
      ["WH-9", "PO-999", null, null, "received", null, null, "pending", "waiting", null, "Dan"],
    ]);
  });

  it("answers the ready-made question: lines waiting more than 7 days for their order", async () => {
    const r = await run({
      dataset: "receipts",
      where: [{ field: "lineStatus", op: "is", value: "waiting" }, { field: "daysWaiting", op: "over", value: 7 }],
      show: ["receipt", "order", "daysWaiting"],
    });
    expect(r.rows.map((x) => [x.receipt, x.order, x.daysWaiting])).toEqual([["WH-9", "PO-999", 15]]);
  });

  it("adds up what was received by supplier, per currency", async () => {
    const r = await run({ dataset: "receipts", where: [{ field: "movement", op: "is", value: "received" }, { field: "receiptStatus", op: "is", value: "registered" }], groupBy: ["supplier"], measures: [{ fn: "sum", field: "value" }] });
    expect(r.rows.map((x) => [x.supplier, x.currency, x.sum_value])).toEqual([["Northwind", "GBP", 500]]);
  });
});

describe("Purchase orders gain their receipt state", () => {
  it("says where each line stands on goods received", async () => {
    const r = await run({ dataset: "purchase_orders", show: ["order", "receipt"], sort: [{ key: "order", dir: "asc" }] });
    expect(r.rows.map((x) => [x.order, x.receipt])).toEqual([
      ["PO-300", "partially_received"],
      ["PO-301", "partially_received"],
      ["PO-302", "not_received"],
    ]);
  });
});

describe("the ready-made reports", () => {
  it("waiting on receipt: invoices held by a receipt rule for at least the days chosen", async () => {
    expect(checkOptions("waiting_on_receipt", {})).toEqual({ options: { olderThanDays: 3 } });
    const t = await report("waiting_on_receipt");
    expect(t.rows.map((r) => [r.invoice, r.supplier, r.po, r.stage, r.daysWaiting, r.total, r._key])).toEqual([["INV-B", "Northwind", "PO-302", "Matching", 5, 100, "receipt-wait:inv-b"]]);
    expect((await report("waiting_on_receipt", { olderThanDays: 6 })).rows).toEqual([]);
    // A task another rule raised is not one.
    await env.DB.prepare("UPDATE tasks SET rule_id = 'r-price' WHERE id = 't-b'").run();
    expect((await report("waiting_on_receipt")).rows).toEqual([]);
  });

  it("received, not invoiced: lines older than the days chosen, valued at the order's price", async () => {
    expect(checkOptions("received_not_invoiced", {})).toEqual({ options: { olderThanDays: 30 } });
    const t = await report("received_not_invoiced");
    expect(t.rows.map((r) => [r.supplier, r.po, r.orderLine, r.item, r.quantity, r.oldestReceipt, r.days, r.total, r.currency])).toEqual([
      ["Northwind", "PO-301", 1, "Boxes", 20, "2026-08-20", 46, 100, "GBP"],
    ]);
    expect(t.totals).toEqual([{ currency: "GBP", total: 100, count: 1 }]);
    expect((await report("received_not_invoiced", { olderThanDays: 60 })).rows).toEqual([]);
  });

  it("credit still owed: goods returned after invoicing with no credit note yet", async () => {
    const t = await report("credit_still_owed");
    expect(t.rows.map((r) => [r.supplier, r.po, r.orderLine, r.item, r.quantity, r.lastReturn, r.days, r.total, r.currency])).toEqual([
      ["Northwind", "PO-300", 1, "Bubble wrap", 5, "2026-09-10", 25, 50, "GBP"],
    ]);
  });
});
