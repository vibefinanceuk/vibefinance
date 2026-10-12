import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import { handleGetReceiptSupplierMessages, handlePortalReceiptReply, handlePostReceiptSupplierMessage } from "../src/receipt-messages.js";
import { handlePutNetworkSharingConfig, handlePutSupplierReceiptSharing } from "../src/receipt-sharing.js";
import type { MessageEmail } from "../src/supplier-messages.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **The conversation with a supplier about a goods receipt — decision
 * 0740.** GR-1 (Acme UK, PO-1, Lager Nord) recorded by Sam; Pat receives
 * goods for Acme UK, Fran for Acme Ireland, Kim everywhere.
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

const PEOPLE = {
  links: [
    { id: "pl-1", email: "jo@lager-nord.example", status: "active", orgUnits: [{ id: "uk", name: "Acme UK Ltd" }] },
    { id: "pl-2", email: "kim@lager-nord.example", status: "active", orgUnits: [{ id: "ie", name: "Acme Ireland Ltd" }] },
  ],
  invitations: [],
};
const licence = () => ({ service: { fetch: async () => Response.json(PEOPLE) } as unknown as Fetcher, environmentId: "test-environment", apiKey: "k" });
const NO_EMAIL: MessageEmail = { apiKey: null, from: null, networkUrl: "https://network.example", appUrl: "https://app.example" };
const SAM = { id: "u-sam", name: "Sam Patel" };

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
const portal = async (path: string, init: RequestInit = {}) =>
  SELF.fetch(`https://app.example.com${path}`, { ...init, headers: { Authorization: `Bearer ${await access()}`, "Content-Type": "application/json" } });
const CLAIMS = { supplierId: "sup-ln", orgUnitIds: ["uk"], linkId: "pl-1", email: "jo@lager-nord.example" } as PortalAccessClaims;

