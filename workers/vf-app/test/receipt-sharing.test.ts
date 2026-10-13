import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import {
  handleGetSupplierReceiptSharing,
  handlePutNetworkSharingConfig,
  handlePutSupplierReceiptSharing,
  receiptsSharedWith,
} from "../src/receipt-sharing.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Goods receipts shared with suppliers in the network — decision 0738.**
 * Lager Nord (VAT DE123456789) supplies PO-1 (Acme UK) and PO-2 (Acme
 * Ireland); Other Ltd supplies PO-9 (Acme UK).
 */

// The test keypair whose public half is in wrangler.test.jsonc (see session-routes.test.ts).
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

const get = (path: string, token?: string) => SELF.fetch(`https://app.example.com${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function licence(features: string[]) {
  const claims = { customerId: "c", plan: "standard", features, volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
}


async function receipt(id: string, number: string, date: string, order: string, o: { status?: string; cancelled?: boolean; lines?: [string, number, number, string | null, string | null][] } = {}) {
  await env.DB.prepare(
    "INSERT INTO goods_receipts (id, receipt_number, receipt_date, delivery_note, note, source, created_at, status, cancelled_at, cancel_reason) VALUES (?, ?, ?, ?, 'Pallet wrap torn, driver late', 'screen', ?, ?, ?, ?)"
  )
    .bind(id, number, date, `DN-${number}`, `${date}T09:30:00.000Z`, o.status ?? "registered", o.cancelled ? date : null, o.cancelled ? "Twice" : null)
    .run();
  // [movement, order line, quantity, return reason, line status]
  const lines = o.lines ?? [["received", 1, 10, null, null]];
  for (const [i, [movement, orderLine, quantity, reason, lineStatus]] of lines.entries()) {
    await env.DB.prepare(
      "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, unit_code, return_reason_id, note, line_status, reject_reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'EA', ?, 'Internal note', ?, ?, ?)"
    )
      .bind(`${id}-${i}`, id, i + 1, order, orderLine, movement, quantity, reason, lineStatus ?? "active", lineStatus === "rejected" ? "Wrong colour, Sam to chase" : null, date)
      .run();
  }
}

beforeEach(async () => {
  await applyTestSchema();
  await licence(["supplier_portal"]);
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id, erp_identifier) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE 123 456 789', 'LN-01'), ('sup-x', 'Other Ltd', 'GB999', NULL)").run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, seller_party_id, org_unit_id) VALUES ('po1', 'PO-1', 'DE123456789', 'uk'), ('po2', 'PO-2', 'LN-01', 'ie'), ('po9', 'PO-9', 'GB999', 'uk')"
  ).run();
  await env.DB.prepare("INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, item_name) VALUES ('pl1', 'po1', 1, 10, 'EA', 'Office chair'), ('pl2', 'po1', 2, 10, 'EA', 'Footrest')").run();
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id, created_at) VALUES ('inv-uk', ?, 'sup-ln', 'uk', '2026-10-02 10:00:00')"
  )
    .bind(JSON.stringify({ "BT-1": "LN-1", "BT-5": "GBP", "BT-112": 120, "BT-13": "PO-1" }))
    .run();
  await receipt("gr-1", "GR-1", "2026-10-03", "PO-1", {
    lines: [
      ["received", 1, 10, null, null],
      ["received", 2, 8, null, null],
      ["returned", 1, 2, "damaged", null],
      ["received", 2, 1, null, "rejected"],
    ],
  });
  await receipt("gr-ie", "GR-IE", "2026-10-04", "PO-2");
  await receipt("gr-other", "GR-X", "2026-10-05", "PO-9");
  await receipt("gr-pending", "GR-P", "2026-10-06", "PO-1", { status: "pending" });
  await receipt("gr-cancelled", "GR-C", "2026-10-07", "PO-1", { cancelled: true });
});

type Listed = { invoices: { id: string; documentType: string; invoiceNumber: string; status: string; company: string; purchaseOrder: string | null; total: number | null }[]; receipts: boolean };
const list = async (token: string, q = "") => (await (await get(`/portal/invoices${q}`, token)).json()) as Listed;

describe("whether a supplier sees its receipts", () => {
  it("not until AP Setup or the supplier's own page says so; the supplier's setting wins", async () => {
    expect(await receiptsSharedWith(env.DB, "sup-ln")).toEqual({ shared: false, registeredOnly: true });
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    expect((await receiptsSharedWith(env.DB, "sup-ln")).shared).toBe(true);
    await handlePutSupplierReceiptSharing(env.DB, "u1", "sup-ln", { setting: "none" });
    expect((await receiptsSharedWith(env.DB, "sup-ln")).shared).toBe(false);
    expect((await receiptsSharedWith(env.DB, "sup-x")).shared).toBe(true);
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: false });
    await handlePutSupplierReceiptSharing(env.DB, "u1", "sup-ln", { setting: "share" });
    expect((await receiptsSharedWith(env.DB, "sup-ln")).shared).toBe(true);
    expect((await handleGetSupplierReceiptSharing(env.DB, "sup-ln")).body).toEqual({ setting: "share", apSetup: false });
    // Back to AP Setup's choice.
    await handlePutSupplierReceiptSharing(env.DB, "u1", "sup-ln", { setting: "default" });
    expect((await receiptsSharedWith(env.DB, "sup-ln")).shared).toBe(false);
    expect((await handlePutSupplierReceiptSharing(env.DB, "u1", "sup-ln", { setting: "always" })).status).toBe(400);
    expect((await handlePutSupplierReceiptSharing(env.DB, "u1", "nope", { setting: "share" })).status).toBe(404);
  });
});

describe("receipts in the network's Documents", () => {
  it("none while nothing is shared", async () => {
    const body = await list(await access());
    expect(body.receipts).toBe(false);
    expect(body.invoices.map((i) => i.id)).toEqual(["inv-uk"]);
    expect((await get("/portal/receipts/gr-1", await access())).status).toBe(404);
  });

  it("once shared: this supplier's, for the linked companies, registered and not cancelled, beside its invoices", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    const body = await list(await access());
    expect(body.receipts).toBe(true);
    expect(body.invoices.map((i) => [i.invoiceNumber, i.documentType, i.status])).toEqual([
      ["GR-1", "goods_receipt", "goods_returned"],
      ["LN-1", "invoice", "received"],
    ]);
    expect(body.invoices[0]).toMatchObject({ company: "Acme UK Ltd", purchaseOrder: "PO-1", total: null });
    // Found by its ERP number, in a company the invitation covers.
    const both = await list(await access({ orgUnitIds: ["uk", "ie"] }));
    expect(both.invoices.map((i) => i.invoiceNumber)).toEqual(["GR-IE", "GR-1", "LN-1"]);
  });

  /** Decision 0757: a British supplier with the same digits never sees a German supplier's receipts. */
  it("never another country's supplier with the same digits", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id) VALUES ('sup-gb', 'Same Digits Ltd', 'GB123456789')").run();
    expect((await list(await access({ supplierId: "sup-gb" }))).invoices.filter((i) => i.documentType === "goods_receipt")).toEqual([]);
    expect((await list(await access())).invoices.filter((i) => i.documentType === "goods_receipt").map((i) => i.invoiceNumber)).toEqual(["GR-1"]);
  });

  it("one still being checked, where AP Setup allows it", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true, registeredOnly: false });
    const body = await list(await access());
    expect(body.invoices.filter((i) => i.documentType === "goods_receipt").map((i) => [i.invoiceNumber, i.status])).toEqual([
      ["GR-P", "goods_checking"],
      ["GR-1", "goods_returned"],
    ]);
  });

  it("searches and filters receipts as invoices", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    const token = await access();
    expect((await list(token, "?q=DN-GR-1")).invoices.map((i) => i.invoiceNumber)).toEqual(["GR-1"]);
    expect((await list(token, "?status=goods_returned")).invoices.map((i) => i.invoiceNumber)).toEqual(["GR-1"]);
  });

  it("a receipt opened: line by line, ordered, received, rejected and returned, with the reason from the list, and nothing of the customer's own notes", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    const res = await get("/portal/receipts/gr-1", await access());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { receipt: { invoiceNumber: string; deliveryNote: string; lines: Record<string, unknown>[] } };
    expect(body.receipt).toMatchObject({ invoiceNumber: "GR-1", deliveryNote: "DN-GR-1" });
    expect(body.receipt.lines.map((l) => [l.orderLine, l.item, l.ordered, l.received, l.rejected, l.returned, l.reason])).toEqual([
      [1, "Office chair", 10, 10, 0, 0, null],
      [2, "Footrest", 10, 8, 0, 0, null],
      [1, "Office chair", 10, 0, 0, 2, "Damaged"],
      [2, "Footrest", 10, 0, 1, 0, null],
    ]);
    const said = JSON.stringify(body);
    for (const secret of ["Pallet wrap", "Internal note", "Sam to chase"]) expect(said).not.toContain(secret);
  });

  it("the same 404 for another supplier's, another company's, a cancelled one and none", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareReceipts: true });
    const token = await access();
    const none = await (await get("/portal/receipts/nope", token)).json();
    for (const id of ["gr-other", "gr-ie", "gr-cancelled", "gr-pending"]) {
      const res = await get(`/portal/receipts/${id}`, token);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual(none);
    }
  });
});

async function staff(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const key = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.example`, "Staff", await hashApiKey(key)).run();
  const role = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(role, role, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, role).run();
  return key;
}

