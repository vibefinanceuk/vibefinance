import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierPaymentTerms, type SupplierPaymentTermsReport } from "../src/supplier-payment-terms-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Payment terms held vs. negotiated, and on-time-payment rate by
 * supplier — decision 0421, one of the six remaining vertical slices
 * of the Supplier Performance screen.
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

async function supplier(id: string, name: string, paymentTerms: string | null, unit: string | null = null) {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, payment_terms, org_unit_id) VALUES (?, ?, ?, ?, ?)")
    .bind(id, id, name, paymentTerms, unit)
    .run();
}

let seq = 0;
let processSeeded = false;

async function seedProcess() {
  if (processSeeded) return;
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
  await env.DB.prepare(
    "INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('payment-eligible', 'ap', 'Payment-eligible', 1)"
  ).run();
  processSeeded = true;
}

/** An invoice for a supplier, with its own issue and due dates, optionally having reached payment-eligible at a given moment. */
async function invoice(opts: { supplierId: string; issueDate: string; dueDate: string | null; reachedAt?: string }) {
  await seedProcess();
  const n = seq++;
  const invoiceId = `inv-${n}`;
  const factsJson = opts.dueDate ? JSON.stringify({ "BT-9": opts.dueDate }) : "{}";
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, issue_date) VALUES (?, ?, ?, ?)")
    .bind(invoiceId, factsJson, opts.supplierId, opts.issueDate)
    .run();
  if (opts.reachedAt) {
    const piId = `pi-${n}`;
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'payment-eligible', 'in_progress')"
    )
      .bind(piId, invoiceId)
      .run();
    await env.DB.prepare(
      "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES (?, ?, 'payment-eligible', 'automatic', ?)"
    )
      .bind(crypto.randomUUID(), piId, opts.reachedAt)
      .run();
  }
  return invoiceId;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
  processSeeded = false;
});

describe("the supplier payment terms route's own permission gate (decision 0421)", () => {
  it("GET /suppliers/payment-terms succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/payment-terms", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /suppliers/payment-terms 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/payment-terms");
    expect(res.status).toBe(401);
  });

  it("GET /suppliers/payment-terms 403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/suppliers/payment-terms", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("negotiated terms, parsed narrowly (decision 0421)", () => {
  it("parses 'Net N' and compares it to what was actually held on the invoice", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31" });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers).toEqual([
      {
        supplierId: "s1",
        supplierName: "Northwind",
        negotiatedDays: 30,
        averageHeldDays: 30,
        onTimeRate: null,
        invoiceCount: 1,
      },
    ]);
  });

  it("excludes a supplier whose payment terms text does not parse as 'Net N'", async () => {
    await supplier("s1", "Northwind", "Due on receipt, 2% 10 days");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31" });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes a supplier with no payment terms recorded at all", async () => {
    await supplier("s1", "Northwind", null);
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31" });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers).toEqual([]);
  });

  it("excludes an invoice with no due date, even for a supplier whose terms parse", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: null });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers).toEqual([]);
  });

  it("averages held days across a supplier's several invoices", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31" }); // 30
    await invoice({ supplierId: "s1", issueDate: "2026-02-01", dueDate: "2026-03-03" }); // 30
    await invoice({ supplierId: "s1", issueDate: "2026-03-01", dueDate: "2026-04-10" }); // 40

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers[0].averageHeldDays).toBeCloseTo(33.33, 1);
  });
});

describe("on-time means reaching payment-eligible on or before the due date (decision 0421)", () => {
  it("counts an invoice that reached payment-eligible on its own due date as on time", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31", reachedAt: "2026-01-31 09:00:00" });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers[0].onTimeRate).toBe(1);
  });

  it("counts an invoice that reached payment-eligible after its own due date as late", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31", reachedAt: "2026-02-05 09:00:00" });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers[0].onTimeRate).toBe(0);
  });

  it("is null, not zero, when nothing has reached payment-eligible yet — not judged late for still being in flight", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31" });

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers[0].onTimeRate).toBeNull();
    expect(body.suppliers[0].invoiceCount).toBe(1); // held-days average still counts it
  });

  it("computes the rate only over invoices that have actually reached payment-eligible", async () => {
    await supplier("s1", "Northwind", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31", reachedAt: "2026-01-20 00:00:00" }); // on time
    await invoice({ supplierId: "s1", issueDate: "2026-02-01", dueDate: "2026-03-03", reachedAt: "2026-03-10 00:00:00" }); // late
    await invoice({ supplierId: "s1", issueDate: "2026-03-01", dueDate: "2026-04-10" }); // still in flight

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers[0].onTimeRate).toBe(0.5);
  });
});

describe("ranked furthest from the negotiated term first (decision 0421)", () => {
  it("ranks the supplier with the biggest gap between held and negotiated days first", async () => {
    await supplier("s1", "Close to terms", "Net 30");
    await supplier("s2", "Way off terms", "Net 30");
    await invoice({ supplierId: "s1", issueDate: "2026-01-01", dueDate: "2026-01-31" }); // held 30, gap 0
    await invoice({ supplierId: "s2", issueDate: "2026-01-01", dueDate: "2026-03-01" }); // held 59, gap 29

    const body = (await handleSupplierPaymentTerms(env.DB)).body as SupplierPaymentTermsReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s2", "s1"]);
  });
});

describe("scoped the same way the rest of this screen already is (decision 0421)", () => {
  it("counts only invoices within the units AP.Supplier is held in", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "Net 30", "acme-fr");
    await supplier("s-de", "Northwind DE", "Net 30", "acme-de");
    await invoice({ supplierId: "s-fr", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await invoice({ supplierId: "s-de", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await person("alice", ["AP.Supplier"], "acme-fr");

    const body = (await handleSupplierPaymentTerms(env.DB, null, "alice")).body as SupplierPaymentTermsReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "Net 30", "acme-fr");
    await supplier("s-de", "Northwind DE", "Net 30", "acme-de");
    await invoice({ supplierId: "s-fr", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await invoice({ supplierId: "s-de", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierPaymentTerms(env.DB, null, "alice")).body as SupplierPaymentTermsReport;
    expect(body.suppliers.map((s) => s.supplierId).sort()).toEqual(["s-de", "s-fr"]);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "Net 30", "acme-fr");
    await supplier("s-de", "Northwind DE", "Net 30", "acme-de");
    await invoice({ supplierId: "s-fr", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await invoice({ supplierId: "s-de", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierPaymentTerms(env.DB, "acme-fr", "alice")).body as SupplierPaymentTermsReport;
    expect(body.suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "Net 30", "acme-fr");
    await invoice({ supplierId: "s-fr", issueDate: "2026-01-01", dueDate: "2026-01-31" });
    await person("alice", ["AP.Supplier"], "acme-de");

    const body = (await handleSupplierPaymentTerms(env.DB, "acme-fr", "alice")).body as SupplierPaymentTermsReport;
    expect(body.suppliers).toEqual([]);
  });
});