async function person(id: string, name: string, unit: string | null, permissions = ["AP.Receive"]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id.slice(2)}@acme.example`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, `r-${id}`, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

beforeEach(async () => {
  await applyTestSchema();
  const claims = { customerId: "c", plan: "standard", features: ["supplier_portal"], volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await person("u-sam", "Sam Patel", "uk", ["AP.Validate"]);
  await person("u-pat", "Pat Lee", "uk");
  await person("u-fran", "Fran Ode", "ie");
  await person("u-kim", "Kim Roe", null);
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE123456789')").run();
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, seller_party_id, org_unit_id) VALUES ('po1', 'PO-1', 'DE 123 456 789', 'uk')").run();
  await env.DB.prepare(
    "INSERT INTO goods_receipts (id, receipt_number, receipt_date, source, created_by, created_at, status) VALUES ('gr-1', 'GR-1', '2026-10-09', 'screen', 'u-sam', '2026-10-09T09:00:00Z', 'registered')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO goods_receipt_lines (id, receipt_id, line_number, order_number, order_line_number, movement, quantity, created_at) VALUES ('l1', 'gr-1', 1, 'PO-1', 1, 'received', 8, '2026-10-09')"
  ).run();
});

describe("the warehouse writes", () => {
  it("only while the receipt is shared: nobody to write to before, the supplier's people for its company after", async () => {
    const before = (await handleGetReceiptSupplierMessages(env.DB, licence(), "gr-1")).body as { available: boolean; canWrite: boolean };
    expect(before).toMatchObject({ available: false, canWrite: false });
    expect((await handlePostReceiptSupplierMessage(env.DB, licence(), "gr-1", SAM, { body: "Hello" }, NO_EMAIL)).status).toBe(409);
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareReceipts: true });
    const after = (await handleGetReceiptSupplierMessages(env.DB, licence(), "gr-1")).body as { canWrite: boolean; recipients: string[]; supplierName: string };
    expect(after).toMatchObject({ canWrite: true, recipients: ["jo@lager-nord.example"], supplierName: "Lager Nord GmbH" });
    const sent = await handlePostReceiptSupplierMessage(env.DB, licence(), "gr-1", SAM, { body: "Two footrests are on a second pallet." }, NO_EMAIL);
    expect(sent.status).toBe(201);
    expect((sent.body as { message: { emailed: string[]; emailError: string } }).message).toMatchObject({ emailed: ["jo@lager-nord.example"], emailError: "email sending is not configured for this deployment" });
  });

  it("not for a supplier whose own setting says don't share; a conversation already had stays here", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareReceipts: true });
    await handlePostReceiptSupplierMessage(env.DB, licence(), "gr-1", SAM, { body: "Photos attached." }, NO_EMAIL);
    await handlePutSupplierReceiptSharing(env.DB, "u-kim", "sup-ln", { setting: "none" });
    const r = (await handleGetReceiptSupplierMessages(env.DB, licence(), "gr-1")).body as { available: boolean; canWrite: boolean; messages: unknown[] };
    expect(r).toMatchObject({ available: true, canWrite: false });
    expect(r.messages).toHaveLength(1);
    expect((await portal("/portal/receipts/gr-1")).status).toBe(404);
  });
});

describe("the supplier writes, in the network", () => {
  it("on a receipt shared with them; who recorded it, who receives goods for its company and who last wrote are emailed", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareReceipts: true });
    const res = await portal("/portal/receipts/gr-1/messages", { method: "POST", body: JSON.stringify({ body: "We sent 10 footrests, you recorded 8?" }) });
    expect(res.status).toBe(201);
    const row = await env.DB.prepare("SELECT receipt_id, invoice_id, direction, emailed_json FROM supplier_messages").first<{ receipt_id: string; invoice_id: string | null; direction: string; emailed_json: string }>();
    expect(row).toMatchObject({ receipt_id: "gr-1", invoice_id: null, direction: "from_supplier" });
    // Sam recorded it; Pat receives for Acme UK; Kim everywhere; never Fran (Acme Ireland).
    expect(JSON.parse(row!.emailed_json)).toEqual(["kim@acme.example", "pat@acme.example", "sam@acme.example"]);
    const app = (await handleGetReceiptSupplierMessages(env.DB, licence(), "gr-1")).body as { messages: { direction: string; authorEmail: string }[] };
    expect(app.messages).toEqual([expect.objectContaining({ direction: "from_supplier", authorEmail: "jo@lager-nord.example" })]);
  });

  it("not on a receipt that is not shared with them, with the same 404 as none", async () => {
    const none = await portal("/portal/receipts/nope/messages", { method: "POST", body: JSON.stringify({ body: "Hi" }) });
    const hidden = await handlePortalReceiptReply(env.DB, CLAIMS, "gr-1", { body: "Hi" }, NO_EMAIL);
    expect(none.status).toBe(404);
    expect(hidden).toEqual({ status: 404, body: await none.json() });
    expect((await handlePortalReceiptReply(env.DB, CLAIMS, "gr-1", { body: " " }, NO_EMAIL)).status).toBe(400);
  });

  it("the list counts what the customer has written since this person last opened it; opening it reads them", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareReceipts: true });
    await handlePostReceiptSupplierMessage(env.DB, licence(), "gr-1", SAM, { body: "Photos attached." }, NO_EMAIL);
    await handlePostReceiptSupplierMessage(env.DB, licence(), "gr-1", SAM, { body: "And one more." }, NO_EMAIL);
    const list = async () =>
      ((await (await portal("/portal/invoices")).json()) as { invoices: { id: string; messages: { total: number; unread: number } }[] }).invoices.find((i) => i.id === "gr-1")!;
    expect((await list()).messages).toEqual({ total: 2, unread: 2 });
    const opened = (await (await portal("/portal/receipts/gr-1")).json()) as { receipt: { messages: { from: string; body: string; authorName: string | null }[] } };
    expect(opened.receipt.messages.map((m) => [m.from, m.body, m.authorName])).toEqual([
      ["customer", "Photos attached.", null],
      ["customer", "And one more.", null],
    ]);
    expect((await list()).messages).toEqual({ total: 2, unread: 0 });
  });
});

describe("the app's route", () => {
  it("read by whoever may see receipts, written only by whoever receives goods", async () => {
    const key = async (permissions: string[]) => {
      const id = crypto.randomUUID();
      const k = generateApiKey();
      await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.example`, "Someone", await hashApiKey(k)).run();
      await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, `r-${id}`, JSON.stringify(permissions)).run();
      await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, `r-${id}`).run();
      return k;
    };
    const call = (k: string, method = "GET") =>
      SELF.fetch("https://app.example.com/goods-receipts/gr-1/supplier-messages", {
        method,
        headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ body: "Hello" }) } : {}),
      });
    const validator = await key(["AP.Validate"]);
    expect((await call(validator)).status).toBe(200);
    expect((await call(validator, "POST")).status).toBe(403);
    expect((await call(await key(["AP.Review"]))).status).toBe(403);
    // Allowed to write; nobody to write to while it is not shared.
    expect((await call(await key(["AP.Receive"]), "POST")).status).toBe(409);
  });
});
