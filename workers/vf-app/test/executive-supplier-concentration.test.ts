import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleExecutiveSupplierConcentration,
  type SupplierConcentrationReport,
} from "../src/executive-supplier-concentration-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Cross-entity supplier concentration — decision 0431, the Multi-
 * Enterprise CFO View's third real metric. Top 5 suppliers by spend
 * per (entity, currency), flagged once a supplier appears in that top
 * 5 for 2 or more distinct entities — the operator's own answer to the
 * one fork the design left open (see the route's own doc comment).
 */

async function seedUserEverywhere(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Unscoped User", hash)
    .run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(roleId, "Unscoped Role", JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, roleId).run();
  return apiKey;
}

async function seedUserScopedOnly(permissions: string[], unit: string): Promise<string> {
  const id = crypto.randomUUID();
  const apiKey = generateApiKey();
  const hash = await hashApiKey(apiKey);
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
    .bind(id, `${id}@example.com`, "Scoped User", hash)
    .run();
  const roleId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(roleId, "Scoped Role", JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)")
    .bind(id, roleId, unit)
    .run();
  return apiKey;
}

async function unit(id: string, name: string, kind: "legal_entity" | "operating_unit" = "legal_entity"): Promise<void> {
  await env.DB.prepare("INSERT INTO org_units (id, name, kind) VALUES (?, ?, ?)").bind(id, name, kind).run();
}

async function supplier(id: string, name: string): Promise<void> {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, status) VALUES (?, ?, ?, 'active')").bind(id, id, name).run();
}

let seq = 0;
async function invoice(opts: {
  orgUnitId?: string | null;
  supplierId?: string | null;
  amount: number;
  currency?: string;
}): Promise<string> {
  const id = `inv-${seq++}`;
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, org_unit_id, supplier_id, total_with_vat, currency) VALUES (?, '{}', ?, ?, ?, ?)"
  )
    .bind(id, opts.orgUnitId ?? null, opts.supplierId ?? null, opts.amount, opts.currency ?? "GBP")
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own two-part gate (decision 0431, following 0425)", () => {
  it("GET /executive/supplier-concentration succeeds holding AP.Analysis everywhere", async () => {
    const key = await seedUserEverywhere(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/executive/supplier-concentration", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/executive/supplier-concentration");
    expect(res.status).toBe(401);
  });

  it("403s holding AP.Analysis, but only scoped to one unit", async () => {
    await unit("fr", "Acme France");
    const key = await seedUserScopedOnly(["AP.Analysis"], "fr");
    const res = await SELF.fetch("https://example.com/executive/supplier-concentration", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s holding something everywhere, but never AP.Analysis at all", async () => {
    const key = await seedUserEverywhere(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/executive/supplier-concentration", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("a supplier appearing in one entity's top 5 alone is not flagged (decision 0431)", () => {
  it("returns nothing for a supplier that only ever appears in a single entity", async () => {
    await unit("fr", "Acme France");
    await supplier("acme-co", "Acme Co");
    await invoice({ orgUnitId: "fr", supplierId: "acme-co", amount: 1000 });

    const body = (await handleExecutiveSupplierConcentration(env.DB)).body as SupplierConcentrationReport;
    expect(body.suppliers).toEqual([]);
  });
});

describe("a supplier ranking top 5 in two or more entities is flagged (decision 0431)", () => {
  it("flags a supplier appearing in the top 5 of two different entities", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await supplier("acme-co", "Acme Co");
    await invoice({ orgUnitId: "fr", supplierId: "acme-co", amount: 1000 });
    await invoice({ orgUnitId: "de", supplierId: "acme-co", amount: 2000 });

    const body = (await handleExecutiveSupplierConcentration(env.DB)).body as SupplierConcentrationReport;
    expect(body.suppliers).toHaveLength(1);
    expect(body.suppliers[0]).toMatchObject({ supplierId: "acme-co", supplierName: "Acme Co", entityCount: 2 });
    expect(body.suppliers[0].appearances.map((a) => a.orgUnitId).sort()).toEqual(["de", "fr"]);
  });

  it("does not flag a supplier that ranks top 5 in one entity but misses the cut in another", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await supplier("acme-co", "Acme Co");
    await invoice({ orgUnitId: "fr", supplierId: "acme-co", amount: 10 });
    // Five bigger suppliers in "de" push Acme Co out of that entity's own top 5.
    for (let i = 0; i < 5; i++) {
      const id = `big-${i}`;
      await supplier(id, `Big Supplier ${i}`);
      await invoice({ orgUnitId: "de", supplierId: id, amount: 9000 - i });
    }
    await invoice({ orgUnitId: "de", supplierId: "acme-co", amount: 5 });

    const body = (await handleExecutiveSupplierConcentration(env.DB)).body as SupplierConcentrationReport;
    expect(body.suppliers.find((s) => s.supplierId === "acme-co")).toBeUndefined();
  });

  it("counts the same entity once even when the supplier ranks top 5 in two of its currencies", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await supplier("acme-co", "Acme Co");
    await invoice({ orgUnitId: "fr", supplierId: "acme-co", amount: 1000, currency: "GBP" });
    await invoice({ orgUnitId: "fr", supplierId: "acme-co", amount: 800, currency: "EUR" });
    await invoice({ orgUnitId: "de", supplierId: "acme-co", amount: 2000 });

    const body = (await handleExecutiveSupplierConcentration(env.DB)).body as SupplierConcentrationReport;
    expect(body.suppliers[0].entityCount).toBe(2);
  });
});

describe("an invoice naming no recognised supplier cannot be ranked by identity (decision 0431)", () => {
  it("excludes an unmatched invoice from the ranking entirely", async () => {
    await unit("fr", "Acme France");
    await invoice({ orgUnitId: "fr", supplierId: null, amount: 100000 });

    const body = (await handleExecutiveSupplierConcentration(env.DB)).body as SupplierConcentrationReport;
    expect(body.suppliers).toEqual([]);
  });
});

describe("is empty, not an error, when nothing is priced and placed yet (decision 0431)", () => {
  it("returns no flagged suppliers", async () => {
    const body = (await handleExecutiveSupplierConcentration(env.DB)).body as SupplierConcentrationReport;
    expect(body).toEqual({ suppliers: [] });
  });
});

describe("enterprise-wide by definition — no org narrowing (decision 0431)", () => {
  it("ignores a ?org= query string entirely", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await supplier("acme-co", "Acme Co");
    await invoice({ orgUnitId: "fr", supplierId: "acme-co", amount: 1000 });
    await invoice({ orgUnitId: "de", supplierId: "acme-co", amount: 2000 });
    const key = await seedUserEverywhere(["AP.Analysis"]);

    const res = await SELF.fetch("https://example.com/executive/supplier-concentration?org=fr", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as SupplierConcentrationReport;
    expect(body.suppliers[0].entityCount).toBe(2);
  });
});
