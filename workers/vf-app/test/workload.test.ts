import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleWorkloadThroughput, type WorkloadThroughput } from "../src/workload-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Team throughput by stage — decision 0415, the first route and
 * screen backed by `AP.Analysis` (`permissions.ts`), reserved since
 * before this bundle and never previously read by anything.
 *
 * **Two kinds of test here.** The permission gate is proven the same
 * way `index.test.ts`'s own "decision 0276" block proves every other
 * nav-gated route's gate — a real fetch through the Worker, 200/401/
 * 403. Everything about what the data actually says — scoping,
 * bucketing, ranking, the 7-day window — calls `handleWorkloadThroughput`
 * directly against the test DB, the same shape `dashboard.test.ts`
 * already uses for its own cards.
 */

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
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-fr', 'Acme France', 'legal_entity')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO org_units (id, name, kind) VALUES ('acme-de', 'Acme DE', 'legal_entity')"
  ).run();
}

/** A person who may show up as `completed_by`, or as the viewer calling the route. */
async function person(id: string, permissions: string[], unit: string | null) {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind(id, `${id}@acme.com`, id)
    .run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)")
    .bind(id, `r-${id}`, unit)
    .run();
}

async function process(id: string, stages: { id: string; name: string; sequence: number }[]) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(id, id).run();
  for (const stage of stages) {
    await env.DB.prepare(
      "INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, ?, ?, ?)"
    )
      .bind(stage.id, id, stage.name, stage.sequence)
      .run();
  }
}

let seq = 0;

/** A task finished at a given stage, credited to whoever completed it. */
async function completedTask(opts: {
  completedBy: string;
  stage: string;
  processId: string;
  unit?: string | null;
  daysAgo?: number;
}) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const visitId = `v-${n}`;

  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id) VALUES (?, '{}', ?)")
    .bind(invoiceId, opts.unit ?? null)
    .run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, ?, 'invoice', ?, ?, 'in_progress')`
  )
    .bind(piId, opts.processId, invoiceId, opts.stage)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'matched')"
  )
    .bind(visitId, piId, opts.stage)
    .run();
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission, status, completed_by, completed_at)
     VALUES (?, ?, ?, ?, 'AP.Validate', 'completed', ?, datetime('now', ?))`
  )
    .bind(`t-${n}`, opts.stage, visitId, opts.completedBy, opts.completedBy, `-${opts.daysAgo ?? 0} days`)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the workload route's own permission gate (decision 0415)", () => {
  it("GET /workload/throughput succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/workload/throughput", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /workload/throughput 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/workload/throughput");
    expect(res.status).toBe(401);
  });

  it("GET /workload/throughput 403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch("https://example.com/workload/throughput", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("bucketing folds any number of real stages onto the 5-colour budget (decision 0415)", () => {
  it("merges Matching+Coding and Review+Payment-eligible for the real 7-stage ap-live shape", async () => {
    /**
     * The same 7 stages, same order, as the real seeded `ap-live`
     * process (`docs/operations/ap-live-process-definition.sql`) —
     * the exact case the operator's own "Merge to 5 buckets" answer
     * was about.
     */
    await process("ap-test", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
      { id: "matching", name: "Matching", sequence: 3 },
      { id: "coding", name: "Coding", sequence: 4 },
      { id: "approval", name: "Approval", sequence: 5 },
      { id: "review", name: "Review", sequence: 6 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 7 },
    ]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);

    for (const stage of [
      "received",
      "validation",
      "matching",
      "coding",
      "approval",
      "review",
      "payment-eligible",
    ]) {
      await completedTask({ completedBy: "dana", stage, processId: "ap-test" });
    }

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;

    expect(body.legend.map((b) => b.bucket)).toEqual([1, 2, 3, 4, 5]);
    expect(body.legend.map((b) => b.label)).toEqual([
      "Received",
      "Validation",
      "Matching & Coding",
      "Approval",
      "Review & Payment-eligible",
    ]);
    expect(body.legend.map((b) => b.n)).toEqual([1, 1, 2, 1, 2]);

    const dana = body.users.find((u) => u.userId === "dana");
    expect(dana?.total).toBe(7);
    expect(dana?.buckets.map((b) => b.bucket)).toEqual([1, 2, 3, 4, 5]);
  });

  it("gives a process with 5 or fewer stages one bucket per stage — nothing merges that does not have to", async () => {
    await process("ap-short", [
      { id: "s1", name: "S1", sequence: 1 },
      { id: "s2", name: "S2", sequence: 2 },
      { id: "s3", name: "S3", sequence: 3 },
    ]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);

    for (const stage of ["s1", "s2", "s3"]) {
      await completedTask({ completedBy: "dana", stage, processId: "ap-short" });
    }

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;

    expect(body.legend).toHaveLength(3);
    expect(body.legend.map((b) => b.label)).toEqual(["S1", "S2", "S3"]);
  });

  it("never hardcodes a stage name — a different customer's own stage names come through unchanged", async () => {
    // process_stages is customer-configurable data (decision 0008);
    // the bucketing is positional, so nothing here should ever read
    // literally as "Matching" or "Coding".
    await process("ap-other", [
      { id: "a", name: "Intake", sequence: 1 },
      { id: "b", name: "Triage", sequence: 2 },
      { id: "c", name: "Booking", sequence: 3 },
      { id: "d", name: "Release", sequence: 4 },
      { id: "e", name: "Settle", sequence: 5 },
      { id: "f", name: "Archive", sequence: 6 },
    ]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);

    for (const stage of ["a", "b", "c", "d", "e", "f"]) {
      await completedTask({ completedBy: "dana", stage, processId: "ap-other" });
    }

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;
    expect(body.legend).toHaveLength(5);
    expect(body.legend.every((b) => !b.label.includes("Matching") && !b.label.includes("Coding"))).toBe(true);
  });
});

