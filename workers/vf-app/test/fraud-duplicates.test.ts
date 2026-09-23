import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handlePossibleDuplicates, type PossibleDuplicatesReport } from "../src/fraud-duplicates-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { POSSIBLE_DUPLICATE_THRESHOLD } from "../src/invoice-history.js";
import { handleUpsertInvoice } from "../src/invoice-facts-route.js";

/**
 * Potential duplicate invoices — decision 0420, the first vertical
 * slice of the Fraud Prevention tab.
 *
 * **This route reads a column, it does not score anything.** Every
 * fixture here inserts `duplicate_confidence` directly, the same
 * decision-0410 discipline `dashboard.test.ts`'s own "possible
 * duplicates reads the score that's actually stored" block already
 * follows — `computeDuplicateConfidence()` (`invoice-facts-route.ts`)
 * is covered by its own test file and is not re-tested here.
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

let seq = 0;

async function supplier(name: string, vatId: string | null = null): Promise<string> {
  const id = `sup-${seq++}`;
  await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, vat_id, status) VALUES (?, ?, ?, ?, 'active')")
    .bind(id, id, name, vatId)
    .run();
  return id;
}

async function invoice(opts: {
  confidence: number;
  invoiceNumber?: string | null;
  supplierId?: string | null;
  supplierVatId?: string | null;
  supplierNameFallback?: string | null;
  total?: number | null;
  currency?: string | null;
  issueDate?: string | null;
  unit?: string | null;
}) {
  const n = seq++;
  const id = `inv-${n}`;
  const facts = opts.supplierNameFallback ? { "BT-27": opts.supplierNameFallback } : {};
  await env.DB.prepare(
    `INSERT INTO invoice_headers
       (id, facts_json, invoice_number, supplier_id, supplier_vat_id, total_with_vat, currency, issue_date,
        duplicate_confidence, org_unit_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      id,
      JSON.stringify(facts),
      opts.invoiceNumber ?? null,
      opts.supplierId ?? null,
      opts.supplierVatId ?? null,
      opts.total ?? null,
      opts.currency ?? null,
      opts.issueDate ?? null,
      opts.confidence,
      opts.unit ?? null
    )
    .run();
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the route's own permission gate (decision 0420)", () => {
  it("GET /fraud/duplicates succeeds with AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.FraudReview"]);
    const res = await SELF.fetch("https://example.com/fraud/duplicates", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /fraud/duplicates 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/fraud/duplicates");
    expect(res.status).toBe(401);
  });

  it("GET /fraud/duplicates 403s authenticated but lacking AP.FraudReview", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch("https://example.com/fraud/duplicates", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });

  it("holding AP.Analysis alone is not enough — this is its own gate, not riding on it", async () => {
    const key = await seedUserWithPermissions(["AP.Analysis"]);
    const res = await SELF.fetch("https://example.com/fraud/duplicates", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("reads the stored score, not a new detection system (decision 0420)", () => {
  it("includes an invoice at or above the same POSSIBLE_DUPLICATE_THRESHOLD the Dashboard's own card already uses", async () => {
    await invoice({ confidence: POSSIBLE_DUPLICATE_THRESHOLD, total: 100, currency: "GBP" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices).toHaveLength(1);
  });

  it("excludes an invoice below the threshold", async () => {
    await invoice({ confidence: POSSIBLE_DUPLICATE_THRESHOLD - 0.01, total: 100, currency: "GBP" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices).toEqual([]);
  });

  /**
   * **The live report this decision fixed — decision 0463.** The same
   * invoice resubmitted with only its own invoice number incremented:
   * same supplier, same total, same date. `computeDuplicateConfidence()`
   * scores this `0.4` (`0.25` total + `0.15` date, no invoice-number
   * match) — proven directly against the real scoring function, not
   * assumed, and now above `POSSIBLE_DUPLICATE_THRESHOLD` where it
   * used to sit just below the old `0.5` bar.
   */
  it("a same-supplier, same-total, same-date invoice with only the invoice number changed now shows up", async () => {
    const supplierVatId = "GB-DUP-TEST";
    await handleUpsertInvoice(env.DB, {
      id: "dup-live-1",
      supplierVatId,
      invoiceNumber: "INV-1001",
      totalWithVat: 4250,
      currency: "GBP",
      issueDate: "2026-09-01",
      facts: {},
    });
    await handleUpsertInvoice(env.DB, {
      id: "dup-live-2",
      supplierVatId,
      invoiceNumber: "INV-1002", // incremented, everything else identical
      totalWithVat: 4250,
      currency: "GBP",
      issueDate: "2026-09-01",
      facts: {},
    });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices.map((i) => i.invoiceNumber)).toContain("INV-1002");
  });

  it("is empty, not an error, when nothing has been flagged", async () => {
    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices).toEqual([]);
  });

  it("sorts by confidence, most confident first — the design's own suggested visualization", async () => {
    await invoice({ confidence: 0.6, invoiceNumber: "LOW" });
    await invoice({ confidence: 0.95, invoiceNumber: "HIGH" });
    await invoice({ confidence: 0.75, invoiceNumber: "MID" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices.map((i) => i.invoiceNumber)).toEqual(["HIGH", "MID", "LOW"]);
  });

  it("carries the invoice's own amount, currency, issue date and confidence through unchanged", async () => {
    await invoice({ confidence: 0.8, invoiceNumber: "INV-1", total: 4400, currency: "EUR", issueDate: "2026-09-01" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices[0]).toMatchObject({
      invoiceNumber: "INV-1",
      totalWithVat: 4400,
      currency: "EUR",
      issueDate: "2026-09-01",
      duplicateConfidence: 0.8,
    });
  });
});