const call = (path: string, key: string, method = "GET", body?: unknown) =>
  SELF.fetch(`https://app.example.com${path}`, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

describe("the settings' routes", () => {
  it("AP Setup › Supplier Network needs Admin.Configure, and says how many suppliers have their own setting", async () => {
    const admin = await staff(["Admin.Configure"]);
    expect((await call("/network-sharing-config", await staff(["AP.Review"]))).status).toBe(403);
    await handlePutSupplierReceiptSharing(env.DB, "u1", "sup-x", { setting: "none" });
    const put = await call("/network-sharing-config", admin, "PUT", { shareReceipts: true, registeredOnly: false });
    // Decision 0751: orders' settings ride along, untouched.
    expect(await put.json()).toEqual({ config: { shareReceipts: true, registeredOnly: false, shareOrders: false, ordersFrom: null }, suppliersWithOwn: 1, suppliersWithOwnOrders: 0 });
  });

  it("a supplier's own setting is seen with AP.Supplier and changed with Supplier.Maintain", async () => {
    const viewer = await staff(["AP.Supplier"]);
    const seen = await call("/suppliers/sup-ln/receipt-sharing", viewer);
    expect(await seen.json()).toEqual({ setting: "default", apSetup: false, canManage: false });
    expect((await call("/suppliers/sup-ln/receipt-sharing", viewer, "PUT", { setting: "share" })).status).toBe(403);
    const changed = await call("/suppliers/sup-ln/receipt-sharing", await staff(["Supplier.Maintain"]), "PUT", { setting: "share" });
    expect(await changed.json()).toEqual({ setting: "share", apSetup: false, canManage: true });
  });
});
