import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleSupplierHoldHistory, type HoldHistoryReport } from "../src/supplier-hold-history-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * Hold history — decision 0427, the last of Supplier Performance's
 * eight key metrics, built on the general field-change history
 * (`supplier_field_changes`, migration 0072) rather than a
 * hold-specific table.
 *
 * **Rows seeded directly**, not through `handleSetSupplierState` —
 * that write path is already covered in `load-suppliers.test.ts`'s own
 * "the general field-change history" block; this file exercises the
 * route's own reading and pairing of whatever history exists,
 * including sequences a real write path would take real time to
 * produce.
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

/** A day offset from now, as the ISO datetime string this table stores. */
function at(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().replace("T", " ").slice(0, 19);
}

async function changeRow(supplierId: string, field: "on_hold" | "hold_reason", oldValue: string | null, newValue: string | null, changedAt: string) {
  await env.DB.prepare(
    "INSERT INTO supplier_field_changes (id, supplier_id, field, old_value, new_value, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, 'alice', ?)"
  )
    .bind(crypto.randomUUID(), supplierId, field, oldValue, newValue, changedAt)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("the route's own permission gate", () => {
  it("GET /suppliers/hold-history succeeds with AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Supplier"]);
    const res = await SELF.fetch("https://example.com/suppliers/hold-history", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(200);
  });

  it("401s with no credentials", async () => {
    const res = await SELF.fetch("https://example.com/suppliers/hold-history");
    expect(res.status).toBe(401);
  });

  it("403s authenticated but lacking AP.Supplier", async () => {
    const key = await seedUserWithPermissions(["AP.Review"]);
    const res = await SELF.fetch("https://example.com/suppliers/hold-history", {
      headers: { Authorization: `Bearer ${key}` },
    });
    expect(res.status).toBe(403);
  });
});

describe("pairing a discrete period out of two transitions", () => {
  it("pairs a hold-started and hold-ended row into one closed period, with its own reason", async () => {
    await supplier("s1", "Northwind");
    await changeRow("s1", "hold_reason", null, "Quality dispute", at(10));
    await changeRow("s1", "on_hold", "0", "1", at(10));
    await changeRow("s1", "on_hold", "1", "0", at(4));

    const body = (await handleSupplierHoldHistory(env.DB)).body as HoldHistoryReport;
    expect(body.periods).toHaveLength(1);
    expect(body.periods[0].supplierId).toBe("s1");
    expect(body.periods[0].endedAt).not.toBeNull();
    expect(body.periods[0].days).toBeCloseTo(6, 1);
    expect(body.periods[0].reason).toBe("Quality dispute");
  });
});

describe("an unresolved hold is reported as ongoing, not dropped", () => {
  it("shows a hold with no closing transition yet as ongoing, duration measured through now", async () => {
    await supplier("s1", "Northwind");
    await changeRow("s1", "hold_reason", null, "Awaiting new bank details", at(3));
    await changeRow("s1", "on_hold", "0", "1", at(3));

    const body = (await handleSupplierHoldHistory(env.DB)).body as HoldHistoryReport;
    expect(body.periods).toHaveLength(1);
    expect(body.periods[0].endedAt).toBeNull();
    expect(body.periods[0].days).toBeCloseTo(3, 1);
    expect(body.periods[0].reason).toBe("Awaiting new bank details");
  });
});

describe("a supplier held since its very first-ever load has no recorded period — forward-looking only", () => {
  it("reports nothing for a supplier with no on_hold transition at all, even if currently on hold", async () => {
    await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name, on_hold, hold_reason) VALUES ('s1', 's1', 'Northwind', 1, 'Held from day one')").run();

    const body = (await handleSupplierHoldHistory(env.DB)).body as HoldHistoryReport;
    expect(body.periods).toEqual([]);
  });
});

describe("more than one period for the same supplier", () => {
  it("lists each period separately, most recently started first", async () => {
    await supplier("s1", "Northwind");
    await changeRow("s1", "hold_reason", null, "First dispute", at(30));
    await changeRow("s1", "on_hold", "0", "1", at(30));
    await changeRow("s1", "on_hold", "1", "0", at(25));
    await changeRow("s1", "hold_reason", null, "Second dispute", at(10));
    await changeRow("s1", "on_hold", "0", "1", at(10));
    await changeRow("s1", "on_hold", "1", "0", at(8));

    const body = (await handleSupplierHoldHistory(env.DB)).body as HoldHistoryReport;
    expect(body.periods).toHaveLength(2);
    expect(body.periods[0].reason).toBe("Second dispute");
    expect(body.periods[1].reason).toBe("First dispute");
  });
});

describe("scoping — the same org-unit intersection the rest of this screen already uses", () => {
  it("shows only the supplier in the viewer's own org", async () => {
    await units();
    await person("viewer", ["AP.Supplier"], "acme-fr");
    await supplier("s1", "France Supplier", "acme-fr");
    await supplier("s2", "Germany Supplier", "acme-de");
    await changeRow("s1", "on_hold", "0", "1", at(5));
    await changeRow("s2", "on_hold", "0", "1", at(5));

    const body = (await handleSupplierHoldHistory(env.DB, null, "viewer")).body as HoldHistoryReport;
    expect(body.periods.map((p) => p.supplierId)).toEqual(["s1"]);
  });
});
