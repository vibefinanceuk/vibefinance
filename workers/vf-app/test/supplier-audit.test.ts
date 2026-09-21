import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { diffSupplierFields, recordSupplierFieldChanges } from "../src/supplier-audit.js";

/**
 * The general field-change diff and write helper — decision 0427.
 * `load-suppliers.test.ts`'s own "the general field-change history"
 * block covers this through the three real write paths; this file
 * covers the pure diffing logic directly.
 */

describe("diffSupplierFields", () => {
  it("reports nothing when nothing differs", () => {
    expect(diffSupplierFields({ name: "Acme" }, { name: "Acme" })).toEqual([]);
  });

  it("reports a change when a value differs", () => {
    expect(diffSupplierFields({ name: "Acme" }, { name: "Acme Ltd" })).toEqual([
      { field: "name", oldValue: "Acme", newValue: "Acme Ltd" },
    ]);
  });

  it("only compares fields present in `after` — a write path that never touches a field never manufactures a change for it", () => {
    expect(diffSupplierFields({ name: "Acme", vat_id: "GB1" }, { name: "Acme" })).toEqual([]);
  });

  it("treats null/undefined/empty-string as the same absent value", () => {
    expect(diffSupplierFields({ vat_id: null }, { vat_id: "" })).toEqual([]);
    expect(diffSupplierFields({ vat_id: undefined }, { vat_id: null })).toEqual([]);
  });

  it("reports gaining a value from nothing, and losing a value to nothing, as real changes", () => {
    expect(diffSupplierFields({ hold_reason: null }, { hold_reason: "Quality dispute" })).toEqual([
      { field: "hold_reason", oldValue: null, newValue: "Quality dispute" },
    ]);
    expect(diffSupplierFields({ hold_reason: "Quality dispute" }, { hold_reason: null })).toEqual([
      { field: "hold_reason", oldValue: "Quality dispute", newValue: null },
    ]);
  });

  it("normalizes booleans to '1'/'0', matching how a boolean column reads back from D1", () => {
    expect(diffSupplierFields({ on_hold: 0 }, { on_hold: true })).toEqual([
      { field: "on_hold", oldValue: "0", newValue: "1" },
    ]);
  });

  it("does not treat a real zero as absent — a discount_pct of 0 is a fact, not a gap", () => {
    expect(diffSupplierFields({ discount_pct: null }, { discount_pct: 0 })).toEqual([
      { field: "discount_pct", oldValue: null, newValue: "0" },
    ]);
  });

  it("reports more than one changed field in one call, each its own row", () => {
    const changes = diffSupplierFields(
      { name: "Acme", country: "GB" },
      { name: "Acme Ltd", country: "GB" }
    );
    expect(changes).toEqual([{ field: "name", oldValue: "Acme", newValue: "Acme Ltd" }]);
  });
});

describe("recordSupplierFieldChanges", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO suppliers (id, erp_identifier, name) VALUES ('s1', 's1', 'Acme')").run();
  });

  it("writes nothing for an empty change list", async () => {
    await recordSupplierFieldChanges(env.DB, "s1", [], "alice");
    const count = await env.DB.prepare("SELECT count(*) AS n FROM supplier_field_changes").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("writes one row per changed field, carrying the given changedBy", async () => {
    await recordSupplierFieldChanges(
      env.DB,
      "s1",
      [
        { field: "name", oldValue: "Acme", newValue: "Acme Ltd" },
        { field: "country", oldValue: null, newValue: "GB" },
      ],
      "alice"
    );

    const rows = await env.DB
      .prepare("SELECT field, old_value, new_value, changed_by FROM supplier_field_changes WHERE supplier_id = 's1' ORDER BY field")
      .all<{ field: string; old_value: string | null; new_value: string | null; changed_by: string }>();
    expect(rows.results).toEqual([
      { field: "country", old_value: null, new_value: "GB", changed_by: "alice" },
      { field: "name", old_value: "Acme", new_value: "Acme Ltd", changed_by: "alice" },
    ]);
  });
});
