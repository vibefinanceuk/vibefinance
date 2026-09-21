import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadQueueDepth, type WorkloadQueueDepthReport } from "../src/workload-queue-depth-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Team queue depth — decision 0428, the sixth of Workload's own eight
 * key metrics.
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

async function team(id: string, name: string, unit: string) {
  await env.DB.prepare("INSERT INTO org_teams (id, name, unit_id) VALUES (?, ?, ?)").bind(id, name, unit).run();
}

let seq = 0;

async function teamTask(opts: { team: string; claimedBy?: string | null }) {
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
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_team_id, claimed_by, required_permission, status)
     VALUES (?, 'validation', ?, ?, ?, 'AP.Validate', 'open')`
  )
    .bind(`t-${n}`, visitId, opts.team, opts.claimedBy ?? null)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
});

describe("the route's own permission gate", () => {
  it("GET /workload/queue-depth succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/queue-depth", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/queue-depth");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/workload/queue-depth", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("available (unclaimed) vs. locked (claimed but not finished), per team", () => {
  it("splits a team's own open tasks correctly", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await team("t1", "AP Team", "acme-fr");
    await teamTask({ team: "t1" });
    await teamTask({ team: "t1", claimedBy: "dana" });
    await teamTask({ team: "t1", claimedBy: "dana" });

    const body = (await handleWorkloadQueueDepth(env.DB, null, "alice")).body as WorkloadQueueDepthReport;
    expect(body.teams).toEqual([{ teamId: "t1", teamName: "AP Team", available: 1, locked: 2 }]);
  });

  it("keeps more than one team separate", async () => {
    await units();
    await person("alice", ["AP.Analysis"], null);
    await team("t1", "AP Team", "acme-fr");
    await team("t2", "Expense Team", "acme-fr");
    await teamTask({ team: "t1" });
    await teamTask({ team: "t2" });
    await teamTask({ team: "t2" });

    const body = (await handleWorkloadQueueDepth(env.DB, null, "alice")).body as WorkloadQueueDepthReport;
    expect(body.teams.map((t) => t.teamId)).toEqual(["t2", "t1"]);
  });

  it("scopes by the team's own org unit", async () => {
    await units();
    await person("alice", ["AP.Analysis"], "acme-fr");
    await team("t1", "France Team", "acme-fr");
    await team("t2", "Germany Team", "acme-de");
    await teamTask({ team: "t1" });
    await teamTask({ team: "t2" });

    const body = (await handleWorkloadQueueDepth(env.DB, null, "alice")).body as WorkloadQueueDepthReport;
    expect(body.teams.map((t) => t.teamId)).toEqual(["t1"]);
  });

  it("is empty, not an error, when nothing is open", async () => {
    await person("alice", ["AP.Analysis"], null);
    const body = (await handleWorkloadQueueDepth(env.DB, null, "alice")).body as WorkloadQueueDepthReport;
    expect(body.teams).toEqual([]);
  });
});
