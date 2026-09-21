import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleExecutiveThroughput, type ExecutiveThroughputReport } from "../src/executive-throughput-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Cross-org throughput/workload comparison — decision 0431, the
 * Multi-Enterprise CFO View's fifth and last data-buildable metric.
 * Reuses `workload-route.ts`'s own "completed in the last 7 days"
 * definition, grouped by entity instead of by user, with no stage
 * bucketing — see the route's own doc comment for why.
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

async function reviewer(id: string): Promise<void> {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
}

let seeded = false;
async function stage() {
  if (seeded) return;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  seeded = true;
}

let seq = 0;
/** One completed task, tied through a stage visit and invoice to an org unit. */
async function completedTask(opts: {
  orgUnitId?: string | null;
  completedBy?: string | null;
  completedAt?: string;
  status?: string;
}): Promise<void> {
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
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'validation', 'evaluated')"
  )
    .bind(visitId, piId)
    .run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, required_permission, stage_visit_id, completed_by, completed_at, status)
     VALUES (?, 'validation', 'AP.Review', ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      visitId,
      opts.completedBy ?? null,
      opts.completedAt ?? new Date().toISOString(),
      opts.status ?? "completed"
    )
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
  seeded = false;
});

describe("the route's own two-part gate (decision 0431, following 0425)", () => {
  it("GET /executive/throughput succeeds holding AP.Analysis everywhere", async () => {
    const key = await seedUserEverywhere(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/executive/throughput", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/executive/throughput");
    expect(res.status).toBe(401);
  });

  it("403s holding AP.Analysis, but only scoped to one unit", async () => {
    await unit("fr", "Acme France");
    const key = await seedUserScopedOnly(["AP.Analysis"], "fr");
    const res = await SELF.fetch("https://example.com/executive/throughput", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("403s holding something everywhere, but never AP.Analysis at all", async () => {
    const key = await seedUserEverywhere(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/executive/throughput", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("counts tasks completed in the last 7 days, grouped by entity (decision 0431)", () => {
  it("counts a task completed today", async () => {
    await unit("fr", "Acme France");
    await reviewer("alice");
    await completedTask({ orgUnitId: "fr", completedBy: "alice" });

    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body.entities).toEqual([{ orgUnitId: "fr", orgUnitName: "Acme France", orgUnitKind: "legal_entity", completedCount: 1 }]);
  });

  it("does not count a task completed more than 7 days ago", async () => {
    await unit("fr", "Acme France");
    await reviewer("alice");
    const tenDaysAgo = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString();
    await completedTask({ orgUnitId: "fr", completedBy: "alice", completedAt: tenDaysAgo });

    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body.entities).toEqual([]);
  });

  it("does not count an open task", async () => {
    await unit("fr", "Acme France");
    await completedTask({ orgUnitId: "fr", completedBy: null, status: "open" });

    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body.entities).toEqual([]);
  });

  it("credits every completed task to its own entity, not to the person who did it", async () => {
    await unit("fr", "Acme France");
    await reviewer("alice");
    await reviewer("bob");
    await completedTask({ orgUnitId: "fr", completedBy: "alice" });
    await completedTask({ orgUnitId: "fr", completedBy: "bob" });

    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body.entities[0].completedCount).toBe(2);
  });

  it("ranks entities by completed count, largest first, and is uncapped", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await reviewer("alice");
    await completedTask({ orgUnitId: "de", completedBy: "alice" });
    await completedTask({ orgUnitId: "fr", completedBy: "alice" });
    await completedTask({ orgUnitId: "fr", completedBy: "alice" });

    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body.entities.map((e) => e.orgUnitId)).toEqual(["fr", "de"]);
  });
});

describe("an unplaced task is excluded, not guessed into a bucket (decision 0431)", () => {
  it("does not count a completed task with no recorded org unit", async () => {
    await reviewer("alice");
    await completedTask({ orgUnitId: null, completedBy: "alice" });

    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body.entities).toEqual([]);
  });
});

describe("is empty, not an error, when nothing has been completed yet (decision 0431)", () => {
  it("returns no entities", async () => {
    const body = (await handleExecutiveThroughput(env.DB)).body as ExecutiveThroughputReport;
    expect(body).toEqual({ entities: [] });
  });
});

describe("enterprise-wide by definition — no org narrowing (decision 0431)", () => {
  it("ignores a ?org= query string entirely and still returns every entity", async () => {
    await unit("fr", "Acme France");
    await unit("de", "Acme Germany");
    await reviewer("alice");
    await completedTask({ orgUnitId: "fr", completedBy: "alice" });
    await completedTask({ orgUnitId: "de", completedBy: "alice" });
    const key = await seedUserEverywhere(["AP.Analysis"]);

    const res = await SELF.fetch("https://example.com/executive/throughput?org=fr", {
      headers: { Authorization: `Bearer ${key}` },
    });
    const body = (await res.json()) as ExecutiveThroughputReport;
    expect(body.entities.map((e) => e.orgUnitId).sort()).toEqual(["de", "fr"]);
  });
});
