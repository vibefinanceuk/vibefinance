import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { mergePoMatchFacts } from "../src/po-matching.js";
import { handleGetPoMatchView } from "../src/po-match-panel-route.js";
import { handleCancelGoodsReceipt, handleCreateGoodsReceipt } from "../src/goods-receipts.js";

/**
 * **Three-way matching: the receipt facts — decision 0647.** PO-300
 * (Northwind, Receipting required): line 1, 50 rolls; line 2, 100
 * cartons. Facts are worked out the way every evaluation does, through
 * `mergePoMatchFacts`, with the invoice's id so other invoices count.
 */

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-sam', 's@x.com', 'Sam'), ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Receive","AP.Match"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-sam', 'r'), ('u-dan', 'r')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', 'three_way', datetime('now')), ('cx', 'C1', 'Contoso', 'GB222', 'active', 'two_way', datetime('now'))"
  ).run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, issue_date, currency, seller_party_id, payable_amount, status) VALUES ('po', 'PO-300', '2026-09-01', 'GBP', 'GB111', 1500, 'active')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES ('l1', 'po', 1, 50, 'EA', 500, 'Bubble wrap', 10), ('l2', 'po', 2, 100, 'EA', 1000, 'Carton', 10)"
  ).run();
});

async function invoice(id: string, supplierId: string, lines: [number | null, number][]) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": id, "BT-13": "PO-300", "BT-112": 100 }), supplierId)
    .run();
  for (const [i, [ref, qty]] of lines.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, amount, facts_json) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, i + 1, qty * 10, JSON.stringify({ ...(ref === null ? {} : { "BT-132": String(ref) }), "BT-129": qty, "BT-130": "EA", "BT-131": qty * 10, "BT-146": 10 }))
      .run();
  }
}

const receive = (n: string, line: number, qty: number, movement = "received") =>
  handleCreateGoodsReceipt(env.DB, "u-sam", {
    receiptNumber: n,
    receiptDate: "2026-10-01",
    lines: [{ orderNumber: "PO-300", orderLine: line, quantity: qty, ...(movement === "returned" ? { movement, returnReason: "damaged" } : {}) }],
  });

async function factsOf(id: string, lines: [number | null, number][]) {
  const merged = await mergePoMatchFacts(
    env.DB,
    { "BT-13": "PO-300", "BT-112": 100 },
    lines.map(([ref, qty], i) => ({ lineNumber: i + 1, ...(ref === null ? {} : { "BT-132": String(ref) }), "BT-129": qty, "BT-130": "EA", "BT-131": qty * 10, "BT-146": 10 })),
    { invoiceId: id }
  );
  return merged.lines.map((l) => [l["po.line_receipt_matched"], l["po.line_receipt_shortfall_pct"], l["po.line_credit_expected"]]);
}

describe("the receipt facts", () => {
  it("are absent for a supplier that is not Receipting required, and for a line with no PO line", async () => {
    await invoice("inv-c", "cx", [[1, 10]]);
    expect(await factsOf("inv-c", [[1, 10]])).toEqual([[undefined, undefined, undefined]]);
    await invoice("inv-n", "nw", [[null, 10]]);
    expect(await factsOf("inv-n", [[null, 10]])).toEqual([[undefined, undefined, undefined]]);
  });

  it("say whether what is invoiced is within what was received, counting other invoices and this one's earlier lines", async () => {
    await receive("GR-1", 1, 40);
    await invoice("inv-a", "nw", [[1, 40]]);
    expect(await factsOf("inv-a", [[1, 40]])).toEqual([[true, 0, false]]);
    // Nothing received on line 2 yet: 20 of 100 ordered short.
    await invoice("inv-b", "nw", [[1, 5], [2, 20]]);
    // inv-a already took 40 of the 40 held on line 1.
    expect(await factsOf("inv-b", [[1, 5], [2, 20]])).toEqual([
      [false, 10, false],
      [false, 20, false],
    ]);
    // Two lines of one invoice on the same PO line add up, after inv-b's 20: 40, then 60, against 50 held.
    await receive("GR-2", 2, 50);
    await invoice("inv-c2", "nw", [[2, 20], [2, 20]]);
    expect(await factsOf("inv-c2", [[2, 20], [2, 20]])).toEqual([
      [true, 0, false],
      [false, 10, false],
    ]);
  });

  it("expect a credit when goods went back after they were invoiced, and allow the supplier's tolerance", async () => {
    await receive("GR-1", 1, 40);
    await invoice("inv-a", "nw", [[1, 40]]);
    await receive("GR-R", 1, 5, "returned");
    expect(await factsOf("inv-a", [[1, 40]])).toEqual([[false, 10, true]]);
    // 5% of 50 ordered is 2.5: 37 invoiced against 35 kept is within it.
    await env.DB.prepare("UPDATE suppliers SET quantity_tolerance_pct = 5 WHERE id = 'nw'").run();
    const merged = await mergePoMatchFacts(
      env.DB,
      { "BT-13": "PO-300", "supplier.quantityTolerancePct": 5 },
      [{ lineNumber: 1, "BT-132": "1", "BT-129": 37, "BT-130": "EA", "BT-131": 370, "BT-146": 10 }],
      { invoiceId: "inv-a" }
    );
    expect(merged.lines[0]["po.line_receipt_matched"]).toBe(true);
    expect(merged.lines[0]["po.line_credit_expected"]).toBe(false);
  });

  it("follow the supplier's setting as it is now, and a receipt cancelled counts for nothing", async () => {
    const r = await receive("GR-1", 1, 40);
    await invoice("inv-a", "nw", [[1, 40]]);
    expect((await factsOf("inv-a", [[1, 40]]))[0][0]).toBe(true);
    expect((await handleCancelGoodsReceipt(env.DB, "u-sam", (r.body as { id: string }).id, { reason: "Wrong order" })).status).toBe(200);
    expect((await factsOf("inv-a", [[1, 40]]))[0]).toEqual([false, 80, false]);
    await env.DB.prepare("UPDATE suppliers SET match_option = 'two_way' WHERE id = 'nw'").run();
    expect((await factsOf("inv-a", [[1, 40]]))[0]).toEqual([undefined, undefined, undefined]);
  });
});

describe("the PO matching panel", () => {
  it("shows each line's receipt verdict with what was received and invoiced, for a Receipting required supplier", async () => {
    await receive("GR-1", 1, 40);
    await receive("GR-R", 1, 5, "returned");
    await invoice("inv-a", "nw", [[1, 40], [2, 10]]);
    const view = (await handleGetPoMatchView(env.DB, "inv-a", "u-dan")).body as {
      po: { receiptingRequired: boolean };
      lines: { lineNumber: number; receipt?: { matched: boolean; creditExpected: boolean; received: number; returned: number; invoiced: number } }[];
    };
    expect(view.po.receiptingRequired).toBe(true);
    expect(view.lines.map((l) => l.receipt)).toEqual([
      { matched: false, creditExpected: true, shortfallPct: 10, received: 35, returned: 5, invoiced: 40 },
      { matched: false, creditExpected: false, shortfallPct: 10, received: 0, returned: 0, invoiced: 10 },
    ]);
    await env.DB.prepare("UPDATE suppliers SET match_option = 'two_way' WHERE id = 'nw'").run();
    const plain = (await handleGetPoMatchView(env.DB, "inv-a", "u-dan")).body as { po: { receiptingRequired: boolean }; lines: { receipt?: unknown }[] };
    expect(plain.po.receiptingRequired).toBe(false);
    expect(plain.lines.every((l) => l.receipt === undefined)).toBe(true);
  });
});
