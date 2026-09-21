import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierDiscountEligibility, type DiscountEligibilityReport } from "../src/supplier-discount-eligibility-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Early-payment / discount eligibility by supplier — decision 0427,
 * the seventh of Supplier Performance's eight key metrics.
 */

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

async function supplier(
  id: string,
  name: string,
  opts: { discountPct?: number | null; discountDays?: number | null; unit?: string | null } = {}
) {
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, discount_pct, discount_days, org_unit_id) VALUES (?, ?, ?, ?, ?, ?)"
  )
    .bind(id, id, name, opts.discountPct ?? null, opts.discountDays ?? null, opts.unit ?? null)
    .run();
}

let seq = 0;

/** `daysAgo` positive is in the past, negative is in the future. */
function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

async function invoice(supplierId: string, opts: { total: number; currency: string; issuedDaysAgo: number }) {
  const n = seq++;
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, supplier_id, total_with_vat, currency, issue_date) VALUES (?, '{}', ?, ?, ?, ?)"
  )
    .bind(`inv-${n}`, supplierId, opts.total, opts.currency, daysAgo(opts.issuedDaysAgo))
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /suppliers/discount-eligibility succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/discount-eligibility", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/discount-eligibility");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/suppliers/discount-eligibility", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("excluded, not guessed, when a supplier's own terms are unknown", () => {
  it("leaves out a supplier with no discount_pct or discount_days at all", async () => {
    await supplier("s1", "Northwind");
    await invoice("s1", { total: 1000, currency: "GBP", issuedDaysAgo: 1 });

    const body = (await handleSupplierDiscountEligibility(env.DB)).body as DiscountEligibilityReport;
    expect(body.currencies).toEqual([]);
  });
});

describe("the discount window", () => {
  it("counts an invoice still inside its supplier's own window", async () => {
    await supplier("s1", "Northwind", { discountPct: 2, discountDays: 10 });
    await invoice("s1", { total: 1000, currency: "GBP", issuedDaysAgo: 5 }); // 5 of 10 days used

    const body = (await handleSupplierDiscountEligibility(env.DB)).body as DiscountEligibilityReport;
    expect(body.currencies[0].entities[0]).toEqual({
      supplierId: "s1",
      supplierName: "Northwind",
      discountPct: 2,
      discountDays: 10,
      invoiceCount: 1,
      totalAmount: 1000,
      potentialDiscount: 20,
    });
  });

  it("excludes an invoice whose window has already passed", async () => {
    await supplier("s1", "Northwind", { discountPct: 2, discountDays: 10 });
    await invoice("s1", { total: 1000, currency: "GBP", issuedDaysAgo: 20 }); // window closed 10 days ago

    const body = (await handleSupplierDiscountEligibility(env.DB)).body as DiscountEligibilityReport;
    expect(body.currencies).toEqual([]);
  });
});

describe("never summed across currencies", () => {
  it("splits a multi-currency supplier into one entry per currency", async () => {
    await supplier("s1", "Northwind", { discountPct: 2, discountDays: 10 });
    await invoice("s1", { total: 1000, currency: "GBP", issuedDaysAgo: 1 });
    await invoice("s1", { total: 500, currency: "EUR", issuedDaysAgo: 1 });

    const body = (await handleSupplierDiscountEligibility(env.DB)).body as DiscountEligibilityReport;
    expect(body.currencies).toHaveLength(2);
    expect(body.currencies.map((c) => c.currency).sort()).toEqual(["EUR", "GBP"]);
  });
});

describe("ranked by potential discount — the design's own \"money left on the table\" framing", () => {
  it("ranks the supplier with the larger potential discount first", async () => {
    await supplier("s1", "Small Opportunity", { discountPct: 1, discountDays: 30 });
    await supplier("s2", "Big Opportunity", { discountPct: 5, discountDays: 30 });
    await invoice("s1", { total: 1000, currency: "GBP", issuedDaysAgo: 1 }); // potential 10
    await invoice("s2", { total: 1000, currency: "GBP", issuedDaysAgo: 1 }); // potential 50

    const body = (await handleSupplierDiscountEligibility(env.DB)).body as DiscountEligibilityReport;
    expect(body.currencies[0].entities.map((e) => e.supplierId)).toEqual(["s2", "s1"]);
  });
});

describe("scoping — the same org-unit intersection the rest of this screen already uses", () => {
  it("shows only the supplier in the viewer's own org", async () => {
    await units();
    await person("viewer", ["AP.Supplier"], "acme-fr");
    await supplier("s1", "France Supplier", { discountPct: 2, discountDays: 10, unit: "acme-fr" });
    await supplier("s2", "Germany Supplier", { discountPct: 2, discountDays: 10, unit: "acme-de" });
    await invoice("s1", { total: 1000, currency: "GBP", issuedDaysAgo: 1 });
    await invoice("s2", { total: 1000, currency: "GBP", issuedDaysAgo: 1 });

    const body = (await handleSupplierDiscountEligibility(env.DB, null, "viewer")).body as DiscountEligibilityReport;
    expect(body.currencies[0].entities.map((e) => e.supplierId)).toEqual(["s1"]);
  });
});
