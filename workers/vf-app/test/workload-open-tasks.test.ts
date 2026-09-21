import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadOpenTasks, type WorkloadOpenTasksReport } from "../src/workload-open-tasks-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Open task count by user, split by ownership — decision 0428, the
 * second of Workload's own eight key metrics.
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

let seq = 0;

/** An open task, either named-user-owned or team-owned-and-optionally-claimed, against an invoice in a given unit. */
async function openTask(opts: { owner?: string | null; team?: string | null; claimedBy?: string | null; unit?: string | null }) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const visitId = `v-${n}`;

  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, '{}', ?)").bind(invoiceId, opts.unit ?? null).run();
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
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, claimed_by, required_permission, status)
     VALUES (?, 'validation', ?, ?, ?, ?, 'AP.Validate', 'open')`
  )
    .bind(`t-${n}`, visitId, opts.owner ?? null, opts.team ?? null, opts.claimedBy ?? null)
    .run();
}

async function team(id: string, unit: string) {
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, ?, ?)").bind(id, id, unit).run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/open-tasks succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/open-tasks", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/open-tasks");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/open-tasks", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("per-user counts, not a per-viewer relative status", () => {
  it("credits a named-user task to its owner", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await openTask({ owner: "dana" });

    const body = (await handleWorkloadOpenTasks(env.DB, null, "alice")).body as WorkloadOpenTasksReport;
    expect(body.users).toEqual([{ userId: "dana", userName: "dana", openCount: 1 }]);
    expect(body.available).toBe(0);
  });

  it("credits a claimed team task to whoever claimed it", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await team("t1", "acme-fr");
    await openTask({ team: "t1", claimedBy: "dana" });

    const body = (await handleWorkloadOpenTasks(env.DB, null, "alice")).body as WorkloadOpenTasksReport;
    expect(body.users).toEqual([{ userId: "dana", userName: "dana", openCount: 1 }]);
  });

  it("counts an unclaimed team task as available, not credited to anyone", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await team("t1", "acme-fr");
    await openTask({ team: "t1" });

    const body = (await handleWorkloadOpenTasks(env.DB, null, "alice")).body as WorkloadOpenTasksReport;
    expect(body.users).toEqual([]);
    expect(body.available).toBe(1);
  });

  it("sums more than one open task for the same user, ranked by count", async () => {
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await openTask({ owner: "dana" });
    await openTask({ owner: "dana" });
    await openTask({ owner: "wei" });

    const body = (await handleWorkloadOpenTasks(env.DB, null, "alice")).body as WorkloadOpenTasksReport;
    expect(body.users.map((u) => u.userId)).toEqual(["dana", "wei"]);
    expect(body.users[0].openCount).toBe(2);
  });
});

describe("scoped by the task's own invoice, the same as every other Workload route", () => {
  it("counts only within units AP.Analysis is held in", async () => {
    await units();
    await person("alice", ["AP.Analysis"], "acme-fr");
    await person("dana", [], null);
    await openTask({ owner: "dana", unit: "acme-fr" });
    await openTask({ owner: "dana", unit: "acme-de" });

    const body = (await handleWorkloadOpenTasks(env.DB, null, "alice")).body as WorkloadOpenTasksReport;
    expect(body.users.find((u) => u.userId === "dana")?.openCount).toBe(1);
  });

  it("is empty, not an error, when nothing is open", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadOpenTasks(env.DB, null, "alice")).body as WorkloadOpenTasksReport;
    expect(body.users).toEqual([]);
    expect(body.available).toBe(0);
  });
});
