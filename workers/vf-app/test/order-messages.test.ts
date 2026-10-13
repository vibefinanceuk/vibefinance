import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import { handleGetOrderSupplierMessages, handlePortalOrderReply, handlePostOrderSupplierMessage, orderConversationsFor } from "../src/order-messages.js";
import { handlePutNetworkSharingConfig } from "../src/receipt-sharing.js";
import type { MessageEmail } from "../src/supplier-messages.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **The conversation with a supplier about a purchase order — decision
 * 0752.** PO-1 (Acme UK, Lager Nord) was bought by Bea; Pat holds
 * AP.Purchasing for Acme UK, Fran for Acme Ireland, Kim everywhere; Val
 * only reads orders (AP.Validate).
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
const PAT = { id: "u-pat", name: "Pat Lee" };
const CLAIMS = { supplierId: "sup-ln", orgUnitIds: ["uk"], linkId: "pl-1", email: "jo@lager-nord.example" } as PortalAccessClaims;

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
const listed = async () => ((await (await portal("/portal/invoices")).json()) as { invoices: { id: string; status: string; messages: { total: number; unread: number } }[] }).invoices.find((i) => i.id === "po1")!;

async function person(id: string, name: string, unit: string | null, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id.slice(2)}@acme.example`, name).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, `r-${id}`, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

beforeEach(async () => {
  await applyTestSchema();
  const claims = { customerId: "c", plan: "standard", features: ["supplier_portal"], volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await person("u-bea", "Bea Buyer", "uk", ["AP.Validate"]);
  await person("u-pat", "Pat Lee", "uk", ["AP.Purchasing"]);
  await person("u-fran", "Fran Ode", "ie", ["AP.Purchasing"]);
  await person("u-kim", "Kim Roe", null, ["AP.Purchasing"]);
  await person("u-val", "Val Viewer", null, ["AP.Validate"]);
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE123456789')").run();
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, issue_date, currency, payable_amount, seller_party_id, org_unit_id, buyer_user_id) VALUES ('po1', 'PO-1', '2026-10-01', 'EUR', 100, 'DE 123 456 789', 'uk', 'u-bea')"
  ).run();
  await env.DB.prepare("INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, item_name, price_amount) VALUES ('l1', 'po1', 1, 10, 'EA', 'Chair', 10)").run();
});

describe("Purchasing writes", () => {
  it("only while the order is shared: nobody to write to before, the supplier's people for its company after", async () => {
    expect((await handleGetOrderSupplierMessages(env.DB, licence(), "PO-1")).body).toMatchObject({ available: false, canWrite: false });
    expect((await handlePostOrderSupplierMessage(env.DB, licence(), "PO-1", PAT, { body: "Hello" }, NO_EMAIL)).status).toBe(409);
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareOrders: true });
    expect((await handleGetOrderSupplierMessages(env.DB, licence(), "PO-1")).body).toMatchObject({ canWrite: true, recipients: ["jo@lager-nord.example"], supplierName: "Lager Nord GmbH" });
    const sent = await handlePostOrderSupplierMessage(env.DB, licence(), "PO-1", PAT, { body: "Can you deliver on the 20th?" }, NO_EMAIL);
    expect(sent.status).toBe(201);
    expect((sent.body as { message: Record<string, unknown> }).message).toMatchObject({ emailed: ["jo@lager-nord.example"], emailError: "email sending is not configured for this deployment" });
    // Not before AP Setup's date.
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { ordersFrom: "2026-10-05" });
    expect((await handleGetOrderSupplierMessages(env.DB, licence(), "PO-1")).body).toMatchObject({ available: true, canWrite: false });
  });

  it("Ask supplier: Query raised in the network and the question here, until the supplier writes back", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareOrders: true });
    expect((await listed()).status).toBe("order_open");
    await handlePostOrderSupplierMessage(env.DB, licence(), "PO-1", PAT, { body: "Is the price still 10?", ask: true, lines: [1] }, NO_EMAIL, new Date("2026-10-12T10:00:00Z"));
    expect((await handleGetOrderSupplierMessages(env.DB, licence(), "PO-1")).body).toMatchObject({
      awaiting: true,
      query: { supplierName: "Lager Nord GmbH", askedBy: "Pat Lee", askedAt: "2026-10-12T10:00:00.000Z" },
      messages: [{ kind: "question", lines: [1] }],
    });
    expect(await listed()).toMatchObject({ status: "query_raised", messages: { total: 1, unread: 1 } });
    // Opened in the network: read, with the conversation.
    const opened = (await (await portal("/portal/orders/po1")).json()) as { order: { messages: { from: string; body: string; kind: string }[] } };
    expect(opened.order.messages).toEqual([expect.objectContaining({ from: "customer", body: "Is the price still 10?", kind: "question" })]);
    expect((await listed()).messages).toEqual({ total: 1, unread: 0 });
    // The supplier answers.
    const res = await portal("/portal/orders/po1/messages", { method: "POST", body: JSON.stringify({ body: "Yes, 10 until December." }) });
    expect(res.status).toBe(201);
    expect((await handleGetOrderSupplierMessages(env.DB, licence(), "PO-1")).body).toMatchObject({ awaiting: false, query: null });
    expect((await listed()).status).toBe("order_open");
  });
});

describe("the supplier writes, in the network", () => {
  it("the buyer, Purchasing for its company and above, and whoever last wrote are told; never Purchasing elsewhere", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareOrders: true });
    await handlePortalOrderReply(env.DB, CLAIMS, "po1", { body: "Delivery moves to the 22nd." }, NO_EMAIL);
    const row = await env.DB.prepare("SELECT order_number, direction, emailed_json FROM purchase_order_messages").first<{ order_number: string; direction: string; emailed_json: string }>();
    expect(row).toMatchObject({ order_number: "PO-1", direction: "from_supplier" });
    expect(JSON.parse(row!.emailed_json)).toEqual(["bea@acme.example", "kim@acme.example", "pat@acme.example"]);
  });

  it("not on an order not shared with them, with the same 404 as none; an empty message is refused", async () => {
    const none = await portal("/portal/orders/nope/messages", { method: "POST", body: JSON.stringify({ body: "Hi" }) });
    expect(none.status).toBe(404);
    expect(await handlePortalOrderReply(env.DB, CLAIMS, "po1", { body: "Hi" }, NO_EMAIL)).toEqual({ status: 404, body: await none.json() });
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareOrders: true });
    expect((await handlePortalOrderReply(env.DB, CLAIMS, "po1", { body: " " }, NO_EMAIL)).status).toBe(400);
  });
});

describe("in Conversations, for whoever it was emailed to", () => {
  it("until they open the order's conversation or say Done; it comes back with the next message", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareOrders: true });
    await handlePortalOrderReply(env.DB, CLAIMS, "po1", { body: "Delivery moves to the 22nd." }, NO_EMAIL, new Date("2026-10-12T10:00:00Z"));
    expect(await orderConversationsFor(env.DB, "u-pat")).toEqual([
      expect.objectContaining({ kind: "order", orderNumber: "PO-1", organisation: "Acme UK Ltd", supplier: "Lager Nord GmbH", newMessages: 1, latest: expect.objectContaining({ by: "Lager Nord GmbH", body: "Delivery moves to the 22nd." }) }),
    ]);
    expect(await orderConversationsFor(env.DB, "u-fran")).toEqual([]);
    // Reading the conversation catches up.
    await handleGetOrderSupplierMessages(env.DB, licence(), "PO-1", "u-pat");
    expect(await orderConversationsFor(env.DB, "u-pat")).toEqual([]);
    await handlePortalOrderReply(env.DB, CLAIMS, "po1", { body: "And 2 short." }, NO_EMAIL, new Date(Date.now() + 60_000));
    expect((await orderConversationsFor(env.DB, "u-pat")).map((c) => c.latest?.body)).toEqual(["And 2 short."]);
  });

  it("through the router: beside receipts on /receipt-conversations, Done by /seen, and only Purchasing writes", async () => {
    await handlePutNetworkSharingConfig(env.DB, "u-kim", { shareOrders: true });
    await handlePortalOrderReply(env.DB, CLAIMS, "po1", { body: "Delivery moves to the 22nd." }, NO_EMAIL);
    const key = async (id: string) => {
      const k = generateApiKey();
      await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = ?").bind(await hashApiKey(k), id).run();
      return k;
    };
    const [pat, val] = [await key("u-pat"), await key("u-val")];
    const call = (k: string, path: string, method = "GET", body?: unknown) =>
      SELF.fetch(`https://app.example.com${path}`, { method, headers: { Authorization: `Bearer ${k}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const convs = (await (await call(pat, "/receipt-conversations")).json()) as { conversations: { kind?: string; orderNumber?: string }[] };
    expect(convs.conversations).toEqual([expect.objectContaining({ kind: "order", orderNumber: "PO-1" })]);
    expect((await call(pat, "/purchase-orders/PO-1/supplier-messages/seen", "POST")).status).toBe(200);
    expect(((await (await call(pat, "/receipt-conversations")).json()) as { conversations: unknown[] }).conversations).toEqual([]);
    // Pat (AP.Purchasing only) opens the order itself, to see the conversation on it; Fran, in Ireland, may not.
    expect((await call(pat, "/purchase-orders/PO-1")).status).toBe(200);
    const fran = await key("u-fran");
    expect((await call(fran, "/purchase-orders/PO-1")).status).toBe(404);
    // Val may read the conversation, not write it.
    expect((await call(val, "/purchase-orders/PO-1/supplier-messages")).status).toBe(200);
    expect((await call(val, "/purchase-orders/PO-1/supplier-messages", "POST", { body: "Hi" })).status).toBe(403);
  });
});
