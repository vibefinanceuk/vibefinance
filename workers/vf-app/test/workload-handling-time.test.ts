import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadHandlingTime, type WorkloadHandlingTimeReport } from "../src/workload-handling-time-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Average handling time by stage and by user — decision 0428, the
 * third of Workload's own eight key metrics.
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

async function process(id: string, stages: { id: string; name: string; sequence: number }[]) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(id, id).run();
  for (const stage of stages) {
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, ?, ?, ?)")
      .bind(stage.id, id, stage.name, stage.sequence)
      .run();
  }
}

let seq = 0;

/** A completed task, optionally claimed some hours before it was completed. */
async function completedTask(opts: { completedBy: string; stage: string; processId: string; claimedHoursBefore?: number | null }) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const visitId = `v-${n}`;

  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')").bind(invoiceId).run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, ?, 'invoice', ?, ?, 'in_progress')`
  )
    .bind(piId, opts.processId, invoiceId, opts.stage)
    .run();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'matched')")
    .bind(visitId, piId, opts.stage)
    .run();

  const wasClaimed = opts.claimedHoursBefore !== undefined && opts.claimedHoursBefore !== null;
  const claimedAtExpr = wasClaimed ? `datetime('now', '-${opts.claimedHoursBefore} hours')` : "NULL";

  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, claimed_by, claimed_at, completed_by, completed_at)
     VALUES (?, ?, ?, ?, 'AP.Validate', 'completed', ?, ${claimedAtExpr}, ?, datetime('now'))`
  )
    .bind(`t-${n}`, opts.stage, visitId, opts.completedBy, wasClaimed ? opts.completedBy : null, opts.completedBy)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/handling-time succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/handling-time", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/handling-time");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/handling-time", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("claim-to-complete, grouped by stage and user", () => {
  it("averages hours from claimed_at to completed_at, not created_at", async () => {
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", claimedHoursBefore: 4 });

    const body = (await handleWorkloadHandlingTime(env.DB, null, "alice")).body as WorkloadHandlingTimeReport;
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ stageId: "validation", userId: "dana", n: 1 });
    expect(body.rows[0].avgHours).toBeCloseTo(4, 1);
  });

  it("averages more than one task for the same stage and user", async () => {
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", claimedHoursBefore: 2 });
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", claimedHoursBefore: 6 });

    const body = (await handleWorkloadHandlingTime(env.DB, null, "alice")).body as WorkloadHandlingTimeReport;
    expect(body.rows[0].n).toBe(2);
    expect(body.rows[0].avgHours).toBeCloseTo(4, 1);
  });

  it("keeps two stages, or two users, as separate rows", async () => {
    await process("ap", [
      { id: "validation", name: "Validation", sequence: 1 },
      { id: "matching", name: "Matching", sequence: 2 },
    ]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", claimedHoursBefore: 1 });
    await completedTask({ completedBy: "dana", stage: "matching", processId: "ap", claimedHoursBefore: 2 });
    await completedTask({ completedBy: "wei", stage: "validation", processId: "ap", claimedHoursBefore: 3 });

    const body = (await handleWorkloadHandlingTime(env.DB, null, "alice")).body as WorkloadHandlingTimeReport;
    expect(body.rows).toHaveLength(3);
  });

  it("excludes a task with no claimed_at at all — a named-user task, no claiming step to measure from", async () => {
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", claimedHoursBefore: null });

    const body = (await handleWorkloadHandlingTime(env.DB, null, "alice")).body as WorkloadHandlingTimeReport;
    expect(body.rows).toEqual([]);
  });

  it("is empty, not an error, when nothing has been completed", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadHandlingTime(env.DB, null, "alice")).body as WorkloadHandlingTimeReport;
    expect(body.rows).toEqual([]);
  });
});
