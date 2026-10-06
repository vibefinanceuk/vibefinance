import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCancelGoodsReceipt, handleCreateGoodsReceipt } from "../src/goods-receipts.js";
import { grniCsv, grniReport } from "../src/grni-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Goods received not invoiced — decision 0650.** PO-300 (Acme UK,
 * Northwind, GBP): line 1, 50 rolls at £10; line 2, 100 cartons at £2
 * a piece by a base quantity of 10 (£20 per 10). PO-700 (Acme France,
 * Fabrikam, EUR): line 1, 10 pallets at €30.
 */

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('uk', 'Acme UK', 'legal_entity'), ('fr', 'Acme France', 'legal_entity')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-sam', 's@x.com', 'Sam'), ('u-fin', 'f@x.com', 'Fiona'), ('u-uk', 'k@x.com', 'Kim')").run();
  await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('rcv', 'rcv', '["AP.Receive"]'), ('fin', 'fin', '["AP.Analysis"]')`).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('u-sam', 'rcv', NULL), ('u-fin', 'fin', NULL), ('u-uk', 'fin', 'uk')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, loaded_at) VALUES ('nw', 'N1', 'Northwind', 'GB111', 'active', datetime('now')), ('fb', 'F9', 'Fabrikam', 'FR222', 'active', datetime('now'))"
  ).run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, currency, seller_party_id, status, org_unit_id) VALUES ('p3', 'PO-300', 'GBP', 'GB111', 'active', 'uk'), ('p7', 'PO-700', 'EUR', 'FR222', 'active', 'fr')"
  ).run();
  await env.DB.prepare(
    `INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount, base_quantity) VALUES
     ('a', 'p3', 1, 50, 'EA', 500, 'Bubble wrap', 10, 1),
     ('b', 'p3', 2, 100, 'EA', 200, 'Carton', 20, 10),
     ('c', 'p7', 1, 10, 'EA', 300, 'Pallet', 30, 1)`
  ).run();
});

const receive = (n: string, date: string, order: string, line: number, qty: number, movement = "received") =>
  handleCreateGoodsReceipt(env.DB, "u-sam", {
    receiptNumber: n,
    receiptDate: date,
    lines: [{ orderNumber: order, orderLine: line, quantity: qty, ...(movement === "returned" ? { movement, returnReason: "damaged" } : {}) }],
  });

async function invoice(id: string, order: string, issued: string, lines: [number, number][]) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, issue_date) VALUES (?, ?, ?)").bind(id, JSON.stringify({ "BT-13": order }), issued).run();
  for (const [i, [ref, qty]] of lines.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, i + 1, JSON.stringify({ "BT-132": String(ref), "BT-129": qty }))
      .run();
  }
}

const report = async (asAt: string, user = "u-fin", org: string | null = null) => {
  const r = await grniReport(env.DB, user, org, asAt);
  if ("error" in r) throw new Error(r.error);
  return r;
};

describe("goods received not invoiced", () => {
  it("values what is in and not yet invoiced at the PO price, per currency, aged by the oldest goods", async () => {
    await receive("GR-1", "2026-07-20", "PO-300", 1, 30);
    await receive("GR-2", "2026-09-10", "PO-300", 1, 20);
    await receive("GR-3", "2026-09-20", "PO-300", 2, 40);
    await receive("GR-4", "2026-09-25", "PO-700", 1, 10);
    // 25 of line 1 invoiced: the oldest 25 of the July 30 are used, so 5 from July remain.
    await invoice("inv-1", "PO-300", "2026-08-01", [[1, 25]]);

    const r = await report("2026-09-30");
    expect(r.lines.map((l) => [l.orderNumber, l.orderLine, l.notInvoiced, l.amount, l.currency, l.oldestReceiptDate, l.days])).toEqual([
      ["PO-300", 1, 25, 250, "GBP", "2026-07-20", 72],
      ["PO-300", 2, 40, 80, "GBP", "2026-09-20", 10],
      ["PO-700", 1, 10, 300, "EUR", "2026-09-25", 5],
    ]);
    expect(r.currencies).toEqual([
      { currency: "GBP", total: 330, lines: 2, over60: 250, unpriced: 0 },
      { currency: "EUR", total: 300, lines: 1, over60: 0, unpriced: 0 },
    ]);
    expect(r.suppliers).toEqual([
      { supplier: "Northwind", currency: "GBP", orders: ["PO-300"], d30: 80, d60: 0, over60: 250, total: 330 },
      { supplier: "Fabrikam", currency: "EUR", orders: ["PO-700"], d30: 300, d60: 0, over60: 0, total: 300 },
    ]);
  });

  it("is worked out as at the date: later receipts, later invoices and later cancellations do not count", async () => {
    await receive("GR-1", "2026-09-10", "PO-300", 1, 30);
    const late = await receive("GR-2", "2026-10-02", "PO-300", 1, 10);
    await invoice("inv-late", "PO-300", "2026-10-03", [[1, 30]]);
    const r = await report("2026-09-30");
    expect(r.lines.map((l) => [l.orderLine, l.received, l.invoiced, l.notInvoiced])).toEqual([[1, 30, 0, 30]]);
    // Today every invoice and receipt counts: 40 in, 30 invoiced.
    expect((await report("2026-10-31")).lines.map((l) => l.notInvoiced)).toEqual([10]);

    // A receipt cancelled after month-end still counted at month-end.
    await handleCancelGoodsReceipt(env.DB, "u-sam", (late.body as { id: string }).id, { reason: "Wrong order" }, new Date("2026-10-05T12:00:00Z"));
    expect((await report("2026-10-31")).lines).toEqual([]);
    expect((await report("2026-09-30")).lines.map((l) => l.notInvoiced)).toEqual([30]);
  });

  it("takes returns off, leaves out what is fully invoiced, and never goes below nought", async () => {
    await receive("GR-1", "2026-09-01", "PO-300", 1, 30);
    await receive("GR-R", "2026-09-05", "PO-300", 1, 5, "returned");
    await receive("GR-2", "2026-09-01", "PO-300", 2, 50);
    await invoice("inv-1", "PO-300", "2026-09-10", [[2, 60]]);
    const r = await report("2026-09-30");
    expect(r.lines.map((l) => [l.orderLine, l.received, l.returned, l.notInvoiced, l.amount])).toEqual([[1, 30, 5, 25, 250]]);
  });

  it("is scoped by the order's unit, refuses a date that is not one, and gives the journal's CSV", async () => {
    await receive("GR-1", "2026-09-01", "PO-300", 1, 10);
    await receive("GR-4", "2026-09-25", "PO-700", 1, 10);
    expect((await report("2026-09-30", "u-uk")).lines.map((l) => l.orderNumber)).toEqual(["PO-300"]);
    expect((await report("2026-09-30", "u-fin", "fr")).lines.map((l) => l.orderNumber)).toEqual(["PO-700"]);
    expect("error" in (await grniReport(env.DB, "u-fin", null, "30/09/2026"))).toBe(true);

    const csv = grniCsv(await report("2026-09-30"));
    const [head, first] = csv.split("\r\n");
    expect(head).toBe("as_at,org,supplier,supplier_erp_id,order_number,order_line,item,received,returned,invoiced,not_invoiced,unit_price,amount,currency,oldest_receipt_date,days");
    expect(first).toBe("2026-09-30,Acme UK,Northwind,N1,PO-300,1,Bubble wrap,10,0,0,10,10,100,GBP,2026-09-01,29");
  });

  it("is served to AP.Analysis, as JSON or CSV", async () => {
    await receive("GR-1", "2026-09-01", "PO-300", 1, 10);
    const keyOf = async (id: string) => {
      const key = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(key), id).run();
      return key;
    };
    const fin = await keyOf("u-fin");
    const sam = await keyOf("u-sam");
    expect((await SELF.fetch("https://example.com/grni", { headers: { Authorization: `Bearer ${sam}` } })).status).toBe(403);
    const j = await SELF.fetch("https://example.com/grni?asAt=2026-09-30", { headers: { Authorization: `Bearer ${fin}` } });
    expect(((await j.json()) as { currencies: { total: number }[] }).currencies[0].total).toBe(100);
    const c = await SELF.fetch("https://example.com/grni?asAt=2026-09-30&format=csv", { headers: { Authorization: `Bearer ${fin}` } });
    expect(c.headers.get("Content-Disposition")).toBe('attachment; filename="grni-2026-09-30.csv"');
    expect((await c.text()).split("\r\n")).toHaveLength(3);
    expect((await SELF.fetch("https://example.com/grni?asAt=nope", { headers: { Authorization: `Bearer ${fin}` } })).status).toBe(400);
  });
});
