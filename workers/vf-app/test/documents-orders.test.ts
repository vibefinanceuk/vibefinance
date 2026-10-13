import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleListDocuments } from "../src/documents-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Purchase orders as rows of Documents — decision 0769**, as goods
 * receipts are (0737). Two invoices, a receipt, and three orders: PO-1 for
 * Acme UK from Northwind, PO-2 for Acme France, PO-3 on hold.
 */

type Doc = { id: string; kind: string; number: string; status: string; supplier: string | null; amount: number | null; currency: string | null; issueDate: string | null; receivedAt: string; orgUnitName: string | null; po: string | null; hands: number };
type Body = { documents: Doc[]; total?: number; receipts?: boolean; orders?: boolean };

const EVERYWHERE = { units: null };

async function list(params: string, orders: { units: string[] | null } | null = EVERYWHERE, receipts: { units: string[] | null } | null = EVERYWHERE) {
  return (await handleListDocuments(env.DB, new URLSearchParams(params), null, "u1", receipts, orders)).body as Body;
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('uk', 'Acme UK', 'operating_unit'), ('fr', 'Acme France', 'operating_unit')").run();
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, match_option, loaded_at) VALUES ('northwind', 'N1', 'Northwind Packaging', 'GB111', 'active', 'two_way', datetime('now'))"
  ).run();
  await env.DB.prepare(
    `INSERT INTO purchase_orders (id, order_number, issue_date, currency, payable_amount, seller_party_id, org_unit_id, originator_reference, status, created_at) VALUES
     ('po1', 'PO-1', '2026-10-01', 'GBP', 240, 'GB111', 'uk', 'REQ-9', 'active', '2026-10-02 09:00:00'),
     ('po2', 'PO-2', '2026-10-03', 'EUR', 90, 'FR222', 'fr', NULL, 'active', '2026-10-04 09:00:00'),
     ('po3', 'PO-3', '2026-10-05', 'GBP', 50, 'GB111', 'uk', NULL, 'on_hold', '2026-10-06 09:00:00')`
  ).run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, created_at, org_unit_id) VALUES ('inv-1', ?, '2026-10-01 09:00:00', 'uk'), ('inv-2', ?, '2026-10-05 09:00:00', 'uk')")
    .bind(JSON.stringify({ "BT-1": "INV-1", "BT-3": "380", "BT-27": "Northwind Packaging", "BT-112": 240, "BT-5": "GBP", "BT-13": "PO-1" }), JSON.stringify({ "BT-1": "INV-2", "BT-3": "380", "BT-112": 10, "BT-5": "GBP" }))
    .run();
  await env.DB.prepare("INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_at, status) VALUES ('gr-1', 'GR-1', '2026-10-03', 'screen', '2026-10-03T10:00:00.000Z', 'registered')").run();
  await env.DB.prepare("INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, created_at) VALUES ('gr-1-1', 'gr-1', 1, 'PO-1', 1, 'received', 2, '2026-10-03')").run();
});

