import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadBalance, type WorkloadBalanceReport } from "../src/workload-balance-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Workload balance — decision 0428, the seventh of Workload's own
 * eight key metrics.
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
}

async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)").bind(id, `r-${id}`, unit).run();
}

async function team(id: string, name: string, unit: string) {
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, ?, ?)").bind(id, name, unit).run();
}

async function member(teamId: string, userId: string) {
  await env.DB.prepare("INSERT INTO org_team_members (team_id, user_id) VALUES (?, ?)").bind(teamId, userId).run();
}

let seq = 0;

/**
 * `team` is optional — decision 0428's own scoping change, once
 * production data showed a member's *whole* workload read as
 * duplication when they belonged to more than one team. Most tests
 * pass the owning team explicitly now; a task with no team at all
 * (`team` omitted) proves the route's own team-ownership filter really
 * excludes it rather than counting every task a member merely touches.
 */
async function openTask(owner: string, team?: string) {
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
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, owner_team_id, required_permission, status)
     VALUES (?, 'validation', ?, ?, ?, 'AP.Validate', 'open')`
  )
    .bind(`t-${n}`, visitId, owner, team ?? null)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/balance succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/balance", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/balance");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/balance", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("variance in open-task count across a team's own members", () => {
  it("includes a member with zero open tasks, not just the ones carrying work", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await team("t1", "AP Team", "acme-fr");
    await member("t1", "dana");
    await member("t1", "wei");
    await openTask("dana", "t1");

    const body = (await handleWorkloadBalance(env.DB, null, "alice")).body as WorkloadBalanceReport;
    expect(body.teams[0].members).toEqual(
      expect.arrayContaining([
        { userId: "dana", userName: "dana", openCount: 1 },
        { userId: "wei", userName: "wei", openCount: 0 },
      ])
    );
  });

  it("computes variance and stdDev correctly for an unbalanced team", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await team("t1", "AP Team", "acme-fr");
    await member("t1", "dana");
    await member("t1", "wei");
    for (let i = 0; i < 4; i++) await openTask("dana", "t1");
    // wei: 0

    const body = (await handleWorkloadBalance(env.DB, null, "alice")).body as WorkloadBalanceReport;
    // counts [4, 0], mean 2, variance = ((4-2)^2 + (0-2)^2)/2 = 4
    expect(body.teams[0].mean).toBeCloseTo(2, 5);
    expect(body.teams[0].variance).toBeCloseTo(4, 5);
    expect(body.teams[0].stdDev).toBeCloseTo(2, 5);
  });

  it("ranks the most imbalanced team first", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);
    await person("sam", [], null);
    await person("ravi", [], null);
    await team("balanced", "Balanced Team", "acme-fr");
    await member("balanced", "dana");
    await member("balanced", "wei");
    await openTask("dana", "balanced");
    await openTask("wei", "balanced");

    await team("unbalanced", "Unbalanced Team", "acme-fr");
    await member("unbalanced", "sam");
    await member("unbalanced", "ravi");
    for (let i = 0; i < 5; i++) await openTask("sam", "unbalanced");
    // ravi: 0

    const body = (await handleWorkloadBalance(env.DB, null, "alice")).body as WorkloadBalanceReport;
    expect(body.teams.map((t) => t.teamId)).toEqual(["unbalanced", "balanced"]);
  });

  it("is empty, not an error, when there are no teams in scope", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadBalance(env.DB, null, "alice")).body as WorkloadBalanceReport;
    expect(body.teams).toEqual([]);
  });

  it("scopes a member's own count to tasks this specific team owns, not their whole workload — decision 0428's own live fix", async () => {
    /**
     * **The exact shape of the bug report.** One person, "dana," on
     * two real teams — before this fix, both cards would have shown
     * her identical whole-workload total (3). Team-scoping means each
     * team now shows only the tasks it itself owns.
     */
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await team("t1", "AP Coding", "acme-fr");
    await team("t2", "AP Validation", "acme-fr");
    await member("t1", "dana");
    await member("t2", "dana");
    await openTask("dana", "t1");
    await openTask("dana", "t1");
    await openTask("dana", "t2");

    const body = (await handleWorkloadBalance(env.DB, null, "alice")).body as WorkloadBalanceReport;
    const t1 = body.teams.find((t) => t.teamId === "t1");
    const t2 = body.teams.find((t) => t.teamId === "t2");
    expect(t1?.members).toEqual([{ userId: "dana", userName: "dana", openCount: 2 }]);
    expect(t2?.members).toEqual([{ userId: "dana", userName: "dana", openCount: 1 }]);
  });

  it("does not count a task with no owning team at all, even when it's genuinely this member's own", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await team("t1", "AP Team", "acme-fr");
    await member("t1", "dana");
    await openTask("dana"); // no owning team

    const body = (await handleWorkloadBalance(env.DB, null, "alice")).body as WorkloadBalanceReport;
    expect(body.teams[0].members).toEqual([{ userId: "dana", userName: "dana", openCount: 0 }]);
  });
});