describe("scoped the same way as every other analysis query (decision 0415)", () => {
  it("counts only completed work within the units AP.Analysis is held in", async () => {
    await units();
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], "acme-fr");
    await person("dana", [], null);

    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-fr" });
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-de" });

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;
    expect(body.users.find((u) => u.userId === "dana")?.total).toBe(1);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);

    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-fr" });
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-de" });

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;
    expect(body.users.find((u) => u.userId === "dana")?.total).toBe(2);
  });

  it("narrows to the chosen org, the same treatment decisions 0316/0317 gave the dashboard's own cards", async () => {
    await units();
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);

    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-fr" });
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-de" });

    const body = (await handleWorkloadThroughput(env.DB, "alice", "acme-fr")).body as WorkloadThroughput;
    expect(body.users.find((u) => u.userId === "dana")?.total).toBe(1);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], "acme-de");
    await person("dana", [], null);

    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", unit: "acme-fr" });

    const body = (await handleWorkloadThroughput(env.DB, "alice", "acme-fr")).body as WorkloadThroughput;
    expect(body.users).toEqual([]);
  });
});

describe("throughput means finished in the last 7 days (decision 0415)", () => {
  it("excludes a task completed more than 7 days ago", async () => {
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);

    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", daysAgo: 10 });
    await completedTask({ completedBy: "dana", stage: "validation", processId: "ap", daysAgo: 1 });

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;
    expect(body.users.find((u) => u.userId === "dana")?.total).toBe(1);
  });

  it("is empty, not an error, when nobody has completed anything", async () => {
    await person("alice", ["AP.Analysis"], null);

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;
    expect(body.users).toEqual([]);
    expect(body.legend).toEqual([]);
  });
});

describe("ranked by total, capped at a limit (decision 0415)", () => {
  it("orders users by total completed, most first", async () => {
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);
    await person("dana", [], null);
    await person("wei", [], null);

    for (let i = 0; i < 3; i++) {
      await completedTask({ completedBy: "dana", stage: "validation", processId: "ap" });
    }
    await completedTask({ completedBy: "wei", stage: "validation", processId: "ap" });

    const body = (await handleWorkloadThroughput(env.DB, "alice")).body as WorkloadThroughput;
    expect(body.users.map((u) => u.userId)).toEqual(["dana", "wei"]);
  });

  it("caps at the given limit — a large team does not return hundreds of near-empty bars", async () => {
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await person("alice", ["AP.Analysis"], null);

    for (const name of ["a", "b", "c"]) {
      await person(name, [], null);
      await completedTask({ completedBy: name, stage: "validation", processId: "ap" });
    }

    const body = (await handleWorkloadThroughput(env.DB, "alice", null, 2)).body as WorkloadThroughput;
    expect(body.users).toHaveLength(2);
  });
});
