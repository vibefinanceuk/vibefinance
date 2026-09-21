import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInvoiceCount, type InvoiceCountReport } from "../src/invoice-count-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * An exact, unbounded count of invoices — decision 0430's third
 * addendum, built for the AP Assistant's own `invoice_search` tool
 * answering "how many," since that tool's own list is capped at 50.
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

async function invoice(opts: { id: string; supplierId: string; createdAt?: string }) {
  if (opts.createdAt) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, created_at) VALUES (?, '{}', ?, ?)")
      .bind(opts.id, opts.supplierId, opts.createdAt)
      .run();
    return;
  }
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, '{}', ?)")
    .bind(opts.id, opts.supplierId)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("the route's own permission gate", () => {
  it("GET /invoices/count succeeds with AP.Review", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/invoices/count", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/invoices/count");
    expect(res.status).toBe(401);
  });

  it("403s with a different permission", async () => {
    const key = await seedUserWithPermissions(["AP.Validate"]);
    const res = await SELF.fetch("https://example.com/invoices/count", { headers: { Authorization: `Bearer ${key}` } });
    expect(res.status).toBe(403);
  });
});

describe("what it counts", () => {
  it("is zero when nothing exists", async () => {
    await person("alice", ["AP.Review"]);
    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    expect((result.body as InvoiceCountReport).count).toBe(0);
  });

  it("counts every real invoice with no filters", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "a", supplierId: "acme" });
    await invoice({ id: "b", supplierId: "acme" });
    await invoice({ id: "c", supplierId: "acme" });

    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    expect((result.body as InvoiceCountReport).count).toBe(3);
  });

  it("is exact past 50 — the whole reason this exists rather than reusing invoice_search's own capped list", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    for (let i = 0; i < 62; i++) {
      await invoice({ id: `inv-${i}`, supplierId: "acme" });
    }

    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    expect((result.body as InvoiceCountReport).count).toBe(62);
  });

  it("excludes an invoice received before a given 'since' date", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoice({ id: "old", supplierId: "acme", createdAt: "2020-01-01T00:00:00Z" });
    await invoice({ id: "new", supplierId: "acme", createdAt: "2020-06-01T00:00:00Z" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { since: "2020-03-01" });
    expect((result.body as InvoiceCountReport).count).toBe(1);
  });

  it("narrows to one supplier when asked, case-insensitively", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "a1", supplierId: "acme" });
    await invoice({ id: "a2", supplierId: "acme" });
    await invoice({ id: "g1", supplierId: "globex" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { supplier: "acme" });
    expect((result.body as InvoiceCountReport).count).toBe(2);
  });

  it("combines 'since' and 'supplier' as a real AND, not either", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoice({ id: "acme-old", supplierId: "acme", createdAt: "2020-01-01T00:00:00Z" });
    await invoice({ id: "acme-new", supplierId: "acme", createdAt: "2020-06-01T00:00:00Z" });
    await invoice({ id: "globex-new", supplierId: "globex", createdAt: "2020-06-01T00:00:00Z" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { since: "2020-03-01", supplier: "acme" });
    expect((result.body as InvoiceCountReport).count).toBe(1);
  });
});
