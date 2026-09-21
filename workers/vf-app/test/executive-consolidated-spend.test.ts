import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleExecutiveConsolidatedSpend,
  type ConsolidatedSpendReport,
} from "../src/executive-consolidated-spend-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Consolidated spend across org units / legal entities — decision
 * 0425, the Multi-Enterprise CFO View's first real metric.
 *
 * **The two-part gate is tested as two independent facts**, matching
 * `ap-analytics.js`'s own `executiveiq` tab gate exactly: holding
 * `AP.Analysis` *at all* (anywhere, even scoped to one unit) and
 * holding *some* role unscoped (`holdsEverywhere`, which does not
 * itself have to be the `AP.Analysis` grant) are checked separately,
 * never as "AP.Analysis held everywhere" combined into one condition —
 * the route's own doc comment explains why.
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
  // No unit_id bound — decision 0199's own "held everywhere," the
  // same shape whoami.test.ts's own fixture relies on.
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

let seq = 0;
async function invoice(opts: { orgUnitId?: string | null; amount: number; currency?: string }): Promise<string> {
  const id = `inv-${seq++}`;
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, org_unit_id, total_with_vat, currency) VALUES (?, '{}', ?, ?, ?)"
  )
    .bind(id, opts.orgUnitId ?? null, opts.amount, opts.currency ?? "GBP")
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own two-part gate (decision 0425)", () => {
  it("GET /executive/consolidated-spend succeeds holding AP.Analysis everywhere", async () => {
    const key = await seedUserEverywhere(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/executive/consolidated-spend", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/executive/consolidated-spend");
    expect(res.status).toBe(401);
  });

  it("403s holding AP.Analysis, but only scoped to one unit — not holding anything everywhere", async () => {
    await unit("fr", "Acme France");
    const key = await seedUserScopedOnly(["AP.Analysis"], "fr");
    const res = await SELF.fetch("https://example.com/executive/consolidated-spend", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s holding something everywhere, but never AP.Analysis at all", async () => {
    const key = await seedUserEverywhere(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/executive/consolidated-spend", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("succeeds when AP.Analysis is held only scoped, as long as some other role is held everywhere — the same two independent facts the tab itself checks", async () => {
    await unit("fr", "Acme France");
    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    const hash = await hashApiKey(apiKey);
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)")
      .bind(id, `${id}@example.com`, "Mixed User", hash)
      .run();
    const scopedRole = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(scopedRole, "Scoped Analysis", JSON.stringify(["AP.Analysis"]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)")
      .bind(id, scopedRole, "fr")
      .run();
    const everywhereRole = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
      .bind(everywhereRole, "Everywhere Supplier", JSON.stringify(["AP.Supplier"]))
      .run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, everywhereRole).run();

    const res = await SELF.fetch("https://example.com/executive/consolidated-spend", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("grouped by (org unit, currency), never summed across currencies (decision 0425)", () => {
  it("sums an entity's own spend within one currency", async () => {
    await unit("fr", "Acme France");
    await invoice({ orgUnitId: "fr", amount: 1000, currency: "GBP" });
    await invoice({ orgUnitId: "fr", amount: 500, currency: "GBP" });

    const body = (await handleExecutiveConsolidatedSpend(env.DB)).body as ConsolidatedSpendReport;
    expect(body.currencies).toEqual([
      { currency: "GBP", total: 1500, entities: [{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 1500 }] },
    ]);
  });

  it("never blends two currencies into one total, even for the same entity", async () => {
    await unit("fr", "Acme France");
    await invoice({ orgUnitId: "fr", amount: 1000, currency: "GBP" });
    await invoice({ orgUnitId: "fr", amount: 2000, currency: "EUR" });

    const body = (await handleExecutiveConsolidatedSpend(env.DB)).body as ConsolidatedSpendReport;
    expect(body.currencies).toHaveLength(2);
    const gbp = body.currencies.find((c) => c.currency === "GBP")!;
    const eur = body.currencies.find((c) => c.currency === "EUR")!;
    expect(gbp.total).toBe(1000);
    expect(eur.total).toBe(2000);
  });

  it("carries each entity's own kind, legal entity or operating unit, exactly as recorded", async () => {
    await unit("fr", "Acme France", "legal_entity");
    await unit("fr-sales", "Acme France Sales", "operating_unit");
    await invoice({ orgUnitId: "fr", amount: 100, currency: "GBP" });
    await invoice({ orgUnitId: "fr-sales", amount: 200, currency: "GBP" });

    const body = (await handleExecutiveConsolidatedSpend(env.DB)).body as ConsolidatedSpendReport;
    const entities = body.currencies[0].entities;
    expect(entities.find((e) => e.orgUnitId === "fr")?.orgUnitKind).toBe("legal_entity");
    expect(entities.find((e) => e.orgUnitId === "fr-sales")?.orgUnitKind).toBe("operating_unit");
  });

  it("ranks entities within a currency, and currencies themselves, largest total first", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await invoice({ orgUnitId: "fr", amount: 100, currency: "GBP" });
    await invoice({ orgUnitId: "de", amount: 900, currency: "GBP" });
    await invoice({ orgUnitId: "fr", amount: 5000, currency: "EUR" });

    const body = (await handleExecutiveConsolidatedSpend(env.DB)).body as ConsolidatedSpendReport;
    expect(body.currencies.map((c) => c.currency)).toEqual(["EUR", "GBP"]);
    const gbp = body.currencies.find((c) => c.currency === "GBP")!;
    expect(gbp.entities.map((e) => e.orgUnitId)).toEqual(["de", "fr"]);
  });
});

describe("an unplaced invoice is excluded, not guessed into a bucket (decision 0425)", () => {
  it("does not count an invoice with no recorded org unit", async () => {
    await invoice({ orgUnitId: null, amount: 100000, currency: "GBP" });

    const body = (await handleExecutiveConsolidatedSpend(env.DB)).body as ConsolidatedSpendReport;
    expect(body.currencies).toEqual([]);
  });
});

describe("is empty, not an error, when nothing is priced and placed yet (decision 0425)", () => {
  it("returns no currencies at all", async () => {
    const body = (await handleExecutiveConsolidatedSpend(env.DB)).body as ConsolidatedSpendReport;
    expect(body).toEqual({ currencies: [] });
  });
});

describe("enterprise-wide by definition — no org narrowing (decision 0425)", () => {
  it("ignores a ?org= query string entirely and still returns every entity", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await invoice({ orgUnitId: "fr", amount: 100, currency: "GBP" });
    await invoice({ orgUnitId: "de", amount: 200, currency: "GBP" });
    const key = await seedUserEverywhere(["AP.Analysis"]);

    const res = await SELF.fetch("https://example.com/executive/consolidated-spend?org=fr", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as ConsolidatedSpendReport;
    expect(body.currencies[0].entities.map((e) => e.orgUnitId).sort()).toEqual(["de", "fr"]);
  });
});
