import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleAccruals, type AccrualsReport } from "../src/accruals-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * The accruals report — decision 0417's own follow-on, the first
 * vertical slice of the Financial Performance tab.
 *
 * **Two kinds of test here**, the same split `workload.test.ts` and
 * `supplier-spend.test.ts` each already use: the permission gate
 * proven through a real `SELF.fetch`, everything about what the data
 * actually says — the final-stage exclusion, currency-splitting,
 * stage ordering, scoping — calling `handleAccruals` directly against
 * the test DB.
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

/** A person who may show up as the viewer calling the route. */
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

/** An invoice's own process instance, sitting at a given stage, still in flight unless told otherwise. */
async function invoiceAt(opts: {
  processId: string;
  stage: string;
  total: number | null;
  currency: string | null;
  unit?: string | null;
  status?: string;
}) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, total_with_vat, currency, org_unit_id) VALUES (?, '{}', ?, ?, ?)"
  )
    .bind(invoiceId, opts.total, opts.currency, opts.unit ?? null)
    .run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, ?, 'invoice', ?, ?, ?)`
  )
    .bind(piId, opts.processId, invoiceId, opts.stage, opts.status ?? "in_progress")
    .run();
  return invoiceId;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the accruals route's own permission gate (decision 0417)", () => {
  it("GET /accruals succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/accruals", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /accruals 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/accruals");
    expect(res.status).toBe(401);
  });

  it("GET /accruals 403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch("https://example.com/accruals", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("what counts as an accrual (decision 0417)", () => {
  it("counts an invoice sitting at an earlier stage", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 3 },
    ]);
    await invoiceAt({ processId: "ap", stage: "validation", total: 100, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0].total).toBe(100);
  });

  it("excludes an invoice sitting at its own process's final, payment-eligible stage", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 3 },
    ]);
    await invoiceAt({ processId: "ap", stage: "payment-eligible", total: 500, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies).toEqual([]);
  });

  it("counts the final stage correctly per process, not a hardcoded stage count", async () => {
    // A shorter process, so "final" is stage 2 here, not 3 or 7 —
    // proving the exclusion is computed (MAX(sequence) per process),
    // never assumed from another process's own shape.
    await process("ap-short", [
      { id: "intake", name: "Intake", sequence: 1 },
      { id: "settle", name: "Settle", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap-short", stage: "intake", total: 200, currency: "GBP" });
    await invoiceAt({ processId: "ap-short", stage: "settle", total: 300, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies[0].total).toBe(200);
    expect(body.currencies[0].stages.map((s) => s.stageId)).toEqual(["intake"]);
  });

  it("excludes a process instance that has already completed", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({
      processId: "ap",
      stage: "received",
      total: 100,
      currency: "GBP",
      status: "completed",
    });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies).toEqual([]);
  });

  it("is empty, not an error, when nothing has been received yet", async () => {
    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies).toEqual([]);
  });
});

describe("never summed across currencies (decision 0417, following 0416's own discipline)", () => {
  it("gives a single currency one total", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP" });
    await invoiceAt({ processId: "ap", stage: "received", total: 50, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0]).toMatchObject({ currency: "GBP", total: 150 });
  });

  it("splits a multi-currency accrual into one figure per currency, never one blended total", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 12400, currency: "GBP" });
    await invoiceAt({ processId: "ap", stage: "received", total: 3200, currency: "EUR" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    const gbp = body.currencies.find((c) => c.currency === "GBP");
    const eur = body.currencies.find((c) => c.currency === "EUR");
    expect(gbp?.total).toBe(12400);
    expect(eur?.total).toBe(3200);
    expect(body.currencies.map((c) => c.total)).not.toContain(15600);
  });

  it("orders currencies by their own total, most significant first", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "EUR" });
    await invoiceAt({ processId: "ap", stage: "received", total: 900, currency: "USD" });
    await invoiceAt({ processId: "ap", stage: "received", total: 50, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies.map((c) => c.currency)).toEqual(["USD", "EUR", "GBP"]);
  });

  it("excludes an invoice missing a total or a currency, rather than counting it as zero", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP" });
    await invoiceAt({ processId: "ap", stage: "received", total: null, currency: null });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0].total).toBe(100);
    expect(body.currencies[0].stages[0].count).toBe(1);
  });
});

describe("broken out by stage, in process order (decision 0417)", () => {
  it("groups by stage within a currency, ordered by sequence rather than by size", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
      { id: "approval", name: "Approval", sequence: 3 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 4 },
    ]);
    // Approval (later stage) carries the larger amount, on purpose —
    // proving order follows the process, not the figure.
    await invoiceAt({ processId: "ap", stage: "approval", total: 900, currency: "GBP" });
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP" });
    await invoiceAt({ processId: "ap", stage: "validation", total: 50, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies[0].stages.map((s) => s.stageName)).toEqual(["Received", "Validation", "Approval"]);
    expect(body.currencies[0].stages.map((s) => s.total)).toEqual([100, 50, 900]);
  });

  it("sums and counts every invoice at the same stage together", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP" });
    await invoiceAt({ processId: "ap", stage: "received", total: 250, currency: "GBP" });

    const body = (await handleAccruals(env.DB)).body as AccrualsReport;
    expect(body.currencies[0].stages).toEqual([
      { stageId: "received", stageName: "Received", total: 350, count: 2 },
    ]);
  });
});

describe("scoped the same way as every other analysis query (decision 0417)", () => {
  it("counts only invoices within the units AP.Analysis is held in", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", unit: "acme-fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 200, currency: "GBP", unit: "acme-de" });
    await person("alice", ["AP.Analysis"], "acme-fr");

    const body = (await handleAccruals(env.DB, null, "alice")).body as AccrualsReport;
    expect(body.currencies[0].total).toBe(100);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", unit: "acme-fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 200, currency: "GBP", unit: "acme-de" });
    await person("alice", ["AP.Analysis"], null);

    const body = (await handleAccruals(env.DB, null, "alice")).body as AccrualsReport;
    expect(body.currencies[0].total).toBe(300);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", unit: "acme-fr" });
    await invoiceAt({ processId: "ap", stage: "received", total: 200, currency: "GBP", unit: "acme-de" });
    await person("alice", ["AP.Analysis"], null);

    const body = (await handleAccruals(env.DB, "acme-fr", "alice")).body as AccrualsReport;
    expect(body.currencies[0].total).toBe(100);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", unit: "acme-fr" });
    await person("alice", ["AP.Analysis"], "acme-de");

    const body = (await handleAccruals(env.DB, "acme-fr", "alice")).body as AccrualsReport;
    expect(body.currencies).toEqual([]);
  });
});
