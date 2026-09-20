import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleFraudExceptionTrends, type FraudExceptionTrendsReport } from "../src/fraud-exception-trends-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Exceptions by type, by user, by supplier — trended — decision 0423,
 * Fraud Prevention's third real metric.
 *
 * **A fixed `now`, not the wall clock.** Every test hands
 * `handleFraudExceptionTrends` an explicit `now` so the eight-week
 * window and which bucket a given `created_at` lands in are exact,
 * not "whatever day this suite happens to run."
 *
 * For `NOW = 2026-09-17T12:00:00Z` (a Thursday), the current calendar
 * week's own Monday is `2026-09-14` and the eight week-start Mondays,
 * oldest first, are: 2026-07-27, 08-03, 08-10, 08-17, 08-24, 08-31,
 * 09-07, 09-14 — index 7 is the current week, index 0 the oldest.
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

async function supplier(id: string, name: string): Promise<void> {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, status) VALUES (?, ?, ?, 'active')").bind(id, id, name).run();
}

async function reviewer(id: string, name: string): Promise<void> {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
}

let seeded = false;
async function stage() {
  if (seeded) return;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  seeded = true;
}

let seq = 0;

/** One stage visit, attributed through its invoice to a supplier and an org unit — decision 0420/0422's own Fraud Prevention scoping rule. */
async function visit(opts: {
  supplierId?: string | null;
  supplierNameFallback?: string | null;
  passed: boolean | null;
  failures?: string | null;
  at: string;
  unit?: string | null;
}): Promise<string> {
  await stage();
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const visitId = `visit-${n}`;
  const facts = opts.supplierNameFallback ? { "BT-27": opts.supplierNameFallback } : {};
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id) VALUES (?, ?, ?, ?)")
    .bind(invoiceId, JSON.stringify(facts), opts.supplierId ?? null, opts.unit ?? null)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')"
  )
    .bind(piId, invoiceId)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, validation_failures, created_at) VALUES (?, ?, 'validation', 'evaluated', ?, ?, ?)"
  )
    .bind(visitId, piId, opts.passed === null ? null : opts.passed ? 1 : 0, opts.failures ?? null, opts.at)
    .run();
  return visitId;
}

/** A task tied to a stage visit — decision 0423's own "credit whoever completed the task" rule, the same unit workload-route.ts's own throughput already counts by. */
async function task(opts: { visitId: string; completedBy?: string | null; status?: string }): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, required_permission, stage_visit_id, completed_by, completed_at, status)
     VALUES (?, 'validation', 'AP.Review', ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      opts.visitId,
      opts.completedBy ?? null,
      opts.completedBy ? new Date().toISOString() : null,
      opts.status ?? (opts.completedBy ? "completed" : "open")
    )
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
  seeded = false;
});

describe("the route's own permission gate (decision 0423)", () => {
  it("GET /fraud/exception-trends succeeds with AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.FraudReview"]);
    const res = await SELF.fetch("https://example.com/fraud/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /fraud/exception-trends 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/fraud/exception-trends");
    expect(res.status).toBe(401);
  });

  it("GET /fraud/exception-trends 403s authenticated but lacking AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/fraud/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("holding AP.Analysis alone is not enough — this is its own gate, not riding on it", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/fraud/exception-trends", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("the eight-week window (decision 0423)", () => {
  it("returns the eight Monday-anchored week starts, oldest first", async () => {
    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.weekStartDates).toEqual(WEEK_STARTS);
  });

  it("buckets an exception from the current week into the last entry", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier[0].weeklyCounts).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
  });

  it("buckets an exception from the oldest week in the window into the first entry", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch", at: "2026-07-28 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier[0].weeklyCounts).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("excludes an exception older than the eight-week window entirely", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch", at: "2026-07-10 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toEqual([]);
  });

  it("does not count a passing visit as an exception", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: true, at: "2026-09-16 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toEqual([]);
  });

  it("does not count a visit where validation never ran", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: null, at: "2026-09-16 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toEqual([]);
  });

  it("is empty, not an error, when nothing has been evaluated yet", async () => {
    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body).toEqual({ weekStartDates: WEEK_STARTS, bySupplier: [], byUser: [], byType: [] });
  });
});

