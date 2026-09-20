import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSegregationOfDuties, type SegregationOfDutiesReport } from "../src/fraud-segregation-of-duties-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Segregation-of-duties flags — decision 0424, Fraud Prevention's fifth
 * real metric: the same person claiming and approving where the
 * process should prevent it. Anchored on `AP.Approve` specifically,
 * paired generically with any other distinct declared permission the
 * same person completed on the same invoice — see
 * `fraud-segregation-of-duties-route.ts`'s own doc comment for the full
 * reasoning.
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

async function reviewer(id: string, name: string): Promise<void> {
  await env.DB.prepare("INSERT OR IGNORE INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, name).run();
}

let seeded = false;
/** The ap-live-shaped process this route reasons about: Validation and Approval, each declaring its own permission — decision 0048/0080's own pattern, not hardcoded stage ids. */
async function stages() {
  if (seeded) return;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, required_permission) VALUES ('validation', 'ap', 'Validation', 1, 'AP.Validate')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, required_permission) VALUES ('coding', 'ap', 'Coding', 2, 'AP.Code')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, required_permission) VALUES ('approval', 'ap', 'Approval', 3, 'AP.Approve')"
  ).run();
  // A pass-through stage with no declared permission at all — decision 0080's own automatic stages.
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence, required_permission) VALUES ('matching', 'ap', 'Matching', 4, NULL)"
  ).run();
  seeded = true;
}

let seq = 0;
/** One invoice with one process instance, ready to carry stage visits and tasks. */
async function invoice(opts: { unit?: string | null; invoiceNumber?: string } = {}): Promise<{ invoiceId: string; piId: string }> {
  await stages();
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, org_unit_id, invoice_number) VALUES (?, '{}', ?, ?)")
    .bind(invoiceId, opts.unit ?? null, opts.invoiceNumber ?? invoiceId)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')"
  )
    .bind(piId, invoiceId)
    .run();
  return { invoiceId, piId };
}

// tasks.required_permission is NOT NULL (migration 0008) even at a stage
// that itself declares none — the rule that fired assign_task supplies its
// own permission independent of the stage (migration 0008's own doc
// comment); the route filters on the STAGE's declared permission
// (process_stages.required_permission), never the task's own field, which
// is exactly what the "matching" (no-permission-stage) test below exercises.
const STAGE_TASK_PERMISSION: Record<string, string> = {
  validation: "AP.Validate",
  coding: "AP.Code",
  approval: "AP.Approve",
  matching: "AP.Match",
};

