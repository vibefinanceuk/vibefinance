import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadExceptions, type WorkloadExceptionsReport } from "../src/workload-exceptions-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Exceptions by user — decision 0428, the eighth and last of
 * Workload's own eight key metrics. See the route's own doc comment
 * for why this reuses decision 0423's own `byUser` join rather than
 * inventing a new one, under a different gate and framing.
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

async function exceptionTask(opts: { completedBy: string; passed?: boolean; daysAgo?: number }) {
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
  await env.DB.prepare(
    `INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, created_at)
     VALUES (?, ?, 'validation', 'matched', ?, datetime('now', ?))`
  )
    .bind(visitId, piId, opts.passed ? 1 : 0, `-${opts.daysAgo ?? 0} days`)
    .run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, completed_by, completed_at)
     VALUES (?, 'validation', ?, ?, 'AP.Validate', 'completed', ?, datetime('now'))`
  )
    .bind(`t-${n}`, visitId, opts.completedBy, opts.completedBy)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/exceptions succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/exceptions", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/exceptions");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/exceptions", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("credited to whoever completed the failing visit's own task", () => {
  it("counts a failed visit's completed task", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await exceptionTask({ completedBy: "dana", passed: false });

    const body = (await handleWorkloadExceptions(env.DB, null, "alice")).body as WorkloadExceptionsReport;
    expect(body.users).toEqual([{ userId: "dana", userName: "dana", n: 1 }]);
  });

  it("does not count a passing visit", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await exceptionTask({ completedBy: "dana", passed: true });

    const body = (await handleWorkloadExceptions(env.DB, null, "alice")).body as WorkloadExceptionsReport;
    expect(body.users).toEqual([]);
  });

  it("excludes an exception older than the 90-day window", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await exceptionTask({ completedBy: "dana", passed: false, daysAgo: 100 });

    const body = (await handleWorkloadExceptions(env.DB, null, "alice")).body as WorkloadExceptionsReport;
    expect(body.users).toEqual([]);
  });

  it("ranks users by exception count, most first", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await exceptionTask({ completedBy: "dana", passed: false });
    await exceptionTask({ completedBy: "dana", passed: false });
    await exceptionTask({ completedBy: "wei", passed: false });

    const body = (await handleWorkloadExceptions(env.DB, null, "alice")).body as WorkloadExceptionsReport;
    expect(body.users.map((u) => u.userId)).toEqual(["dana", "wei"]);
  });

  it("is empty, not an error, when there are no exceptions", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadExceptions(env.DB, null, "alice")).body as WorkloadExceptionsReport;
    expect(body.users).toEqual([]);
  });
});
