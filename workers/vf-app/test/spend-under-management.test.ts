import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSpendUnderManagement, type SpendUnderManagementReport } from "../src/spend-under-management-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Spend under management (with PO) vs. total spend — decision 0419,
 * Financial Performance's second real metric.
 *
 * **Two kinds of test here**, the same split every other analysis
 * route's own test file already uses: the permission gate proven
 * through a real `SELF.fetch`, everything about what the data
 * actually says — with-PO classification, currency-splitting,
 * percentage — calling `handleSpendUnderManagement` directly against
 * the test DB.
 */

async function seedActiveLicence(): Promise<void> {
  const claims = {
    customerId: "test-customer",
    plan: "standard",
    features: [],
    volumeEntitlement: 10000,
    status: "active",
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
  };
  await env.DB.prepare("INSERT INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)")
    .bind(JSON.stringify(claims), new Date().toISOString())
    .run();
}

async function seedUserWithPermissions(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Limited User", hash)
    .run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(roleId, "Limited Role", JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();
  return apiKey;
}

async function units() {
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme DE', 'legal_entity')"
  ).run();
}

/** A person who may show up as the viewer calling the route. */
async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, id)
    .run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)")
    .bind(id, `r-${id}`, unit)
    .run();
}

let seq = 0;

/** A purchase order this system actually holds — the thing an invoice's own BT-13 can resolve against. */
async function purchaseOrder(orderNumber: string) {
  const id = `po-${seq++}`;
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number) VALUES (?, ?)").bind(id, orderNumber).run();
}

/** An invoice, optionally naming a purchase order via BT-13 (whether or not that order actually exists here). */
async function invoice(opts: {
  total: number | null;
  currency: string | null;
  orderNumber?: string;
  unit?: string | null;
}) {
  const n = seq++;
  const id = `inv-${n}`;
  const factsJson = opts.orderNumber ? JSON.stringify({ "BT-13": opts.orderNumber }) : "{}";
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, total_with_vat, currency, org_unit_id) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, factsJson, opts.total, opts.currency, opts.unit ?? null)
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the spend-under-management route's own permission gate (decision 0419)", () => {
  it("GET /spend/under-management succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/spend/under-management", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /spend/under-management 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/spend/under-management");
    expect(res.status).toBe(401);
  });

  it("GET /spend/under-management 403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch("https://example.com/spend/under-management", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("what counts as 'with PO' (decision 0419)", () => {
  it("counts an invoice whose BT-13 resolves to a real purchase order", async () => {
    await purchaseOrder("PO-1");
    await invoice({ total: 100, currency: "GBP", orderNumber: "PO-1" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies[0]).toMatchObject({ totalSpend: 100, withPoSpend: 100, percentWithPo: 100 });
  });

  it("does not count an invoice with no BT-13 at all", async () => {
    await invoice({ total: 100, currency: "GBP" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies[0]).toMatchObject({ totalSpend: 100, withPoSpend: 0, percentWithPo: 0 });
  });

  it("does not count an invoice naming an order this system has not stored yet — not merely deprioritised, the same 'nothing to check against' reasoning po-matching.ts already gives", async () => {
    await invoice({ total: 100, currency: "GBP", orderNumber: "PO-NEVER-ARRIVED" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies[0]).toMatchObject({ totalSpend: 100, withPoSpend: 0, percentWithPo: 0 });
  });

  it("is empty, not an error, when there is no spend at all", async () => {
    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies).toEqual([]);
  });

  it("counts totalCount and withPoCount as invoice counts, not amounts", async () => {
    await purchaseOrder("PO-1");
    await invoice({ total: 100, currency: "GBP", orderNumber: "PO-1" });
    await invoice({ total: 50, currency: "GBP" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies[0]).toMatchObject({ totalCount: 2, withPoCount: 1 });
  });
});

describe("never summed across currencies (decision 0419, following 0416/0417's own discipline)", () => {
  it("gives a single currency its own total and its own percentage", async () => {
    await purchaseOrder("PO-1");
    await invoice({ total: 100, currency: "GBP", orderNumber: "PO-1" });
    await invoice({ total: 300, currency: "GBP" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0]).toMatchObject({ currency: "GBP", totalSpend: 400, withPoSpend: 100, percentWithPo: 25 });
  });

  it("splits a multi-currency report into one figure per currency, never one blended total or percentage", async () => {
    await purchaseOrder("PO-GBP");
    await purchaseOrder("PO-EUR");
    await invoice({ total: 1000, currency: "GBP", orderNumber: "PO-GBP" });
    await invoice({ total: 1000, currency: "GBP" });
    await invoice({ total: 500, currency: "EUR", orderNumber: "PO-EUR" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    const gbp = body.currencies.find((c) => c.currency === "GBP");
    const eur = body.currencies.find((c) => c.currency === "EUR");
    expect(gbp).toMatchObject({ totalSpend: 2000, withPoSpend: 1000, percentWithPo: 50 });
    expect(eur).toMatchObject({ totalSpend: 500, withPoSpend: 500, percentWithPo: 100 });
    expect(body.currencies.map((c) => c.totalSpend)).not.toContain(2500);
  });

  it("orders currencies by their own total spend, most significant first", async () => {
    await invoice({ total: 100, currency: "EUR" });
    await invoice({ total: 900, currency: "USD" });
    await invoice({ total: 50, currency: "GBP" });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies.map((c) => c.currency)).toEqual(["USD", "EUR", "GBP"]);
  });

  it("excludes an invoice missing a total or a currency, rather than counting it as zero", async () => {
    await invoice({ total: 100, currency: "GBP" });
    await invoice({ total: null, currency: null });

    const body = (await handleSpendUnderManagement(env.DB)).body as SpendUnderManagementReport;
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0].totalSpend).toBe(100);
  });
});

describe("scoped the same way as every other Financial Performance query (decision 0419)", () => {
  it("counts only invoices within the units AP.Analysis is held in", async () => {
    await units();
    await invoice({ total: 100, currency: "GBP", unit: "acme-fr" });
    await invoice({ total: 200, currency: "GBP", unit: "acme-de" });
    await person("alice", ["AP.Analysis"], "acme-fr");

    const body = (await handleSpendUnderManagement(env.DB, null, "alice")).body as SpendUnderManagementReport;
    expect(body.currencies[0].totalSpend).toBe(100);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await invoice({ total: 100, currency: "GBP", unit: "acme-fr" });
    await invoice({ total: 200, currency: "GBP", unit: "acme-de" });
    await person("alice", ["AP.Analysis"], null);

    const body = (await handleSpendUnderManagement(env.DB, null, "alice")).body as SpendUnderManagementReport;
    expect(body.currencies[0].totalSpend).toBe(300);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await invoice({ total: 100, currency: "GBP", unit: "acme-fr" });
    await invoice({ total: 200, currency: "GBP", unit: "acme-de" });
    await person("alice", ["AP.Analysis"], null);

    const body = (await handleSpendUnderManagement(env.DB, "acme-fr", "alice")).body as SpendUnderManagementReport;
    expect(body.currencies[0].totalSpend).toBe(100);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await invoice({ total: 100, currency: "GBP", unit: "acme-fr" });
    await person("alice", ["AP.Analysis"], "acme-de");

    const body = (await handleSpendUnderManagement(env.DB, "acme-fr", "alice")).body as SpendUnderManagementReport;
    expect(body.currencies).toEqual([]);
  });
});
