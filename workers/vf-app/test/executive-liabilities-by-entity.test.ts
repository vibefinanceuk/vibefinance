import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleExecutiveLiabilitiesByEntity,
  type ExecutiveLiabilitiesReport,
} from "../src/executive-liabilities-by-entity-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Liabilities and accruals by entity — decision 0431, the Multi-
 * Enterprise CFO View's second real metric.
 *
 * **The same two-part-gate test shape decision 0425's own test file
 * already established** for this screen, reused verbatim rather than
 * reinvented — see `executive-consolidated-spend.test.ts`'s own doc
 * comment for why the two facts are tested independently.
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

async function process(id: string, stages: { id: string; name: string; sequence: number }[]) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(id, id).run();
  for (const stage of stages) {
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, ?, ?, ?)")
      .bind(stage.id, id, stage.name, stage.sequence)
      .run();
  }
}

let seq = 0;
async function invoiceAt(opts: {
  processId: string;
  stage: string;
  total: number | null;
  currency: string | null;
  orgUnitId?: string | null;
  status?: string;
}): Promise<string> {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, total_with_vat, currency, org_unit_id) VALUES (?, '{}', ?, ?, ?)"
  )
    .bind(invoiceId, opts.total, opts.currency, opts.orgUnitId ?? null)
    .run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, ?, 'invoice', ?, ?, ?)`
  )
    .bind(piId, opts.processId, invoiceId, opts.stage, opts.status ?? "in_progress")
    .run();
  return invoiceId;
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own two-part gate (decision 0431, following 0425)", () => {
  it("GET /executive/liabilities-by-entity succeeds holding AP.Analysis everywhere", async () => {
    const key = await seedUserEverywhere(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/executive/liabilities-by-entity", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/executive/liabilities-by-entity");
    expect(res.status).toBe(401);
  });

  it("403s holding AP.Analysis, but only scoped to one unit", async () => {
    await unit("fr", "Acme France");
    const key = await seedUserScopedOnly(["AP.Analysis"], "fr");
    const res = await SELF.fetch("https://example.com/executive/liabilities-by-entity", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s holding something everywhere, but never AP.Analysis at all", async () => {
    const key = await seedUserEverywhere(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/executive/liabilities-by-entity", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("what counts as an accrual, unchanged from decision 0417 (decision 0431)", () => {
  it("counts an invoice sitting at an earlier stage", async () => {
    await unit("fr", "Acme France");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", orgUnitId: "fr" });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies[0].total).toBe(100);
  });

  it("excludes an invoice sitting at its own process's final, payment-eligible stage", async () => {
    await unit("fr", "Acme France");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "payment-eligible", total: 500, currency: "GBP", orgUnitId: "fr" });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies).toEqual([]);
  });

  it("excludes a process instance that has already completed", async () => {
    await unit("fr", "Acme France");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({
      processId: "ap",
      stage: "received",
      total: 100,
      currency: "GBP",
      orgUnitId: "fr",
      status: "completed",
    });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies).toEqual([]);
  });
});

describe("grouped by (entity, currency), never summed across currencies (decision 0431)", () => {
  it("sums an entity's own accruing total and counts its invoices within one currency", async () => {
    await unit("fr", "Acme France");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", orgUnitId: "fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 50, currency: "GBP", orgUnitId: "fr" });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies).toEqual([
      { currency: "GBP", total: 150, entities: [{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", total: 150, count: 2 }] },
    ]);
  });

  it("never blends two currencies into one total, even for the same entity", async () => {
    await unit("fr", "Acme France");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 1000, currency: "GBP", orgUnitId: "fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 2000, currency: "EUR", orgUnitId: "fr" });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies).toHaveLength(2);
  });

  it("ranks entities within a currency, and currencies themselves, largest total first", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", orgUnitId: "fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 900, currency: "GBP", orgUnitId: "de" });
    await invoiceAt({ processId: "ap", stage: "received", total: 5000, currency: "EUR", orgUnitId: "fr" });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies.map((c) => c.currency)).toEqual(["EUR", "GBP"]);
    const gbp = body.currencies.find((c) => c.currency === "GBP")!;
    expect(gbp.entities.map((e) => e.orgUnitId)).toEqual(["de", "fr"]);
  });
});

describe("an unplaced invoice is excluded, not guessed into a bucket (decision 0431)", () => {
  it("does not count an accruing invoice with no recorded org unit", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100000, currency: "GBP", orgUnitId: null });

    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body.currencies).toEqual([]);
  });
});

describe("is empty, not an error, when nothing is accruing yet (decision 0431)", () => {
  it("returns no currencies at all", async () => {
    const body = (await handleExecutiveLiabilitiesByEntity(env.DB)).body as ExecutiveLiabilitiesReport;
    expect(body).toEqual({ currencies: [] });
  });
});

describe("enterprise-wide by definition — no org narrowing (decision 0431)", () => {
  it("ignores a ?org= query string entirely and still returns every entity", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", orgUnitId: "fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 200, currency: "GBP", orgUnitId: "de" });
    const key = await seedUserEverywhere(["AP.Analysis"]);

    const res = await SELF.fetch("https://example.com/executive/liabilities-by-entity?org=fr", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as ExecutiveLiabilitiesReport;
    expect(body.currencies[0].entities.map((e) => e.orgUnitId).sort()).toEqual(["de", "fr"]);
  });
});
