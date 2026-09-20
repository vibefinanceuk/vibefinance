import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierExceptions, type SupplierExceptionsReport } from "../src/supplier-exceptions-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Exception rate by supplier, and exception type mix — decision 0421,
 * one of the six remaining vertical slices of the Supplier Performance
 * screen.
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

let seeded = false;
async function stage() {
  if (seeded) return;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
  seeded = true;
}

let seq = 0;

/** One stage visit, attributed through its invoice to a supplier. */
async function visit(opts: {
  supplierId: string;
  passed: boolean | null;
  failures?: string | null;
  daysAgo?: number;
}) {
  await stage();
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const piId = `pi-${n}`;
  const at = new Date(Date.now() - (opts.daysAgo ?? 1) * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, '{}', ?)")
    .bind(invoiceId, opts.supplierId)
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'validation', 'in_progress')"
  )
    .bind(piId, invoiceId)
    .run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, validation_passed, validation_failures, created_at) VALUES (?, ?, 'validation', 'evaluated', ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), piId, opts.passed === null ? null : opts.passed ? 1 : 0, opts.failures ?? null, at)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
  seeded = false;
});

describe("the supplier exceptions route's own permission gate (decision 0421)", () => {
  it("GET /suppliers/exceptions succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/exceptions", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /suppliers/exceptions 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/exceptions");
    expect(res.status).toBe(401);
  });

  it("GET /suppliers/exceptions 403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/suppliers/exceptions", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("an exception is validation_passed = 0, the same definition dashboard-route.ts already uses (decision 0421)", () => {
  it("counts a failed visit as an exception", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch" });

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.suppliers).toEqual([
      { supplierId: "s1", supplierName: "Northwind", exceptionCount: 1, visitCount: 1, exceptionRate: 1 },
    ]);
  });

  it("does not count a passed visit as an exception, but does count it toward the rate's denominator", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: true });
    await visit({ supplierId: "s1", passed: false, failures: "duplicate_suspected" });

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.suppliers).toEqual([
      { supplierId: "s1", supplierName: "Northwind", exceptionCount: 1, visitCount: 2, exceptionRate: 0.5 },
    ]);
  });

  it("excludes a visit where validation never ran (validation_passed IS NULL) from both sides of the fraction", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch" });
    await visit({ supplierId: "s1", passed: null }); // automatic stage, nothing evaluated

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.suppliers[0].visitCount).toBe(1);
  });

  it("excludes a visit older than 90 days", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch", daysAgo: 100 });

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.suppliers).toEqual([]);
  });

  it("does not rank a supplier with zero exceptions", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: true });

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.suppliers).toEqual([]);
  });

  it("is empty, not an error, when nothing has been evaluated yet", async () => {
    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body).toEqual({ suppliers: [], typeMix: [] });
  });

  it("ranks the highest exception rate first", async () => {
    await supplier("s1", "Mostly fine");
    await supplier("s2", "Frequently wrong");
    await visit({ supplierId: "s1", passed: true });
    await visit({ supplierId: "s1", passed: true });
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch" }); // 1/3
    await visit({ supplierId: "s2", passed: false, failures: "amount_mismatch" });
    await visit({ supplierId: "s2", passed: false, failures: "amount_mismatch" }); // 2/2

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s2", "s1"]);
  });
});

describe("exception type mix, read from validation_failures (decision 0421)", () => {
  it("splits comma-separated failures and counts each named check across the scoped window", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch,duplicate_suspected" });
    await visit({ supplierId: "s1", passed: false, failures: "amount_mismatch" });

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.typeMix).toEqual(
      expect.arrayContaining([
        { type: "amount_mismatch", count: 2 },
        { type: "duplicate_suspected", count: 1 },
      ])
    );
  });

  it("never counts a passing visit's own failures field toward the mix", async () => {
    await supplier("s1", "Northwind");
    await visit({ supplierId: "s1", passed: true, failures: "" });

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.typeMix).toEqual([]);
  });

  it("caps the mix at the six most common types", async () => {
    await supplier("s1", "Northwind");
    const types = ["a", "b", "c", "d", "e", "f", "g"];
    for (const type of types) {
      await visit({ supplierId: "s1", passed: false, failures: type });
    }

    const body = (await handleSupplierExceptions(env.DB)).body as SupplierExceptionsReport;
    expect(body.typeMix).toHaveLength(6);
  });
});

describe("scoped the same way the rest of this screen already is (decision 0421)", () => {
  it("counts only invoices within the units AP.Supplier is held in", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await visit({ supplierId: "s-fr", passed: false, failures: "amount_mismatch" });
    await visit({ supplierId: "s-de", passed: false, failures: "amount_mismatch" });
    await person("alice", ["AP.Supplier"], "acme-fr");

    const body = (await handleSupplierExceptions(env.DB, null, "alice")).body as SupplierExceptionsReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await visit({ supplierId: "s-fr", passed: false, failures: "amount_mismatch" });
    await visit({ supplierId: "s-de", passed: false, failures: "amount_mismatch" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierExceptions(env.DB, null, "alice")).body as SupplierExceptionsReport;
    expect(body.suppliers.map((s) => s.supplierId).sort()).toEqual(["s-de", "s-fr"]);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await visit({ supplierId: "s-fr", passed: false, failures: "amount_mismatch" });
    await visit({ supplierId: "s-de", passed: false, failures: "amount_mismatch" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierExceptions(env.DB, "acme-fr", "alice")).body as SupplierExceptionsReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await visit({ supplierId: "s-fr", passed: false, failures: "amount_mismatch" });
    await person("alice", ["AP.Supplier"], "acme-de");

    const body = (await handleSupplierExceptions(env.DB, "acme-fr", "alice")).body as SupplierExceptionsReport;
    expect(body.suppliers).toEqual([]);
  });
});