describe("by supplier — the unmatched bucket stays one entry, not fragmented (decision 0423)", () => {
  it("groups a matched supplier's exceptions by its own id and name", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch", at: "2026-09-09 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toEqual([{ supplierId: "s1", supplierName: "Northwind", total: 2, weeklyCounts: [0, 0, 0, 0, 0, 0, 1, 1] }]);
  });

  it("groups every unmatched invoice's exceptions into one shared entry, never one per printed name", async () => {
    await visit({ supplierNameFallback: "A Ltd", passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });
    await visit({ supplierNameFallback: "B Ltd", passed: false, failures: "amount_mismatch", at: "2026-09-09 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toEqual([{ supplierId: null, supplierName: null, total: 2, weeklyCounts: [0, 0, 0, 0, 0, 0, 1, 1] }]);
  });

  it("ranks the highest total first, and caps at the top eight", async () => {
    for (let i = 0; i < 9; i++) {
      await supplier(`s${i}`, `Supplier ${i}`);
      for (let n = 0; n <= i; n++) {
        await visit({ supplierId: `s${i}`, passed: false, failures: "x", at: "2026-09-16 09:00:00" });
      }
    }

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toHaveLength(8);
    expect(body.bySupplier[0].supplierId).toBe("s8");
    expect(body.bySupplier.map((s) => s.supplierId)).not.toContain("s0");
  });
});

describe("by type, read from validation_failures the same way decision 0421 already does (decision 0423)", () => {
  it("splits comma-separated failures and trends each named check", async () => {
    await visit({ passed: false, failures: "amount_mismatch,duplicate_suspected", at: "2026-09-16 09:00:00" });
    await visit({ passed: false, failures: "amount_mismatch", at: "2026-09-09 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    const mismatch = body.byType.find((t) => t.type === "amount_mismatch");
    expect(mismatch).toMatchObject({ total: 2, weeklyCounts: [0, 0, 0, 0, 0, 0, 1, 1] });
    expect(body.byType.find((t) => t.type === "duplicate_suspected")).toMatchObject({ total: 1 });
  });

  it("caps at the six most common types", async () => {
    const types = ["a", "b", "c", "d", "e", "f", "g"];
    for (const type of types) {
      await visit({ passed: false, failures: type, at: "2026-09-16 09:00:00" });
    }

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.byType).toHaveLength(6);
  });
});

describe("by user — completed tasks, not exceptions (decision 0423)", () => {
  it("credits the user who completed the review task tied to the exception visit", async () => {
    await reviewer("u1", "Priya");
    const visitId = await visit({ passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });
    await task({ visitId, completedBy: "u1" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.byUser).toEqual([{ userId: "u1", userName: "Priya", total: 1, weeklyCounts: [0, 0, 0, 0, 0, 0, 0, 1] }]);
  });

  it("gives no credit for a task still open", async () => {
    await reviewer("u1", "Priya");
    const visitId = await visit({ passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });
    await task({ visitId, completedBy: null });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.byUser).toEqual([]);
  });

  it("gives no credit for an exception with no task at all", async () => {
    await visit({ passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.byUser).toEqual([]);
  });

  it("credits both reviewers once each when a visit spawns one task per line for two different people — the documented line-level asymmetry, not a double count", async () => {
    await reviewer("u1", "Priya");
    await reviewer("u2", "Sam");
    const visitId = await visit({ passed: false, failures: "amount_mismatch", at: "2026-09-16 09:00:00" });
    await task({ visitId, completedBy: "u1" });
    await task({ visitId, completedBy: "u2" });

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.byUser.map((u) => u.userId).sort()).toEqual(["u1", "u2"]);
    expect(body.byUser.every((u) => u.total === 1)).toBe(true);
    // The one underlying exception still counts once for bySupplier/byType.
    expect(body.byType[0].total).toBe(1);
  });

  it("ranks the highest total first, and caps at the top eight", async () => {
    for (let i = 0; i < 9; i++) {
      await reviewer(`u${i}`, `User ${i}`);
      for (let n = 0; n <= i; n++) {
        const visitId = await visit({ passed: false, failures: "x", at: "2026-09-16 09:00:00" });
        await task({ visitId, completedBy: `u${i}` });
      }
    }

    const body = (await handleFraudExceptionTrends(env.DB, null, undefined, NOW)).body as FraudExceptionTrendsReport;
    expect(body.byUser).toHaveLength(8);
    expect(body.byUser[0].userId).toBe("u8");
    expect(body.byUser.map((u) => u.userId)).not.toContain("u0");
  });
});

describe("scoped the same way as fraud-duplicates and fraud-unapproved-suppliers (decision 0423)", () => {
  it("counts only exceptions within the units AP.FraudReview is held in", async () => {
    await units();
    await visit({ supplierNameFallback: "A", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-fr" });
    await visit({ supplierNameFallback: "B", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], "acme-fr");

    const body = (await handleFraudExceptionTrends(env.DB, null, "alice", NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier[0].total).toBe(1);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await visit({ supplierNameFallback: "A", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-fr" });
    await visit({ supplierNameFallback: "B", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleFraudExceptionTrends(env.DB, null, "alice", NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier[0].total).toBe(2);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await visit({ supplierNameFallback: "A", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-fr" });
    await visit({ supplierNameFallback: "B", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleFraudExceptionTrends(env.DB, "acme-fr", "alice", NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier[0].total).toBe(1);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await visit({ supplierNameFallback: "A", passed: false, failures: "x", at: "2026-09-16 09:00:00", unit: "acme-fr" });
    await person("alice", ["AP.FraudReview"], "acme-de");

    const body = (await handleFraudExceptionTrends(env.DB, "acme-fr", "alice", NOW)).body as FraudExceptionTrendsReport;
    expect(body.bySupplier).toEqual([]);
  });
});
