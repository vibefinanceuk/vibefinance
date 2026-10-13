import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import { handleGetNetworkSharingConfig, handlePutNetworkSharingConfig } from "../src/receipt-sharing.js";
import { handleGetSupplierOrderSharing, handlePutSupplierOrderSharing, ordersSharedWith, portalOrderStatus } from "../src/order-sharing.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Purchase orders shared with suppliers in the network — decision 0751.**
 * Lager Nord (VAT DE 123 456 789, ERP LN-01) supplies PO-1 (Acme UK, two
 * lines) and PO-2 (Acme Ireland, by its ERP number); Other Ltd supplies
 * PO-9 (Acme UK). Jo at Lager Nord is linked for Acme UK.
 */

const PRIVATE_KEY: JsonWebKey = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "U-Zs04Hy_MlWHr9GlT1gZJgkbxmqFRJmP1VcTUx2Xmg",
  y: "okr43t1WZRRR27D1U_M2Ao18PjA6Fuk19NSuJ0MCijg",
  crv: "P-256",
  d: "meU9gflxUslwDVkLkdadGBdCX1VLlDcg1YDTdbUY3vk",
};

function access(o: Partial<PortalAccessClaims> = {}): Promise<string> {
  const now = new Date();
  return signPortalToken(
    {
      kind: "portal_access",
      email: "jo@lager-nord.example",
      supplierOrgId: "so-1",
      linkId: "pl-1",
      environmentId: "test-environment",
      supplierId: "sup-ln",
      orgUnitIds: ["uk"],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString(),
      ...o,
    },
    PRIVATE_KEY
  );
}
const get = (path: string, token: string) => SELF.fetch(`https://app.example.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
type Listed = { invoices: { id: string; documentType: string; invoiceNumber: string; status: string; company: string; total: number | null; currency: string | null }[]; orders: boolean };
const list = async (token: string, q = "") => (await (await get(`/portal/invoices${q}`, token)).json()) as Listed;
const ordersIn = (l: Listed) => l.invoices.filter((i) => i.documentType === "purchase_order");

beforeEach(async () => {
  await applyTestSchema();
  const claims = { customerId: "c", plan: "standard", features: ["supplier_portal"], volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd'), ('uk-north', 'Acme UK North')").run();
  await env.DB.prepare("UPDATE org_units SET parent_unit_id = 'uk' WHERE id = 'uk-north'").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id, erp_identifier) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE 123 456 789', 'LN-01'), ('sup-x', 'Other Ltd', 'GB999', NULL)").run();
  await env.DB.prepare(
    `INSERT INTO purchase_orders (id, order_number, issue_date, currency, payable_amount, seller_party_id, org_unit_id, status, hold_reason) VALUES
     ('po1', 'PO-1', '2026-10-01', 'EUR', 450, 'DE123456789', 'uk', 'active', NULL),
     ('po2', 'PO-2', '2026-10-02', 'EUR', 90, 'LN-01', 'ie', 'active', NULL),
     ('po3', 'PO-3', '2026-09-01', 'EUR', 50, 'DE123456789', 'uk-north', 'on_hold', 'Budget review, do not tell supplier'),
     ('po9', 'PO-9', '2026-10-03', 'GBP', 10, 'GB999', 'uk', 'active', NULL)`
  ).run();
  await env.DB.prepare(
    `INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, item_name, sellers_item_id, price_amount, line_extension_amount) VALUES
     ('pl1', 'po1', 1, 10, 'EA', 'Office chair', 'LN-CH', 30, 300), ('pl2', 'po1', 2, 10, 'EA', 'Footrest', 'LN-FR', 15, 150)`
  ).run();
});

describe("whether a supplier sees its orders", () => {
  it("not until AP Setup or the supplier's own page says so; the supplier's setting wins", async () => {
    expect(await ordersSharedWith(env.DB, "sup-ln")).toEqual({ shared: false, from: null });
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareOrders: true, ordersFrom: "2026-09-15" });
    expect(await ordersSharedWith(env.DB, "sup-ln")).toEqual({ shared: true, from: "2026-09-15" });
    await handlePutSupplierOrderSharing(env.DB, "u1", "sup-ln", { setting: "none" });
    expect((await ordersSharedWith(env.DB, "sup-ln")).shared).toBe(false);
    expect((await handleGetSupplierOrderSharing(env.DB, "sup-ln")).body).toEqual({ setting: "none", apSetup: true });
    expect((await handleGetNetworkSharingConfig(env.DB)).body).toMatchObject({ config: { shareOrders: true, ordersFrom: "2026-09-15", shareReceipts: false }, suppliersWithOwnOrders: 1 });
    await handlePutSupplierOrderSharing(env.DB, "u1", "sup-ln", { setting: "default" });
    expect((await ordersSharedWith(env.DB, "sup-ln")).shared).toBe(true);
    expect((await handlePutNetworkSharingConfig(env.DB, "u1", { ordersFrom: "15/09/2026" })).body).toMatchObject({ reason: "orders_from_invalid" });
    // Turning orders on leaves receipts as they were, and the other way round.
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    expect((await handleGetNetworkSharingConfig(env.DB)).body).toMatchObject({ config: { shareOrders: true, shareReceipts: true } });
  });
});

describe("in the network", () => {
  it("lists nothing, and says so, until orders are shared", async () => {
    const l = await list(await access());
    expect(ordersIn(l)).toEqual([]);
    expect(l.orders).toBe(false);
  });

  it("lists this supplier's orders for its companies and those beneath, by VAT however written or ERP number", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareOrders: true });
    const uk = await list(await access());
    expect(uk.orders).toBe(true);
    expect(ordersIn(uk).map((o) => [o.invoiceNumber, o.company, o.status, o.total, o.currency])).toEqual([
      ["PO-1", "Acme UK Ltd", "order_open", 450, "EUR"],
      ["PO-3", "Acme UK North", "order_on_hold", 50, "EUR"],
    ]);
    // By ERP number, in Ireland.
    expect(ordersIn(await list(await access({ orgUnitIds: ["ie"] }))).map((o) => o.invoiceNumber)).toEqual(["PO-2"]);
    // Another supplier sees its own, never Lager Nord's.
    expect(ordersIn(await list(await access({ supplierId: "sup-x" }))).map((o) => o.invoiceNumber)).toEqual(["PO-9"]);
  });

  it("only those issued on or after AP Setup's date; searched by number or item; filtered by status", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareOrders: true, ordersFrom: "2026-09-15" });
    const token = await access();
    expect(ordersIn(await list(token)).map((o) => o.invoiceNumber)).toEqual(["PO-1"]);
    expect(ordersIn(await list(token, "?q=footrest")).map((o) => o.invoiceNumber)).toEqual(["PO-1"]);
    expect(ordersIn(await list(token, "?q=nothing")).map((o) => o.invoiceNumber)).toEqual([]);
    expect(ordersIn(await list(token, "?status=order_open")).map((o) => o.invoiceNumber)).toEqual(["PO-1"]);
    expect(ordersIn(await list(token, "?status=order_closed")).map((o) => o.invoiceNumber)).toEqual([]);
  });

  it("opens an order line by line, with received and invoiced, never its hold reason", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareOrders: true });
    await env.DB.prepare("INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_at, status) VALUES ('gr1', 'GR-1', '2026-10-03', 'screen', '2026-10-03T09:00:00Z', 'registered')").run();
    await env.DB.prepare(
      "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, return_reason_id, created_at) VALUES ('g1', 'gr1', 1, 'PO-1', 1, 'received', 10, NULL, '2026-10-03'), ('g2', 'gr1', 2, 'PO-1', 1, 'returned', 2, 'damaged', '2026-10-03'), ('g3', 'gr1', 3, 'PO-1', 2, 'received', 4, NULL, '2026-10-03')"
    ).run();
    const token = await access();
    const res = await get("/portal/orders/po1", token);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { order: Record<string, unknown> & { lines: Record<string, unknown>[] } };
    expect(body.order).toMatchObject({ documentType: "purchase_order", invoiceNumber: "PO-1", issueDate: "2026-10-01", currency: "EUR", total: 450, company: "Acme UK Ltd", status: "order_part_received" });
    expect(body.order.lines).toEqual([
      { lineNumber: 1, item: "Office chair", sellersItemId: "LN-CH", ordered: 10, unitCode: "EA", price: 30, amount: 300, received: 8, invoiced: 0, outstanding: 2, toInvoice: 10 },
      { lineNumber: 2, item: "Footrest", sellersItemId: "LN-FR", ordered: 10, unitCode: "EA", price: 15, amount: 150, received: 4, invoiced: 0, outstanding: 6, toInvoice: 10 },
    ]);
    // Decision 0755: invoiced to the company the link covers it by.
    expect(body.order).toMatchObject({ receiptingRequired: false, invoiceCompanyId: "uk" });
    const held = JSON.stringify(await (await get("/portal/orders/po3", token)).json());
    expect(held).toContain("order_on_hold");
    expect(held).not.toContain("Budget review");
    // Not this supplier's, not its companies', or not there: the same 404.
    const none = await get("/portal/orders/nope", token);
    expect(none.status).toBe(404);
    expect((await get("/portal/orders/po9", token)).status).toBe(404);
    expect((await get("/portal/orders/po2", token)).status).toBe(404);
    expect(await (await get("/portal/orders/po9", token)).json()).toEqual(await none.json());
  });

  /**
   * **Invoice this order — decision 0755**: what is still to invoice, line
   * by line — received and not yet invoiced where the supplier's goods are
   * receipted (three-way), ordered and not yet invoiced otherwise — and the
   * company it is invoiced to, the one above an operating unit.
   */
  it("says what is still to invoice on each line, and the company it is invoiced to", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareOrders: true });
    await env.DB.prepare("INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_at, status) VALUES ('gr1', 'GR-1', '2026-10-03', 'screen', '2026-10-03T09:00:00Z', 'registered')").run();
    await env.DB.prepare(
      "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, return_reason_id, created_at) VALUES ('g1', 'gr1', 1, 'PO-1', 1, 'received', 10, NULL, '2026-10-03'), ('g2', 'gr1', 2, 'PO-1', 1, 'returned', 2, 'damaged', '2026-10-03'), ('g3', 'gr1', 3, 'PO-1', 2, 'received', 4, NULL, '2026-10-03')"
    ).run();
    // 3 chairs already invoiced.
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES ('inv-1', json_object('BT-1', 'LN-77', 'BT-13', 'PO-1'), 'uk')").run();
    await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-1', 1, json_object('BT-129', 3, 'BT-132', '1', 'BT-146', 30))").run();
    const token = await access();
    const toInvoice = async (id: string) => ((await (await get(`/portal/orders/${id}`, token)).json()) as { order: { lines: { toInvoice: number }[] } }).order.lines.map((l) => l.toInvoice);
    const invoiced = ((await (await get("/portal/orders/po1", token)).json()) as { order: { lines: { invoiced: number }[] } }).order.lines.map((l) => l.invoiced);
    expect(invoiced).toEqual([3, 0]);
    // Two-way: what was ordered, less what was invoiced.
    expect(await toInvoice("po1")).toEqual([7, 10]);
    // Three-way: what was received (net of returns), less what was invoiced.
    await env.DB.prepare("UPDATE suppliers SET match_option = 'three_way', vat_id = 'DE123456789' WHERE id = 'sup-ln'").run();
    expect(await toInvoice("po1")).toEqual([5, 4]);
    // An order of an operating unit is invoiced to the company above it, the one the link covers.
    await env.DB.prepare("UPDATE purchase_orders SET status = 'active' WHERE id = 'po3'").run();
    expect(((await (await get("/portal/orders/po3", token)).json()) as { order: { invoiceCompanyId: string; orgUnitId: string } }).order).toMatchObject({ orgUnitId: "uk-north", invoiceCompanyId: "uk" });
  });

  it("says where an order has got to: hold and close first, then invoicing, then receiving", () => {
    expect(portalOrderStatus("closed", "fully_received")).toBe("order_closed");
    expect(portalOrderStatus("on_hold", null)).toBe("order_on_hold");
    expect(portalOrderStatus("invoiced_full", "partially_received")).toBe("order_invoiced");
    expect(portalOrderStatus("invoiced_part", null)).toBe("order_part_invoiced");
    expect(portalOrderStatus("active", "over_received")).toBe("order_received");
    expect(portalOrderStatus("active", "partially_received")).toBe("order_part_received");
    expect(portalOrderStatus("active", null)).toBe("order_open");
  });
});

describe("the supplier's own setting, through the router", () => {
  it("is read with AP.Supplier and changed with Supplier.Maintain", async () => {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-a', 'a@x.com', 'Ann'), ('u-m', 'm@x.com', 'Max')").run();
    await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('ra', 'ra', '["AP.Supplier"]'), ('rm', 'rm', '["Supplier.Maintain"]')`).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-a', 'ra'), ('u-m', 'rm')").run();
    const key = async (id: string) => {
      const k = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(k), id).run();
      return k;
    };
    const [ann, max] = [await key("u-a"), await key("u-m")];
    const call = (k: string, method = "GET", body?: unknown) =>
      SELF.fetch("https://app.example.com/suppliers/sup-ln/order-sharing", { method, headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    expect(await (await call(ann)).json()).toEqual({ setting: "default", apSetup: false, canManage: false });
    expect((await call(ann, "PUT", { setting: "share" })).status).toBe(403);
    expect(await (await call(max, "PUT", { setting: "share" })).json()).toEqual({ setting: "share", apSetup: false, canManage: true });
    expect((await ordersSharedWith(env.DB, "sup-ln")).shared).toBe(true);
  });
});