let completionCounter = 0;
/** One completed task at a named stage, tied to a stage visit on the given process instance — the only way a task carries the invoice/user attribution this route reads. A strictly increasing completed_at (rather than the wall clock) keeps completion-order assertions from depending on real elapsed time between awaits. */
async function completedTask(opts: { piId: string; stageId: string; completedBy: string; status?: string; at?: string }): Promise<void> {
  const visitId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES (?, ?, ?, 'evaluated')")
    .bind(visitId, opts.piId, opts.stageId)
    .run();
  const at = opts.at ?? `2026-01-01T00:00:${String(completionCounter++).padStart(2, "0")}.000Z`;
  await env.DB.prepare(
    `INSERT INTO tasks (id, stage_id, required_permission, stage_visit_id, completed_by, completed_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      opts.stageId,
      STAGE_TASK_PERMISSION[opts.stageId],
      visitId,
      opts.completedBy,
      opts.status === "open" ? null : at,
      opts.status ?? "completed"
    )
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  seq = 0;
  seeded = false;
  completionCounter = 0;
});

describe("the route's own permission gate (decision 0424)", () => {
  it("GET /fraud/segregation-of-duties succeeds with AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.FraudReview"]);
    const res = await SELF.fetch("https://example.com/fraud/segregation-of-duties", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /fraud/segregation-of-duties 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/fraud/segregation-of-duties");
    expect(res.status).toBe(401);
  });

  it("GET /fraud/segregation-of-duties 403s authenticated but lacking AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/fraud/segregation-of-duties", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("holding AP.Approve alone is not enough — this is its own gate, not riding on it", async () => {
    const key = await seedUserWithPermissions(["AP.Approve"]);
    const res = await SELF.fetch("https://example.com/fraud/segregation-of-duties", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("the core rule — the same completed_by on Approve and on some other declared permission (decision 0424)", () => {
  it("flags a person who both coded and approved the same invoice", async () => {
    await reviewer("u1", "Priya");
    const { invoiceId, piId } = await invoice();
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0]).toMatchObject({ invoiceId, userId: "u1", userName: "Priya" });
    expect(body.invoices[0].stages.map((s) => s.requiredPermission).sort()).toEqual(["AP.Approve", "AP.Code"]);
  });

  it("does not flag a person who only approved, with no other stage completed", async () => {
    await reviewer("u1", "Priya");
    const { piId } = await invoice();
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });

  it("does not flag a person who only validated and coded, with no approval at all", async () => {
    await reviewer("u1", "Priya");
    const { piId } = await invoice();
    await completedTask({ piId, stageId: "validation", completedBy: "u1" });
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });

  it("does not flag two different people each doing one stage — segregation working as intended", async () => {
    await reviewer("u1", "Priya");
    await reviewer("u2", "Sam");
    const { piId } = await invoice();
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u2" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });

  it("gives no credit for a task still open — only completed_by counts", async () => {
    await reviewer("u1", "Priya");
    const { piId } = await invoice();
    await completedTask({ piId, stageId: "coding", completedBy: "u1", status: "open" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });
});

describe("a pass-through stage with no declared permission never contributes (decision 0424)", () => {
  it("does not flag a person who completed a no-permission stage plus approval", async () => {
    await reviewer("u1", "Priya");
    const { piId } = await invoice();
    await completedTask({ piId, stageId: "matching", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });
});

describe("one flag per invoice, listing every stage the person completed on it (decision 0424)", () => {
  it("lists all of that person's own completed stages on the invoice, sorted by completion order", async () => {
    await reviewer("u1", "Priya");
    const { piId } = await invoice();
    await completedTask({ piId, stageId: "validation", completedBy: "u1" });
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body.invoices).toHaveLength(1);
    expect(body.invoices[0].stages.map((s) => s.requiredPermission)).toEqual(["AP.Validate", "AP.Code", "AP.Approve"]);
  });
});

describe("is empty, not an error, when nothing has been completed yet (decision 0424)", () => {
  it("returns an empty worklist with no tasks at all", async () => {
    const body = (await handleSegregationOfDuties(env.DB, null, undefined)).body as SegregationOfDutiesReport;
    expect(body).toEqual({ invoices: [] });
  });
});

describe("scoped the same way as the other Fraud Prevention routes (decision 0424)", () => {
  it("counts only invoices within the units AP.FraudReview is held in", async () => {
    await units();
    await reviewer("u1", "Priya");
    await person("alice", ["AP.FraudReview"], "acme-de");

    const { piId } = await invoice({ unit: "acme-fr" });
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });

    const body = (await handleSegregationOfDuties(env.DB, null, "alice")).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await reviewer("u1", "Priya");
    const { piId } = await invoice({ unit: "acme-fr" });
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleSegregationOfDuties(env.DB, null, "alice")).body as SegregationOfDutiesReport;
    expect(body.invoices).toHaveLength(1);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await reviewer("u1", "Priya");
    const { piId } = await invoice({ unit: "acme-de" });
    await completedTask({ piId, stageId: "coding", completedBy: "u1" });
    await completedTask({ piId, stageId: "approval", completedBy: "u1" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handleSegregationOfDuties(env.DB, "acme-fr", "alice")).body as SegregationOfDutiesReport;
    expect(body.invoices).toEqual([]);
  });
});
