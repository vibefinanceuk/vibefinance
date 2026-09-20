import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierCycleTime, type SupplierCycleTimeReport } from "../src/supplier-cycle-time-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Average cycle time by supplier — decision 0421, one of the six
 * remaining vertical slices of the Supplier Performance screen.
 *
 * **Two kinds of test here**, the same split every other analysis
 * route's own test file already uses: the permission gate proven
 * through a real `SELF.fetch`, everything about what the data
 * actually says calling `handleSupplierCycleTime` directly.
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

async function supplier(id: string, name: string, unit: string | null = null) {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, org_unit_id) VALUES (?, ?, ?, ?)")
    .bind(id, id, name, unit)
    .run();
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

/** An invoice for a supplier, with a process instance that started at `startedAt` and visited the given stages, each with its own timestamp. */
async function invoiceWithVisits(opts: {
  supplierId: string;
  processId: string;
  startedAt: string;
  visits: { stage: string; at: string }[];
  currentStage: string;
}) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, '{}', ?)")
    .bind(invoiceId, opts.supplierId)
    .run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status, created_at)
     VALUES (?, ?, 'invoice', ?, ?, 'in_progress', ?)`
  )
    .bind(piId, opts.processId, invoiceId, opts.currentStage, opts.startedAt)
    .run();
  for (const v of opts.visits) {
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, ?, 'automatic', ?)"
    )
      .bind(crypto.randomUUID(), piId, v.stage, v.at)
      .run();
  }
  return invoiceId;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the supplier cycle time route's own permission gate (decision 0421)", () => {
  it("GET /suppliers/cycle-time succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/cycle-time", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /suppliers/cycle-time 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/cycle-time");
    expect(res.status).toBe(401);
  });

  it("GET /suppliers/cycle-time 403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/suppliers/cycle-time", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("receipt to payment-eligible (decision 0421)", () => {
  it("computes the average days from receipt to reaching the final stage", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s1", "Northwind");
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-06 00:00:00" }],
      currentStage: "payment-eligible",
    });

    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers).toEqual([{ supplierId: "s1", supplierName: "Northwind", averageDays: 5, invoiceCount: 1 }]);
  });

  it("excludes an invoice that has not yet reached the final stage", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s1", "Northwind");
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "received", at: "2026-01-01 00:00:00" }],
      currentStage: "received",
    });

    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers).toEqual([]);
  });

  it("averages across multiple completed invoices for the same supplier", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s1", "Northwind");
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-03 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-07 00:00:00" }],
      currentStage: "payment-eligible",
    });

    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers).toEqual([{ supplierId: "s1", supplierName: "Northwind", averageDays: 4, invoiceCount: 2 }]);
  });

  it("uses the first visit to the final stage, not a later revisit", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s1", "Northwind");
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [
        { stage: "payment-eligible", at: "2026-01-04 00:00:00" },
        { stage: "payment-eligible", at: "2026-01-09 00:00:00" }, // a later revisit — decision 0025
      ],
      currentStage: "payment-eligible",
    });

    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers[0].averageDays).toBe(3);
  });

  it("computes the final stage correctly per process, not a hardcoded stage count", async () => {
    await process("ap-short", [
      { id: "intake", name: "Intake", sequence: 1 },
      { id: "settle", name: "Settle", sequence: 2 },
    ]);
    await supplier("s1", "Northwind");
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap-short",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "settle", at: "2026-01-02 00:00:00" }],
      currentStage: "settle",
    });

    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers[0].averageDays).toBe(1);
  });

  it("ranks the slowest supplier first", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s1", "Fast Co");
    await supplier("s2", "Slow Co");
    await invoiceWithVisits({
      supplierId: "s1",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await invoiceWithVisits({
      supplierId: "s2",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-15 00:00:00" }],
      currentStage: "payment-eligible",
    });

    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s2", "s1"]);
  });

  it("is empty, not an error, when nothing has reached the final stage yet", async () => {
    const body = (await handleSupplierCycleTime(env.DB)).body as SupplierCycleTimeReport;
    expect(body.suppliers).toEqual([]);
  });
});

describe("scoped the same way the rest of this screen already is (decision 0421)", () => {
  it("counts only invoices within the units AP.Supplier is held in", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await invoiceWithVisits({
      supplierId: "s-fr",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await invoiceWithVisits({
      supplierId: "s-de",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await person("alice", ["AP.Supplier"], "acme-fr");

    const body = (await handleSupplierCycleTime(env.DB, null, "alice")).body as SupplierCycleTimeReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await invoiceWithVisits({
      supplierId: "s-fr",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await invoiceWithVisits({
      supplierId: "s-de",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierCycleTime(env.DB, null, "alice")).body as SupplierCycleTimeReport;
    expect(body.suppliers.map((s) => s.supplierId).sort()).toEqual(["s-de", "s-fr"]);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await invoiceWithVisits({
      supplierId: "s-fr",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await invoiceWithVisits({
      supplierId: "s-de",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierCycleTime(env.DB, "acme-fr", "alice")).body as SupplierCycleTimeReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await invoiceWithVisits({
      supplierId: "s-fr",
      processId: "ap",
      startedAt: "2026-01-01 00:00:00",
      visits: [{ stage: "payment-eligible", at: "2026-01-02 00:00:00" }],
      currentStage: "payment-eligible",
    });
    await person("alice", ["AP.Supplier"], "acme-de");

    const body = (await handleSupplierCycleTime(env.DB, "acme-fr", "alice")).body as SupplierCycleTimeReport;
    expect(body.suppliers).toEqual([]);
  });
});
