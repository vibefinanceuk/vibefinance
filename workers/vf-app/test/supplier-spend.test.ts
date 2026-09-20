import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierSpend } from "../src/supplier-performance-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Spend by supplier, ranked — decision 0416, the first vertical slice
 * of the Supplier Performance screen.
 *
 * **Two kinds of test here**, the same split `workload.test.ts`
 * already uses: the permission gate proven through a real
 * `SELF.fetch`, everything about what the data actually says —
 * grouping, currency-splitting, ranking, scoping, exclusions — calling
 * `handleSupplierSpend` directly against the test DB.
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

async function supplier(id: string, name: string, unit: string | null = null) {
  await env.DB.prepare(
    "INSERT INTO suppliers (id, erp_identifier, name, org_unit_id) VALUES (?, ?, ?, ?)"
  )
    .bind(id, id, name, unit)
    .run();
}

let seq = 0;

/** An invoice attributed to a supplier, with a real price and currency. */
async function invoice(supplierId: string, opts: { total: number; currency: string | null }) {
  const n = seq++;
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, supplier_id, total_with_vat, currency) VALUES (?, '{}', ?, ?, ?)"
  )
    .bind(`inv-${n}`, supplierId, opts.total, opts.currency)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seedActiveLicence();
  seq = 0;
});

