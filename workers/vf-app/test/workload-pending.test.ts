import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadPending, type WorkloadPendingReport } from "../src/workload-pending-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Tasks pending action over a configurable period — decision 0428, the
 * fifth of Workload's own eight key metrics. Only this half; see the
 * route's own doc comment for why "approaching/past due" is not built.
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

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

let seq = 0;

async function openTask(opts: { owner?: string | null; team?: string | null; claimedBy?: string | null; ageDays: number }) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const visitId = `v-${n}`;

  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')").bind(invoiceId).run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')`
  )
    .bind(piId, invoiceId)
    .run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, 'validation', 'matched')")
    .bind(visitId, piId)
    .run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, claimed_by, required_permission, status, created_at)
     VALUES (?, 'validation', ?, ?, ?, ?, 'AP.Validate', 'open', datetime('now', '-${opts.ageDays} days'))`
  )
    .bind(`t-${n}`, visitId, opts.owner ?? null, opts.team ?? null, opts.claimedBy ?? null)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/pending succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/pending", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/pending");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/pending", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("three age thresholds, measured from created_at", () => {
  it("counts a task past every threshold it's actually old enough for", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await openTask({ owner: "dana", ageDays: 20 });

    const body = (await handleWorkloadPending(env.DB, null, "alice")).body as WorkloadPendingReport;
    expect(body.thresholdsDays).toEqual([3, 7, 14]);
    expect(body.users[0].counts).toEqual([1, 1, 1]);
  });

  it("counts a task only for the thresholds it clears", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await openTask({ owner: "dana", ageDays: 5 });

    const body = (await handleWorkloadPending(env.DB, null, "alice")).body as WorkloadPendingReport;
    expect(body.users[0].counts).toEqual([1, 0, 0]);
  });

  it("doesn't count a task younger than every threshold", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await openTask({ owner: "dana", ageDays: 1 });

    const body = (await handleWorkloadPending(env.DB, null, "alice")).body as WorkloadPendingReport;
    expect(body.users).toEqual([]);
  });

  it("counts an unclaimed old task under unclaimed, not a user", async () => {
    await person("alice", ["AP.Analysis"], null);
    await openTask({ ageDays: 20 });

    const body = (await handleWorkloadPending(env.DB, null, "alice")).body as WorkloadPendingReport;
    expect(body.users).toEqual([]);
    expect(body.unclaimed).toEqual([1, 1, 1]);
  });

  it("is empty, not an error, when nothing is open", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadPending(env.DB, null, "alice")).body as WorkloadPendingReport;
    expect(body.users).toEqual([]);
    expect(body.unclaimed).toEqual([0, 0, 0]);
  });
});
