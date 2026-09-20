import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierPoVariance, type SupplierPoVarianceReport } from "../src/supplier-po-variance-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Invoice variance to order value, ranked by supplier — decision
 * 0421, one of the six remaining vertical slices of the Supplier
 * Performance screen.
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
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme DE', 'legal_entity')").run();
}

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function supplier(id: string, name: string, unit: string | null = null) {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, org_unit_id) VALUES (?, ?, ?, ?)")
    .bind(id, id, name, unit)
    .run();
}

let seq = 0;

/** A purchase order this system actually holds. */
async function purchaseOrder(orderNumber: string, payableAmount: number) {
  const id = `po-${seq++}`;
  await env.DB.prepare("INSERT INTO purchase_orders (id, order_number, payable_amount) VALUES (?, ?, ?)")
    .bind(id, orderNumber, payableAmount)
    .run();
}

/** An invoice attributed to a supplier, naming a purchase order via BT-13. */
async function invoice(opts: { supplierId: string; total: number | null; orderNumber?: string }) {
  const n = seq++;
  const id = `inv-${n}`;
  const factsJson = opts.orderNumber ? JSON.stringify({ "BT-13": opts.orderNumber }) : "{}";
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, total_with_vat) VALUES (?, ?, ?, ?)")
    .bind(id, factsJson, opts.supplierId, opts.total)
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the supplier PO variance route's own permission gate (decision 0421)", () => {
  it("GET /suppliers/po-variance succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/po-variance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /suppliers/po-variance 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/po-variance");
    expect(res.status).toBe(401);
  });

  it("GET /suppliers/po-variance 403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/suppliers/po-variance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("variance recomputed directly, the same formula po-matching.ts's own variancePct() uses (decision 0421)", () => {
  it("computes the percentage variance between an invoice's total and its order's payable amount", async () => {
    await supplier("s1", "Northwind");
    await purchaseOrder("PO-1", 1000);
    await invoice({ supplierId: "s1", total: 1100, orderNumber: "PO-1" });

    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers).toEqual([
      { supplierId: "s1", supplierName: "Northwind", averageVariancePct: 10, invoiceCount: 1 },
    ]);
  });

  it("averages variance across a supplier's several PO-matched invoices", async () => {
    await supplier("s1", "Northwind");
    await purchaseOrder("PO-1", 1000);
    await purchaseOrder("PO-2", 1000);
    await invoice({ supplierId: "s1", total: 1100, orderNumber: "PO-1" }); // 10%
    await invoice({ supplierId: "s1", total: 1200, orderNumber: "PO-2" }); // 20%

    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers[0].averageVariancePct).toBe(15);
  });

  it("excludes an invoice naming an order this system has never stored", async () => {
    await supplier("s1", "Northwind");
    await invoice({ supplierId: "s1", total: 1100, orderNumber: "PO-never-arrived" });

    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes an invoice naming no order at all", async () => {
    await supplier("s1", "Northwind");
    await invoice({ supplierId: "s1", total: 1100 });

    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes an invoice missing a total", async () => {
    await supplier("s1", "Northwind");
    await purchaseOrder("PO-1", 1000);
    await invoice({ supplierId: "s1", total: null, orderNumber: "PO-1" });

    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("is empty, not an error, when nothing has matched a purchase order yet", async () => {
    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("ranks the highest variance first", async () => {
    await supplier("s1", "Close to plan");
    await supplier("s2", "Way off plan");
    await purchaseOrder("PO-1", 1000);
    await purchaseOrder("PO-2", 1000);
    await invoice({ supplierId: "s1", total: 1010, orderNumber: "PO-1" }); // 1%
    await invoice({ supplierId: "s2", total: 1500, orderNumber: "PO-2" }); // 50%

    const body = (await handleSupplierPoVariance(env.DB)).body as SupplierPoVarianceReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s2", "s1"]);
  });
});

describe("scoped the same way the rest of this screen already is (decision 0421)", () => {
  it("counts only invoices within the units AP.Supplier is held in", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await purchaseOrder("PO-FR", 1000);
    await purchaseOrder("PO-DE", 1000);
    await invoice({ supplierId: "s-fr", total: 1100, orderNumber: "PO-FR" });
    await invoice({ supplierId: "s-de", total: 1100, orderNumber: "PO-DE" });
    await person("alice", ["AP.Supplier"], "acme-fr");

    const body = (await handleSupplierPoVariance(env.DB, null, "alice")).body as SupplierPoVarianceReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await purchaseOrder("PO-FR", 1000);
    await purchaseOrder("PO-DE", 1000);
    await invoice({ supplierId: "s-fr", total: 1100, orderNumber: "PO-FR" });
    await invoice({ supplierId: "s-de", total: 1100, orderNumber: "PO-DE" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierPoVariance(env.DB, null, "alice")).body as SupplierPoVarianceReport;
    expect(body.suppliers.map((s) => s.supplierId).sort()).toEqual(["s-de", "s-fr"]);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await purchaseOrder("PO-FR", 1000);
    await purchaseOrder("PO-DE", 1000);
    await invoice({ supplierId: "s-fr", total: 1100, orderNumber: "PO-FR" });
    await invoice({ supplierId: "s-de", total: 1100, orderNumber: "PO-DE" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierPoVariance(env.DB, "acme-fr", "alice")).body as SupplierPoVarianceReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await purchaseOrder("PO-FR", 1000);
    await invoice({ supplierId: "s-fr", total: 1100, orderNumber: "PO-FR" });
    await person("alice", ["AP.Supplier"], "acme-de");

    const body = (await handleSupplierPoVariance(env.DB, "acme-fr", "alice")).body as SupplierPoVarianceReport;
    expect(body.suppliers).toEqual([]);
  });
});
