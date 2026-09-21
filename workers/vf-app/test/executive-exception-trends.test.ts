import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleExecutiveExceptionTrends,
  type ExecutiveExceptionTrendsReport,
} from "../src/executive-exception-trends-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Cross-entity exception and fraud-signal trend — decision 0431, the
 * Multi-Enterprise CFO View's fourth real metric.
 *
 * **A fixed `now`, the same discipline `fraud-exception-trends.test.ts`
 * already established**, so the eight-week window and which bucket a
 * given `created_at` lands in are exact.
 *
 * For `NOW = 2026-09-17T12:00:00Z` (a Thursday), the eight week-start
 * Mondays, oldest first, are: 2026-07-27, 08-03, 08-10, 08-17, 08-24,
 * 08-31, 09-07, 09-14 — index 7 is the current week, index 0 the
 * oldest.
 */

const NOW = new Date("2026-09-17T12:00:00Z");
const WEEK_STARTS = [
  "2026-07-27",
  "2026-08-03",
  "2026-08-10",
  "2026-08-17",
  "2026-08-24",
  "2026-08-31",
  "2026-09-07",
  "2026-09-14",
];

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

let seeded = false;
async function stage() {
  if (seeded) return;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  seeded = true;
}

let seq = 0;
/** One stage visit, attributed through its invoice to an org unit. */
async function visit(opts: { passed: boolean | null; at: string; orgUnitId?: string | null }): Promise<string> {
  await stage();
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const visitId = `visit-${n}`;
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, '{}', ?)")
    .bind(invoiceId, opts.orgUnitId ?? null)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')"
  )
    .bind(piId, invoiceId)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, created_at) VALUES (?, ?, 'validation', 'evaluated', ?, ?)"
  )
    .bind(visitId, piId, opts.passed === null ? null : opts.passed ? 1 : 0, opts.at)
    .run();
  return visitId;
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
  seeded = false;
});

describe("the route's own two-part gate (decision 0431, following 0425)", () => {
  it("GET /executive/exception-trends succeeds holding AP.Analysis everywhere", async () => {
    const key = await seedUserEverywhere(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/executive/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/executive/exception-trends");
    expect(res.status).toBe(401);
  });

  it("403s holding AP.Analysis, but only scoped to one unit", async () => {
    await unit("fr", "Acme France");
    const key = await seedUserScopedOnly(["AP.Analysis"], "fr");
    const res = await SELF.fetch("https://example.com/executive/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s holding something everywhere, but never AP.Analysis at all", async () => {
    const key = await seedUserEverywhere(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/executive/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("succeeds gated on AP.Analysis alone, not AP.FraudReview — the tab's own single gate, not a second one", async () => {
    const key = await seedUserEverywhere(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/executive/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });
});

describe("an exception is what validation_passed = 0 already means (decision 0431, following 0423)", () => {
  it("counts a failed visit within the eight-week window", async () => {
    await unit("fr", "Acme France");
    await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: "fr" });

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.byEntity).toHaveLength(1);
    expect(body.byEntity[0].total).toBe(1);
  });

  it("does not count a visit that passed validation", async () => {
    await unit("fr", "Acme France");
    await visit({ passed: true, at: "2026-09-15T09:00:00Z", orgUnitId: "fr" });

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.byEntity).toEqual([]);
  });

  it("ignores an exception older than the eight-week window", async () => {
    await unit("fr", "Acme France");
    await visit({ passed: false, at: "2026-06-01T09:00:00Z", orgUnitId: "fr" });

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.byEntity).toEqual([]);
  });
});

describe("grouped by entity, weekly-bucketed (decision 0431)", () => {
  it("buckets an exception into the correct week of the trend", async () => {
    await unit("fr", "Acme France");
    await visit({ passed: false, at: `${WEEK_STARTS[0]}T09:00:00Z`, orgUnitId: "fr" });

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.weekStartDates).toEqual(WEEK_STARTS);
    expect(body.byEntity[0].weeklyCounts).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("keeps two entities' own trends separate", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: "fr" });
    await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: "fr" });
    await visit({ passed: false, at: "2026-09-01T09:00:00Z", orgUnitId: "de" });

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.byEntity.map((e) => e.orgUnitId)).toEqual(["fr", "de"]);
    expect(body.byEntity[0].total).toBe(2);
    expect(body.byEntity[1].total).toBe(1);
  });

  it("is uncapped, unlike decision 0423's own top-8/top-6 breakdowns", async () => {
    await unit("fr", "Acme France");
    for (let i = 0; i < 12; i++) {
      const id = `unit-${i}`;
      await unit(id, `Entity ${i}`);
      await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: id });
    }

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.byEntity).toHaveLength(12);
  });
});

describe("an unplaced exception is excluded, not guessed into a bucket (decision 0431)", () => {
  it("does not count a failed visit with no recorded org unit", async () => {
    await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: null });

    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.byEntity).toEqual([]);
  });
});

describe("is empty, not an error, when nothing has failed validation yet (decision 0431)", () => {
  it("still returns the eight week-start dates with no entities", async () => {
    const body = (await handleExecutiveExceptionTrends(env.DB, NOW)).body as ExecutiveExceptionTrendsReport;
    expect(body.weekStartDates).toEqual(WEEK_STARTS);
    expect(body.byEntity).toEqual([]);
  });
});

describe("enterprise-wide by definition — no org narrowing (decision 0431)", () => {
  it("ignores a ?org= query string entirely and still returns every entity", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: "fr" });
    await visit({ passed: false, at: "2026-09-15T09:00:00Z", orgUnitId: "de" });
    const key = await seedUserEverywhere(["AP.Analysis"]);

    const res = await SELF.fetch("https://example.com/executive/exception-trends?org=fr", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as ExecutiveExceptionTrendsReport;
    expect(body.byEntity.map((e) => e.orgUnitId).sort()).toEqual(["de", "fr"]);
  });
});
