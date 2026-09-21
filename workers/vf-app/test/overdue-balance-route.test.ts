import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleOverdueBalance, type OverdueBalanceReport } from "../src/overdue-balance-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Overdue balance, by supplier — decision 0430, built to answer the
 * AP Assistant's own worked example question, not as a new Financial
 * Performance card. Reuses decision 0417's own accrual definition (in
 * flight, not at the process's own final stage) and adds: BT-9 due
 * date already passed.
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

async function process(id: string, stages: { id: string; name: string; sequence: number }[]) {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(id, id).run();
  for (const stage of stages) {
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, ?, ?, ?)")
      .bind(stage.id, id, stage.name, stage.sequence)
      .run();
  }
}

async function supplier(id: string, name: string) {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name) VALUES (?, ?, ?)").bind(id, id, name).run();
}

let seq = 0;

async function invoiceAt(opts: {
  processId: string;
  stage: string;
  total: number | null;
  currency: string | null;
  dueDate?: string | null;
  supplierId?: string | null;
  status?: string;
}) {
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const facts = opts.dueDate ? JSON.stringify({ "BT-9": opts.dueDate }) : "{}";
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, total_with_vat, currency, supplier_id) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(invoiceId, facts, opts.total, opts.currency, opts.supplierId ?? null)
    .run();
  await env.DB.prepare(
    `INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status)
     VALUES (?, ?, 'invoice', ?, ?, ?)`
  )
    .bind(piId, opts.processId, invoiceId, opts.stage, opts.status ?? "in_progress")
    .run();
  return invoiceId;
}

const TODAY = new Date("2026-09-21T00:00:00Z");

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the overdue-balance route's own permission gate (decision 0430)", () => {
  it("GET /liabilities/overdue-balance succeeds with AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/liabilities/overdue-balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /liabilities/overdue-balance 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/liabilities/overdue-balance");
    expect(res.status).toBe(401);
  });

  it("GET /liabilities/overdue-balance 403s authenticated but lacking AP.Analysis", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/liabilities/overdue-balance", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("what counts as overdue (decision 0430)", () => {
  it("counts a still-open invoice whose due date has passed", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await supplier("acme", "Acme Widgets");
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", dueDate: "2026-09-01", supplierId: "acme" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([{ supplierId: "acme", supplierName: "Acme Widgets", currency: "GBP", total: 100, count: 1 }]);
  });

  it("excludes an invoice whose due date has not passed yet", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", dueDate: "2026-10-01" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes an invoice with no due date at all — a fact this system cannot read cannot be counted either way", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes an invoice at its own process's final, payment-eligible stage even though its due date has passed — reached readiness to pay, so it's no longer an accrual", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "payment-eligible", total: 500, currency: "GBP", dueDate: "2026-01-01" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes a process instance that has already completed", async () => {
    await process("ap", [
      { id: "received", name: "Received", sequence: 1 },
      { id: "payment-eligible", name: "Payment-eligible", sequence: 2 },
    ]);
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", dueDate: "2026-01-01", status: "completed" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([]);
  });

  it("is empty, not an error, when nothing is overdue", async () => {
    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([]);
  });
});

describe("grouped by (supplier, currency), never summed across currencies", () => {
  it("groups a supplier billed in one currency across several overdue invoices into one total", async () => {
    await process("ap", [{ id: "received", name: "Received", sequence: 1 }, { id: "eligible", name: "Eligible", sequence: 2 }]);
    await supplier("acme", "Acme Widgets");
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", dueDate: "2026-01-01", supplierId: "acme" });
    await invoiceAt({ processId: "ap", stage: "received", total: 50, currency: "GBP", dueDate: "2026-02-01", supplierId: "acme" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers).toEqual([{ supplierId: "acme", supplierName: "Acme Widgets", currency: "GBP", total: 150, count: 2 }]);
  });

  it("splits a supplier billed in two currencies into two figures, never one blended total", async () => {
    await process("ap", [{ id: "received", name: "Received", sequence: 1 }, { id: "eligible", name: "Eligible", sequence: 2 }]);
    await supplier("acme", "Acme Widgets");
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", dueDate: "2026-01-01", supplierId: "acme" });
    await invoiceAt({ processId: "ap", stage: "received", total: 200, currency: "EUR", dueDate: "2026-01-01", supplierId: "acme" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers.sort((a, b) => a.currency.localeCompare(b.currency))).toEqual([
      { supplierId: "acme", supplierName: "Acme Widgets", currency: "EUR", total: 200, count: 1 },
      { supplierId: "acme", supplierName: "Acme Widgets", currency: "GBP", total: 100, count: 1 },
    ]);
  });

  it("ranks the largest overdue balance first", async () => {
    await process("ap", [{ id: "received", name: "Received", sequence: 1 }, { id: "eligible", name: "Eligible", sequence: 2 }]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoiceAt({ processId: "ap", stage: "received", total: 100, currency: "GBP", dueDate: "2026-01-01", supplierId: "acme" });
    await invoiceAt({ processId: "ap", stage: "received", total: 500, currency: "GBP", dueDate: "2026-01-01", supplierId: "globex" });

    const body = (await handleOverdueBalance(env.DB, null, undefined, TODAY)).body as OverdueBalanceReport;
    expect(body.suppliers.map((s) => s.supplierName)).toEqual(["Globex Corp", "Acme Widgets"]);
  });
});