describe("the supplier spend route's own permission gate (decision 0416)", () => {
  it("GET /suppliers/spend succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/spend", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("GET /suppliers/spend 401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/spend");
    expect(res.status).toBe(401);
  });

  it("GET /suppliers/spend 403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]); // wrong permission on purpose
    const res = await SELF.fetch("https://example.com/suppliers/spend", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("never summed across currencies (decision 0416)", () => {
  it("gives a single-currency supplier one figure", async () => {
    await supplier("s1", "Northwind");
    await invoice("s1", { total: 100, currency: "GBP" });
    await invoice("s1", { total: 50, currency: "GBP" });

    const body = (await handleSupplierSpend(env.DB)).body as {
      currencies: { currency: string; suppliers: { supplierId: string; spend: number; invoiceCount: number }[] }[];
    };

    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0].currency).toBe("GBP");
    expect(body.currencies[0].suppliers).toEqual([
      { supplierId: "s1", supplierName: "Northwind", spend: 150, invoiceCount: 2 },
    ]);
  });

  it("splits a multi-currency supplier into one figure per currency, never one summed total", async () => {
    await supplier("s1", "Northwind");
    await invoice("s1", { total: 12400, currency: "GBP" });
    await invoice("s1", { total: 3200, currency: "EUR" });

    const body = (await handleSupplierSpend(env.DB)).body as {
      currencies: { currency: string; suppliers: { supplierId: string; spend: number }[] }[];
    };

    const gbp = body.currencies.find((c) => c.currency === "GBP");
    const eur = body.currencies.find((c) => c.currency === "EUR");
    expect(gbp?.suppliers.find((s) => s.supplierId === "s1")?.spend).toBe(12400);
    expect(eur?.suppliers.find((s) => s.supplierId === "s1")?.spend).toBe(3200);
    // Never one combined figure anywhere in the response.
    const allSpends = body.currencies.flatMap((c) => c.suppliers.map((s) => s.spend));
    expect(allSpends).not.toContain(15600);
  });

  it("orders currencies by their own total spend, most significant first", async () => {
    await supplier("s1", "Northwind");
    await supplier("s2", "Southwind");
    await invoice("s1", { total: 100, currency: "EUR" });
    await invoice("s2", { total: 900, currency: "USD" });
    await invoice("s1", { total: 50, currency: "GBP" });

    const body = (await handleSupplierSpend(env.DB)).body as { currencies: { currency: string }[] };
    expect(body.currencies.map((c) => c.currency)).toEqual(["USD", "EUR", "GBP"]);
  });

  it("excludes an invoice missing a total or a currency, rather than counting it as zero", async () => {
    await supplier("s1", "Northwind");
    await invoice("s1", { total: 100, currency: "GBP" });
    await invoice("s1", { total: 0, currency: null as unknown as string });

    const body = (await handleSupplierSpend(env.DB)).body as {
      currencies: { currency: string; suppliers: { invoiceCount: number; spend: number }[] }[];
    };
    expect(body.currencies).toHaveLength(1);
    expect(body.currencies[0].suppliers[0]).toEqual(
      expect.objectContaining({ invoiceCount: 1, spend: 100 })
    );
  });

  it("is empty, not an error, when nothing has been invoiced yet", async () => {
    await supplier("s1", "Northwind");
    const body = (await handleSupplierSpend(env.DB)).body as { currencies: unknown[] };
    expect(body.currencies).toEqual([]);
  });
});

describe("scoped exactly the way the Suppliers screen already is (decision 0416)", () => {
  it("counts spend only for suppliers within the units AP.Supplier is held in", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await invoice("s-fr", { total: 100, currency: "GBP" });
    await invoice("s-de", { total: 100, currency: "GBP" });
    await person("alice", ["AP.Supplier"], "acme-fr");

    const body = (await handleSupplierSpend(env.DB, null, "alice")).body as {
      currencies: { suppliers: { supplierId: string }[] }[];
    };
    expect(body.currencies[0].suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts every supplier for somebody unrestricted", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await invoice("s-fr", { total: 100, currency: "GBP" });
    await invoice("s-de", { total: 200, currency: "GBP" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierSpend(env.DB, null, "alice")).body as {
      currencies: { suppliers: { supplierId: string }[] }[];
    };
    expect(body.currencies[0].suppliers.map((s) => s.supplierId).sort()).toEqual(["s-de", "s-fr"]);
  });

  it("narrows to the chosen org", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await supplier("s-de", "Northwind DE", "acme-de");
    await invoice("s-fr", { total: 100, currency: "GBP" });
    await invoice("s-de", { total: 200, currency: "GBP" });
    await person("alice", ["AP.Supplier"], null);

    const body = (await handleSupplierSpend(env.DB, "acme-fr", "alice")).body as {
      currencies: { suppliers: { supplierId: string }[] }[];
    };
    expect(body.currencies[0].suppliers.map((s) => s.supplierId)).toEqual(["s-fr"]);
  });

  it("counts nothing when the permission is not held in the chosen org at all", async () => {
    await units();
    await supplier("s-fr", "Northwind FR", "acme-fr");
    await invoice("s-fr", { total: 100, currency: "GBP" });
    await person("alice", ["AP.Supplier"], "acme-de");

    const body = (await handleSupplierSpend(env.DB, "acme-fr", "alice")).body as { currencies: unknown[] };
    expect(body.currencies).toEqual([]);
  });
});

describe("ranked within each currency, capped at a limit (decision 0416)", () => {
  it("orders suppliers by spend, most first, within their own currency", async () => {
    await supplier("s1", "Northwind");
    await supplier("s2", "Southwind");
    await supplier("s3", "Eastwind");
    await invoice("s1", { total: 100, currency: "GBP" });
    await invoice("s2", { total: 900, currency: "GBP" });
    await invoice("s3", { total: 500, currency: "GBP" });

    const body = (await handleSupplierSpend(env.DB)).body as {
      currencies: { suppliers: { supplierId: string }[] }[];
    };
    expect(body.currencies[0].suppliers.map((s) => s.supplierId)).toEqual(["s2", "s3", "s1"]);
  });

  it("caps each currency's own list at the given limit", async () => {
    for (const id of ["a", "b", "c"]) {
      await supplier(id, id);
      await invoice(id, { total: 100, currency: "GBP" });
    }

    const body = (await handleSupplierSpend(env.DB, null, undefined, 2)).body as {
      currencies: { suppliers: unknown[] }[];
    };
    expect(body.currencies[0].suppliers).toHaveLength(2);
  });
});
