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

/** Used by both the total-amount and the stageIds describe blocks below. */
async function invoiceWithAmount(opts: { id: string; supplierId: string; total: number | null; currency: string | null; createdAt?: string }) {
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, supplier_id, total_with_vat, currency, created_at) VALUES (?, '{}', ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))"
  )
    .bind(opts.id, opts.supplierId, opts.total, opts.currency, opts.createdAt ?? null)
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

describe("the exact total amount by currency — decision 0430's fourth addendum", () => {
  /**
   * A real gap a live test surfaced directly: "total invoice amount for
   * this quarter" was refused outright because nothing anywhere summed
   * invoice amounts over a period. Built alongside the existing count,
   * same filters, same discipline — never summed across currencies.
   */

  it("is empty when nothing exists", async () => {
    await person("alice", ["AP.Review"]);
    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    expect((result.body as InvoiceCountReport).totalByCurrency).toEqual([]);
  });

  it("sums a single currency's real invoices exactly", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "a", supplierId: "acme", total: 100, currency: "GBP" });
    await invoiceWithAmount({ id: "b", supplierId: "acme", total: 250.5, currency: "GBP" });

    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    expect((result.body as InvoiceCountReport).totalByCurrency).toEqual([{ currency: "GBP", total: 350.5 }]);
  });

  it("never blends two currencies into one figure", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "gbp-1", supplierId: "acme", total: 100, currency: "GBP" });
    await invoiceWithAmount({ id: "usd-1", supplierId: "acme", total: 200, currency: "USD" });
    await invoiceWithAmount({ id: "usd-2", supplierId: "acme", total: 50, currency: "USD" });

    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    const byCurrency = (result.body as InvoiceCountReport).totalByCurrency;
    expect(byCurrency).toHaveLength(2);
    expect(byCurrency).toContainEqual({ currency: "GBP", total: 100 });
    expect(byCurrency).toContainEqual({ currency: "USD", total: 250 });
  });

  it("excludes a row missing an amount or a currency from the total, but it still counts", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "known", supplierId: "acme", total: 100, currency: "GBP" });
    await invoiceWithAmount({ id: "no-amount", supplierId: "acme", total: null, currency: "GBP" });
    await invoiceWithAmount({ id: "no-currency", supplierId: "acme", total: 500, currency: null });

    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    const body = result.body as InvoiceCountReport;
    expect(body.count).toBe(3);
    expect(body.totalByCurrency).toEqual([{ currency: "GBP", total: 100 }]);
  });

  it("respects the same 'since' and 'supplier' filters as the count", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await supplier("globex", "Globex Corp");
    await invoiceWithAmount({ id: "acme-old", supplierId: "acme", total: 100, currency: "GBP", createdAt: "2020-01-01T00:00:00Z" });
    await invoiceWithAmount({ id: "acme-new", supplierId: "acme", total: 200, currency: "GBP", createdAt: "2020-06-01T00:00:00Z" });
    await invoiceWithAmount({ id: "globex-new", supplierId: "globex", total: 900, currency: "GBP", createdAt: "2020-06-01T00:00:00Z" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { since: "2020-03-01", supplier: "acme" });
    expect((result.body as InvoiceCountReport).totalByCurrency).toEqual([{ currency: "GBP", total: 200 }]);
  });
});

describe("the 'stageIds' filter — decision 0430's fifth addendum", () => {
  /**
   * Matched with `EXISTS`, never a `JOIN` — this file's own top-of-file
   * doc comment explains why: a `JOIN` against `process_instances`
   * would silently inflate the count or the total for any invoice that
   * ever picked up more than one instance, which nothing in this
   * schema actually forbids.
   */
  async function process(id: string, stages: { id: string; name: string; sequence: number }[]) {
    await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES (?, ?)").bind(id, id).run();
    for (const stage of stages) {
      await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES (?, ?, ?, ?)")
        .bind(stage.id, id, stage.name, stage.sequence)
        .run();
    }
  }

  async function placeAtStage(opts: { invoiceId: string; processId: string; stageId: string; status?: string }) {
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, ?, 'invoice', ?, ?, ?)"
    )
      .bind(`pi-${opts.invoiceId}`, opts.processId, opts.invoiceId, opts.stageId, opts.status ?? "in_progress")
      .run();
  }

  it("counts and totals only invoices currently held at one of the given stage ids", async () => {
    await person("alice", ["AP.Review"]);
    await process("ap", [
      { id: "matching", name: "Matching", sequence: 1 },
      { id: "validation", name: "Validation", sequence: 2 },
      { id: "payment", name: "Payment-eligible", sequence: 3 },
    ]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "at-matching", supplierId: "acme", total: 100, currency: "GBP" });
    await invoiceWithAmount({ id: "at-validation", supplierId: "acme", total: 200, currency: "GBP" });
    await invoiceWithAmount({ id: "at-payment", supplierId: "acme", total: 900, currency: "GBP" });
    await placeAtStage({ invoiceId: "at-matching", processId: "ap", stageId: "matching" });
    await placeAtStage({ invoiceId: "at-validation", processId: "ap", stageId: "validation" });
    await placeAtStage({ invoiceId: "at-payment", processId: "ap", stageId: "payment" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { stageIds: ["matching", "validation"] });
    const body = result.body as InvoiceCountReport;
    expect(body.count).toBe(2);
    expect(body.totalByCurrency).toEqual([{ currency: "GBP", total: 300 }]);
  });

  it("excludes an invoice whose instance has completed, even if it ended at that stage", async () => {
    await person("alice", ["AP.Review"]);
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "done", supplierId: "acme", total: 100, currency: "GBP" });
    await placeAtStage({ invoiceId: "done", processId: "ap", stageId: "validation", status: "completed" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { stageIds: ["validation"] });
    expect((result.body as InvoiceCountReport).count).toBe(0);
  });

  it("never inflates the count for an invoice that somehow has more than one process instance", async () => {
    // Nothing in this schema forbids it, even though it isn't meant to
    // happen — this is the whole reason EXISTS is used instead of a JOIN.
    await person("alice", ["AP.Review"]);
    await process("ap", [{ id: "validation", name: "Validation", sequence: 1 }]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "double", supplierId: "acme", total: 100, currency: "GBP" });
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-double-a', 'ap', 'invoice', 'double', 'validation', 'in_progress')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-double-b', 'ap', 'invoice', 'double', 'validation', 'in_progress')"
    ).run();

    const result = await handleInvoiceCount(env.DB, null, "alice", { stageIds: ["validation"] });
    const body = result.body as InvoiceCountReport;
    expect(body.count).toBe(1);
    expect(body.totalByCurrency).toEqual([{ currency: "GBP", total: 100 }]);
  });

  it("leaves the count and total unaffected when no stage is asked for", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "a", supplierId: "acme", total: 100, currency: "GBP" });

    const result = await handleInvoiceCount(env.DB, null, "alice", {});
    const body = result.body as InvoiceCountReport;
    expect(body.count).toBe(1);
    expect(body.totalByCurrency).toEqual([{ currency: "GBP", total: 100 }]);
  });

  it("treats an empty stageIds array as no filter at all, not as 'match nothing'", async () => {
    await person("alice", ["AP.Review"]);
    await supplier("acme", "Acme Widgets");
    await invoiceWithAmount({ id: "a", supplierId: "acme", total: 100, currency: "GBP" });

    const result = await handleInvoiceCount(env.DB, null, "alice", { stageIds: [] });
    expect((result.body as InvoiceCountReport).count).toBe(1);
  });
});