describe("supplier name, the same fallback dashboard-route.ts and documents-route.ts already use (decision 0420)", () => {
  it("shows the matched supplier's own name when there is one", async () => {
    const supplierId = await supplier("Acme Supplies");
    await invoice({ confidence: 0.7, supplierId, supplierNameFallback: "Different Printed Name" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices[0].supplierName).toBe("Acme Supplies");
  });

  it("falls back to the document's own printed name (BT-27) when there is no matched supplier", async () => {
    await invoice({ confidence: 0.7, supplierNameFallback: "Printed On The Invoice Ltd" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices[0].supplierName).toBe("Printed On The Invoice Ltd");
  });

  it("still returns the raw supplier VAT id alongside, whatever the name resolves to", async () => {
    await invoice({ confidence: 0.7, supplierVatId: "GB123456789" });

    const body = (await handlePossibleDuplicates(env.DB)).body as PossibleDuplicatesReport;
    expect(body.invoices[0].supplierVatId).toBe("GB123456789");
  });
});

describe("scoped the same way as every other analysis query (decision 0420)", () => {
  it("counts only invoices within the units AP.FraudReview is held in", async () => {
    await units();
    await invoice({ confidence: 0.7, unit: "acme-fr" });
    await invoice({ confidence: 0.7, unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], "acme-fr");

    const body = (await handlePossibleDuplicates(env.DB, null, "alice")).body as PossibleDuplicatesReport;
    expect(body.invoices).toHaveLength(1);
  });

  it("counts everywhere for somebody unrestricted", async () => {
    await units();
    await invoice({ confidence: 0.7, unit: "acme-fr" });
    await invoice({ confidence: 0.7, unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handlePossibleDuplicates(env.DB, null, "alice")).body as PossibleDuplicatesReport;
    expect(body.invoices).toHaveLength(2);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await invoice({ confidence: 0.7, unit: "acme-fr" });
    await invoice({ confidence: 0.7, unit: "acme-de" });
    await person("alice", ["AP.FraudReview"], null);

    const body = (await handlePossibleDuplicates(env.DB, "acme-fr", "alice")).body as PossibleDuplicatesReport;
    expect(body.invoices).toHaveLength(1);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await invoice({ confidence: 0.7, unit: "acme-fr" });
    await person("alice", ["AP.FraudReview"], "acme-de");

    const body = (await handlePossibleDuplicates(env.DB, "acme-fr", "alice")).body as PossibleDuplicatesReport;
    expect(body.invoices).toEqual([]);
  });
});