describe("purchase orders beside invoices and receipts (decision 0769)", () => {
  it("interleaves them newest first in All, an order by when it was loaded", async () => {
    const body = await list("page=1&pageSize=25");
    expect(body.orders).toBe(true);
    expect(body.total).toBe(6);
    expect(body.documents.map((d) => d.number)).toEqual(["PO-3", "INV-2", "PO-2", "GR-1", "PO-1", "INV-1"]);
  });

  it("an order's row: its supplier, amount, dates and company, and where it has got to in the supplier network's words", async () => {
    const docs = (await list("page=1&pageSize=25&type=purchase_order")).documents;
    expect(docs.find((d) => d.number === "PO-1")).toMatchObject({
      kind: "purchase_order",
      supplier: "Northwind Packaging",
      amount: 240,
      currency: "GBP",
      issueDate: "2026-10-01",
      receivedAt: "2026-10-02 09:00:00",
      orgUnitName: "Acme UK",
      po: "PO-1",
      hands: 0,
      // Invoiced in full (240 of 240).
      status: "order_invoiced",
    });
    expect(Object.fromEntries(docs.map((d) => [d.number, d.status]))).toMatchObject({ "PO-2": "order_open", "PO-3": "order_on_hold" });
    // A supplier not on file: the party the order names.
    expect(docs.find((d) => d.number === "PO-2")!.supplier).toBe("FR222");
  });

  it("filters to orders alone, and leaves them out of invoices and receipts", async () => {
    const orders = await list("page=1&pageSize=25&type=purchase_order");
    expect(orders.documents.map((d) => d.number)).toEqual(["PO-3", "PO-2", "PO-1"]);
    expect(orders.total).toBe(3);
    expect((await list("page=1&pageSize=25&type=invoice")).documents.map((d) => d.number)).toEqual(["INV-2", "INV-1"]);
    expect((await list("page=1&pageSize=25&type=goods_receipt")).documents.map((d) => d.number)).toEqual(["GR-1"]);
  });

  it("searches an order by its number, requisition or supplier", async () => {
    expect((await list("page=1&pageSize=25&type=purchase_order&q=PO-2")).documents.map((d) => d.number)).toEqual(["PO-2"]);
    expect((await list("page=1&pageSize=25&type=purchase_order&q=REQ-9")).documents.map((d) => d.number)).toEqual(["PO-1"]);
    expect((await list("page=1&pageSize=25&type=purchase_order&q=Northwind")).documents.map((d) => d.number)).toEqual(["PO-3", "PO-1"]);
  });

  it("narrows orders to the unit chosen, and to the units the person may read orders in", async () => {
    expect((await list("page=1&pageSize=25&type=purchase_order&unit=fr")).documents.map((d) => d.number)).toEqual(["PO-2"]);
    expect((await list("page=1&pageSize=25&type=purchase_order", { units: ["uk"] })).documents.map((d) => d.number)).toEqual(["PO-3", "PO-1"]);
    expect((await list("page=1&pageSize=25", { units: [] })).documents.every((d) => d.kind !== "purchase_order")).toBe(true);
  });

  it("shows none to someone who may not read orders, nor to the AP Assistant, nor under a card's drill-through; and pages with no receipts", async () => {
    const none = await list("page=1&pageSize=25", null);
    expect(none.orders).toBe(false);
    expect(none.documents.every((d) => d.kind !== "purchase_order")).toBe(true);
    expect((await list("page=1&pageSize=25&type=purchase_order", null)).documents).toEqual([]);
    expect((await list("limit=50")).documents.every((d) => d.kind !== "purchase_order")).toBe(true);
    expect((await list("page=1&pageSize=25&duplicates=1")).documents.every((d) => d.kind !== "purchase_order")).toBe(true);
    // Orders without receipts: invoices and orders, paged together.
    const page1 = await list("page=1&pageSize=3", EVERYWHERE, null);
    const page2 = await list("page=2&pageSize=3", EVERYWHERE, null);
    expect(page1.total).toBe(5);
    expect([...page1.documents, ...page2.documents].map((d) => d.number)).toEqual(["PO-3", "INV-2", "PO-2", "PO-1", "INV-1"]);
  });
});

async function personWith(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)").bind(id, `${id}@example.com`, "Someone", await hashApiKey(apiKey)).run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(roleId, roleId, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();
  return apiKey;
}

describe("GET /documents, who sees orders (decision 0769)", () => {
  const get = async (key: string) =>
    (await (await SELF.fetch("https://example.com/documents?page=1&pageSize=25", { headers: { Authorization: `Bearer ${key}` } })).json()) as Body;

  it("someone who validates or works orders sees them; someone who only reviews does not", async () => {
    const validator = await get(await personWith(["AP.Review", "AP.Validate"]));
    expect(validator.orders).toBe(true);
    expect(validator.documents.filter((d) => d.kind === "purchase_order")).toHaveLength(3);
    const purchasing = await get(await personWith(["AP.Review", "AP.Purchasing"]));
    expect(purchasing.documents.filter((d) => d.kind === "purchase_order")).toHaveLength(3);
    const reviewer = await get(await personWith(["AP.Review"]));
    expect(reviewer.orders).toBe(false);
    expect(reviewer.documents.every((d) => d.kind !== "purchase_order")).toBe(true);
  });
});
