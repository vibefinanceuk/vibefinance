import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadCycleTime, type WorkloadCycleTimeReport } from "../src/workload-cycle-time-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Claim-to-complete cycle time — decision 0428, the fourth of
 * Workload's own eight key metrics.
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

async function completedTask(opts: { completedBy: string; claimedHoursBefore?: number | null }) {
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

  const wasClaimed = opts.claimedHoursBefore !== undefined && opts.claimedHoursBefore !== null;
  const claimedAtExpr = wasClaimed ? `datetime('now', '-${opts.claimedHoursBefore} hours')` : "NULL";

  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, claimed_by, claimed_at, completed_by, completed_at)
     VALUES (?, 'validation', ?, ?, 'AP.Validate', 'completed', ?, ${claimedAtExpr}, ?, datetime('now'))`
  )
    .bind(`t-${n}`, visitId, opts.completedBy, wasClaimed ? opts.completedBy : null, opts.completedBy)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/cycle-time succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/cycle-time", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/cycle-time");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/cycle-time", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("one average per user, not broken out by stage", () => {
  it("averages claim-to-complete hours across every stage together", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await completedTask({ completedBy: "dana", claimedHoursBefore: 2 });
    await completedTask({ completedBy: "dana", claimedHoursBefore: 6 });

    const body = (await handleWorkloadCycleTime(env.DB, null, "alice")).body as WorkloadCycleTimeReport;
    expect(body.users).toHaveLength(1);
    expect(body.users[0]).toMatchObject({ userId: "dana", n: 2 });
    expect(body.users[0].avgHours).toBeCloseTo(4, 1);
  });

  it("ranks users by average hours, slowest first", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await completedTask({ completedBy: "dana", claimedHoursBefore: 1 });
    await completedTask({ completedBy: "wei", claimedHoursBefore: 10 });

    const body = (await handleWorkloadCycleTime(env.DB, null, "alice")).body as WorkloadCycleTimeReport;
    expect(body.users.map((u) => u.userId)).toEqual(["wei", "dana"]);
  });

  it("excludes a task with no claimed_at — no claim event to measure from", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await completedTask({ completedBy: "dana", claimedHoursBefore: null });

    const body = (await handleWorkloadCycleTime(env.DB, null, "alice")).body as WorkloadCycleTimeReport;
    expect(body.users).toEqual([]);
  });

  it("is empty, not an error, when nothing has been completed", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadCycleTime(env.DB, null, "alice")).body as WorkloadCycleTimeReport;
    expect(body.users).toEqual([]);
  });
});
