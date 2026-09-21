import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInvoiceLookup, type InvoiceLookupReport } from "../src/invoice-lookup-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Looking up one invoice by its own printed number — decision 0430's
 * own addendum, built for the AP Assistant's `invoice_lookup` tool.
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

async function person(id: string, permissions: string[]): Promise<void> {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(id, `${id}@acme.com`, id).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${id}`, id, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, NULL)").bind(id, `r-${id}`).run();
}

async function supplier(id: string, name: string) {
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name) VALUES (?, ?, ?)").bind(id, id, name).run();
}

async function invoice(opts: { id: string; number: string; supplierId: string; total: number; currency: string }) {
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, invoice_number, facts_json, total_with_vat, currency, supplier_id) VALUES (?, ?, '{}', ?, ?, ?)"
  )
    .bind(opts.id, opts.number, opts.total, opts.currency, opts.supplierId)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("the route's own permission gate", () => {
  it("GET /invoices/lookup succeeds with AP.Validate", async () => {
    const key = await seedUserWithPermissions(["AP.Validate"]);
    const res = await SELF.fetch("https://example.com/invoices/lookup?number=INV-1", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/invoices/lookup?number=INV-1");
    expect(res.status).toBe(401);
  });

  it("403s with a different permission", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/invoices/lookup?number=INV-1", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });

  it("400s with no ?number= at all", async () => {
    const key = await seedUserWithPermissions(["AP.Validate"]);
    const res = await SELF.fetch("https://example.com/invoices/lookup", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(400);
  });
});

describe("what comes back", () => {
  it("is empty when nothing matches", async () => {
    await person("alice", ["AP.Validate"]);
    const result = await handleInvoiceLookup(env.DB, null, "alice", "NO-SUCH-NUMBER");
    const body = result.body as InvoiceLookupReport;
    expect(body.matches).toEqual([]);
  });

  it("finds a real invoice by its own number, case-insensitively", async () => {
    await person("alice", ["AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });

    const result = await handleInvoiceLookup(env.DB, null, "alice", "inv-1001");
    const body = result.body as InvoiceLookupReport;
    expect(body.matches).toHaveLength(1);
    expect(body.matches[0]).toMatchObject({
      invoiceNumber: "INV-1001",
      supplierName: "Acme Widgets",
      totalWithVat: 250,
      currency: "GBP",
      hasDocument: false,
    });
  });

  it("reports the real workflow stage when the invoice is in progress", async () => {
    await person("alice", ["AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'ap')").run();
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('validation', 'ap', 'Validation', 1)").run();
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-1', 'ap', 'invoice', 'inv-1', 'validation', 'in_progress')"
    ).run();

    const result = await handleInvoiceLookup(env.DB, null, "alice", "INV-1001");
    const body = result.body as InvoiceLookupReport;
    expect(body.matches[0].stage).toBe("Validation");
    expect(body.matches[0].inProgress).toBe(true);
  });

  it("returns every match when the same number was reused by different suppliers, rather than guessing", async () => {
    await person("alice", ["AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await invoice({ id: "inv-2", number: "INV-1001", supplierId: "globex", total: 900, currency: "GBP" });

    const result = await handleInvoiceLookup(env.DB, null, "alice", "INV-1001");
    const body = result.body as InvoiceLookupReport;
    expect(body.matches).toHaveLength(2);
    expect(body.matches.map((m) => m.supplierName).sort()).toEqual(["Acme Widgets", "Globex Corp"]);
  });

  it("says a document is retained when one is, without minting a URL itself", async () => {
    await person("alice", ["AP.Validate"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "inv-1", number: "INV-1001", supplierId: "acme", total: 250, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES ('d-1', 'inv-1', 'k-1', 'original', 'application/pdf')"
    ).run();

    const result = await handleInvoiceLookup(env.DB, null, "alice", "INV-1001");
    const body = result.body as InvoiceLookupReport;
    expect(body.matches[0].hasDocument).toBe(true);
  });
});
