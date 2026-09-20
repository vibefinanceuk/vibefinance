import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleStatisticalOutliers, type StatisticalOutliersReport } from "../src/fraud-statistical-outliers-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Statistical outliers — decision 0424, Fraud Prevention's fourth real
 * metric: an invoice amount well outside a supplier's own historical
 * range (z-score against that supplier's own same-currency history,
 * self-excluded, with a named minimum-history gate and threshold — see
 * `fraud-statistical-outliers-route.ts`'s own doc comment for the full
 * reasoning).
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

async function supplier(id: string, name: string): Promise<void> {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, status) VALUES (?, ?, ?, 'active')").bind(id, id, name).run();
}

let seq = 0;
async function invoice(opts: {
  supplierId?: string | null;
  amount: number;
  currency?: string;
  unit?: string | null;
  invoiceNumber?: string;
}): Promise<string> {
  const id = `inv-${seq++}`;
  await env.DB.prepare(
    `INSERT INTO invoice_headers (id, facts_json, supplier_id, total_with_vat, currency, issue_date, invoice_number, org_unit_id)
     VALUES (?, '{}', ?, ?, ?, '2026-01-01', ?, ?)`
  )
    .bind(id, opts.supplierId ?? null, opts.amount, opts.currency ?? "GBP", opts.invoiceNumber ?? id, opts.unit ?? null)
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate (decision 0424)", () => {
  it("GET /fraud/statistical-outliers succeeds with AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.FraudReview"]);
    const res = await SELF.fetch("https://example.com/fraud/statistical-outliers", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /fraud/statistical-outliers 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/fraud/statistical-outliers");
    expect(res.status).toBe(401);
  });

  it("GET /fraud/statistical-outliers 403s authenticated but lacking AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/fraud/statistical-outliers", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("holding AP.Analysis alone is not enough — this is its own gate", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/fraud/statistical-outliers", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("no baseline without real history (decision 0424)", () => {
  it("excludes a supplier with fewer than MIN_HISTORY other invoices, however extreme the one amount is", async () => {
    await supplier("s1", "Northwind");
    for (let i = 0; i < 4; i++) await invoice({ supplierId: "s1", amount: 100 });
    await invoice({ supplierId: "s1", amount: 100000 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices).toEqual([]);
  });

  it("flags once five other invoices exist and the candidate is far enough outside them", async () => {
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100 });
    const outlierId = await invoice({ supplierId: "s1", amount: 100000 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].id).toBe(outlierId);
    expect(body.invoices[0].sampleSize).toBe(5);
    expect(body.invoices[0].historicalMean).toBe(100);
  });
});

describe("the z-score threshold (decision 0424)", () => {
  it("does not flag an invoice within the threshold of its supplier's own history", async () => {
    await supplier("s1", "Northwind");
    // A tight cluster around 100 with one candidate only mildly different.
    for (const amount of [98, 99, 100, 101, 102]) await invoice({ supplierId: "s1", amount });
    await invoice({ supplierId: "s1", amount: 103 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices).toEqual([]);
  });

  it("computes the baseline excluding the candidate itself, not including it", async () => {
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100 });
    const outlierId = await invoice({ supplierId: "s1", amount: 1000 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    const outlier = body.invoices.find((i) => i.id === outlierId)!;
    // If the candidate's own 1000 had polluted the mean, historicalMean would not be exactly 100.
    expect(outlier.historicalMean).toBe(100);
    expect(outlier.historicalStdDev).toBe(0);
  });
});

describe("the zero-variance edge case — an honest null, not a fabricated number (decision 0424)", () => {
  it("reports zScore: null when every historical invoice is identical and the candidate differs", async () => {
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 500 });
    const outlierId = await invoice({ supplierId: "s1", amount: 501 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    const outlier = body.invoices.find((i) => i.id === outlierId)!;
    expect(outlier.zScore).toBeNull();
  });

  it("does not flag an invoice that matches an identical historical amount exactly", async () => {
    await supplier("s1", "Northwind");
    for (let i = 0; i < 6; i++) await invoice({ supplierId: "s1", amount: 500 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices).toEqual([]);
  });
});

describe("same-currency, own-supplier grouping (decision 0424)", () => {
  it("never mixes currencies into one baseline", async () => {
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100, currency: "GBP" });
    // Five EUR invoices for the same supplier, unrelated amount scale — must not feed GBP's baseline.
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100000, currency: "EUR" });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices).toEqual([]);
  });

  it("never mixes suppliers into one baseline", async () => {
    await supplier("s1", "Northwind");
    await supplier("s2", "Southwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100 });
    const outlierId = await invoice({ supplierId: "s2", amount: 100000 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    // s2 has no history of its own (0 other invoices), so it's excluded, not compared against s1's.
    expect(body.invoices.find((i) => i.id === outlierId)).toBeUndefined();
  });

  it("excludes an invoice with no matched supplier — no borrowed baseline", async () => {
    for (let i = 0; i < 5; i++) await invoice({ supplierId: null, amount: 100 });
    await invoice({ supplierId: null, amount: 100000 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices).toEqual([]);
  });
});

describe("sort order (decision 0424)", () => {
  it("sorts the largest deviation first, and a null (undefined magnitude) ahead of any numeric score", async () => {
    await supplier("s1", "Northwind");
    // Real variance (not zero) so this candidate gets a large but finite z-score, not a null.
    for (const amount of [80, 90, 100, 110, 120]) await invoice({ supplierId: "s1", amount });
    const mild = await invoice({ supplierId: "s1", amount: 1000 });

    await supplier("s2", "Southwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s2", amount: 500 });
    const undefinedMagnitude = await invoice({ supplierId: "s2", amount: 501 });

    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body.invoices[0].id).toBe(undefinedMagnitude);
    expect(body.invoices.map((i) => i.id)).toContain(mild);
  });
});

describe("is empty, not an error, when nothing is priced or matched yet (decision 0424)", () => {
  it("returns an empty worklist with no invoices at all", async () => {
    const body = (await handleStatisticalOutliers(env.DB, null, undefined)).body as StatisticalOutliersReport;
    expect(body).toEqual({ invoices: [] });
  });
});

describe("scoped the same way as the other Fraud Prevention routes (decision 0424)", () => {
  it("counts only invoices within the units AP.FraudReview is held in", async () => {
    await units();
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100, unit: "acme-fr" });
    const outlierId = await invoice({ supplierId: "s1", amount: 100000, unit: "acme-fr" });
    await person("alice", ["AP.FraudReview"], "acme-de");

    const body = (await handleStatisticalOutliers(env.DB, null, "alice")).body as StatisticalOutliersReport;
    expect(body.invoices.find((i) => i.id === outlierId)).toBeUndefined();
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100, unit: "acme-fr" });
    const outlierId = await invoice({ supplierId: "s1", amount: 100000, unit: "acme-fr" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleStatisticalOutliers(env.DB, null, "alice")).body as StatisticalOutliersReport;
    expect(body.invoices.find((i) => i.id === outlierId)).toBeDefined();
  });

  it("narrows to the chosen org", async () => {
    await units();
    await supplier("s1", "Northwind");
    for (let i = 0; i < 5; i++) await invoice({ supplierId: "s1", amount: 100, unit: "acme-de" });
    const outlierId = await invoice({ supplierId: "s1", amount: 100000, unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleStatisticalOutliers(env.DB, "acme-fr", "alice")).body as StatisticalOutliersReport;
    expect(body.invoices.find((i) => i.id === outlierId)).toBeUndefined();
  });
});
