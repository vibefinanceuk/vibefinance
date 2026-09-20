import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUnapprovedSuppliers, type UnapprovedSuppliersReport } from "../src/fraud-unapproved-suppliers-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Unapproved-supplier invoices — decision 0422, the Fraud Prevention
 * tab's second real metric.
 *
 * **Two reasons, one list.** An invoice can show up here because its
 * own `supplier_id` is null (nothing matched), or because it matched
 * a supplier whose `on_hold` is `1` today — read live, not from the
 * frozen `supplier.onHold` fact `source-capture-route.ts` writes once
 * at capture time (decision 0231's own rule-evaluation snapshot,
 * built for a different purpose).
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

async function supplier(opts: { name: string; vatId?: string | null; onHold?: boolean; holdReason?: string | null }): Promise<string> {
  const id = `sup-${seq++}`;
  await env.DB.prepare(
    `INSERT INTO suppliers (id, erp_identifier, name, vat_id, status, on_hold, hold_reason)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`
  )
    .bind(id, id, opts.name, opts.vatId ?? null, opts.onHold ? 1 : 0, opts.holdReason ?? null)
    .run();
  return id;
}

async function invoice(opts: {
  invoiceNumber?: string | null;
  supplierId?: string | null;
  supplierVatId?: string | null;
  supplierNameFallback?: string | null;
  total?: number | null;
  currency?: string | null;
  issueDate?: string | null;
  unit?: string | null;
}) {
  const n = seq++;
  const id = `inv-${n}`;
  const facts = opts.supplierNameFallback ? { "BT-27": opts.supplierNameFallback } : {};
  await env.DB.prepare(
    `INSERT INTO invoice_headers
       (id, facts_json, invoice_number, supplier_id, supplier_vat_id, total_with_vat, currency, issue_date,
        org_unit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      JSON.stringify(facts),
      opts.invoiceNumber ?? null,
      opts.supplierId ?? null,
      opts.supplierVatId ?? null,
      opts.total ?? null,
      opts.currency ?? null,
      opts.issueDate ?? null,
      opts.unit ?? null
    )
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the route's own permission gate (decision 0422)", () => {
  it("GET /fraud/unapproved-suppliers succeeds with AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.FraudReview"]);
    const res = await SELF.fetch("https://example.com/fraud/unapproved-suppliers", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /fraud/unapproved-suppliers 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/fraud/unapproved-suppliers");
    expect(res.status).toBe(401);
  });

  it("GET /fraud/unapproved-suppliers 403s authenticated but lacking AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch("https://example.com/fraud/unapproved-suppliers", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("holding AP.Analysis alone is not enough — this is its own gate, not riding on it", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/fraud/unapproved-suppliers", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("not on file — supplier_id is null (decision 0422)", () => {
  it("includes an invoice with no matched supplier", async () => {
    await invoice({ invoiceNumber: "UNMATCHED-1", supplierNameFallback: "Nobody Recognises Ltd" });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]).toMatchObject({ invoiceNumber: "UNMATCHED-1", reason: "notonfile" });
  });

  it("falls back to the document's own printed name (BT-27) when there is no matched supplier", async () => {
    await invoice({ supplierNameFallback: "Printed On The Invoice Ltd" });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices[0].supplierName).toBe("Printed On The Invoice Ltd");
  });

  it("still returns the raw supplier VAT id alongside, whatever the name resolves to", async () => {
    await invoice({ supplierVatId: "GB123456789" });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices[0].supplierVatId).toBe("GB123456789");
  });

  it("excludes an ordinary matched invoice whose supplier is not on hold", async () => {
    const supplierId = await supplier({ name: "Fine Supplies", onHold: false });
    await invoice({ supplierId });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices).toEqual([]);
  });

  it("is empty, not an error, when nothing is flagged", async () => {
    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices).toEqual([]);
  });
});

describe("on hold — read live from suppliers.on_hold, not the frozen capture-time fact (decision 0422)", () => {
  it("includes an invoice whose matched supplier is on hold today", async () => {
    const supplierId = await supplier({ name: "Held Supplies", onHold: true, holdReason: "Under investigation" });
    await invoice({ invoiceNumber: "HELD-1", supplierId });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]).toMatchObject({
      invoiceNumber: "HELD-1",
      reason: "onhold",
      holdReason: "Under investigation",
    });
  });

  it("shows the matched supplier's own name when on hold", async () => {
    const supplierId = await supplier({ name: "Held Supplies Co", onHold: true });
    await invoice({ supplierId, supplierNameFallback: "Different Printed Name" });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices[0].supplierName).toBe("Held Supplies Co");
  });

  it("carries no hold reason on a not-on-file row", async () => {
    await invoice({ supplierNameFallback: "Nobody Ltd" });

    const body = (await handleUnapprovedSuppliers(env.DB)).body as UnapprovedSuppliersReport;
    expect(body.invoices[0].holdReason).toBeNull();
  });
});

describe("scoped the same way as fraud-duplicates (decision 0422)", () => {
  it("counts only invoices within the units AP.FraudReview is held in", async () => {
    await units();
    await invoice({ supplierNameFallback: "A", unit: "acme-fr" });
    await invoice({ supplierNameFallback: "B", unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], "acme-fr");

    const body = (await handleUnapprovedSuppliers(env.DB, null, "alice")).body as UnapprovedSuppliersReport;
    expect(body.invoices).toHaveLength(1);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await invoice({ supplierNameFallback: "A", unit: "acme-fr" });
    await invoice({ supplierNameFallback: "B", unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleUnapprovedSuppliers(env.DB, null, "alice")).body as UnapprovedSuppliersReport;
    expect(body.invoices).toHaveLength(2);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await invoice({ supplierNameFallback: "A", unit: "acme-fr" });
    await invoice({ supplierNameFallback: "B", unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleUnapprovedSuppliers(env.DB, "acme-fr", "alice")).body as UnapprovedSuppliersReport;
    expect(body.invoices).toHaveLength(1);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await invoice({ supplierNameFallback: "A", unit: "acme-fr" });
    await person("alice", ["AP.FraudReview"], "acme-de");

    const body = (await handleUnapprovedSuppliers(env.DB, "acme-fr", "alice")).body as UnapprovedSuppliersReport;
    expect(body.invoices).toEqual([]);
  });
});
