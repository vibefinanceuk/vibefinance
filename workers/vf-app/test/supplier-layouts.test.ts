import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { learnLayouts, supplierLayouts, invoiceLayouts, forgetLayouts, type Evidence } from "../src/supplier-layouts.js";
import { handleRecordRegion } from "../src/field-regions.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { PERMISSIONS } from "../src/permissions.js";

/**
 * **Learning each supplier's invoice layout — decision 0702.** Step 2 of
 * docs/design/supplier-layout-learning.md.
 */

const TOTAL = { x: 0.82, y: 0.85, w: 0.08, h: 0.015 };
const NUMBER = { x: 0.7, y: 0.1, w: 0.12, h: 0.015 };

let seq = 0;
function ev(invoiceId: string, field: string, box: Evidence["box"], label: string | null, source: Evidence["source"] = "found", pageNumber = 1): Evidence {
  seq++;
  return { invoiceId, field, pageNumber, box, label, source, recordedAt: `2026-10-09 10:00:${String(seq).padStart(2, "0")}` };
}
const nudge = (b: Evidence["box"], d: number) => ({ ...b, x: b.x + d, y: b.y + d });

describe("learnLayouts", () => {
  it("learns where a field is once three invoices agree", () => {
    const evidence = [
      ev("i1", "BT-112", TOTAL, "gesamtbetrag"),
      ev("i2", "BT-112", nudge(TOTAL, 0.004), "gesamtbetrag"),
      ev("i3", "BT-112", nudge(TOTAL, -0.003), "gesamtbetrag"),
    ];
    const [layout] = learnLayouts(evidence);
    expect(layout.invoices).toBe(3);
    expect(layout.fields).toEqual([expect.objectContaining({ field: "BT-112", pageNumber: 1, label: "gesamtbetrag", evidence: 3, disagreements: 0 })]);
    expect(layout.fields[0].box.x).toBeCloseTo(0.82, 2);
  });

  it("does not learn from two found invoices", () => {
    expect(learnLayouts([ev("i1", "BT-112", TOTAL, "gesamtbetrag"), ev("i2", "BT-112", TOTAL, "gesamtbetrag")])).toEqual([]);
  });

  it("learns from one correction alone", () => {
    const [layout] = learnLayouts([ev("i1", "BT-1", NUMBER, "rechnungsnr", "lassoed_corrected")]);
    expect(layout.fields[0]).toMatchObject({ field: "BT-1", evidence: 5 });
  });

  it("keeps a supplier's two templates apart", () => {
    const moved = { x: 0.1, y: 0.4, w: 0.08, h: 0.015 };
    const evidence = [
      ...["a1", "a2", "a3"].flatMap((i) => [ev(i, "BT-112", TOTAL, "gesamtbetrag"), ev(i, "BT-1", NUMBER, "rechnungsnr")]),
      ...["b1", "b2", "b3", "b4"].flatMap((i) => [ev(i, "BT-112", moved, "summe"), ev(i, "BT-1", { ...NUMBER, y: 0.2 }, "belegnr")]),
    ];
    const layouts = learnLayouts(evidence);
    expect(layouts).toHaveLength(2);
    // The most used first.
    expect(layouts[0]).toMatchObject({ id: "L1", invoices: 4 });
    expect(layouts[0].fields.find((f) => f.field === "BT-112")!.label).toBe("summe");
    expect(layouts[1].fields.find((f) => f.field === "BT-112")!.label).toBe("gesamtbetrag");
  });

  it("leaves out a field the evidence disagrees on", () => {
    const evidence = [
      ev("i1", "BT-1", NUMBER, "rechnungsnr"),
      ev("i1", "BT-112", TOTAL, "gesamtbetrag"),
      ev("i2", "BT-1", NUMBER, "rechnungsnr"),
      ev("i2", "BT-112", { ...TOTAL, y: 0.3 }, "gesamtbetrag"),
      ev("i3", "BT-1", NUMBER, "rechnungsnr"),
      ev("i3", "BT-112", { ...TOTAL, y: 0.5 }, "gesamtbetrag"),
    ];
    const [layout] = learnLayouts(evidence);
    expect(layout.fields.map((f) => f.field)).toEqual(["BT-1"]);
  });

  it("does not take two places with different labels for one", () => {
    const evidence = [
      ev("i1", "BT-112", TOTAL, "gesamtbetrag"),
      ev("i2", "BT-112", TOTAL, "zwischensumme"),
      ev("i3", "BT-112", TOTAL, "gesamtbetrag"),
    ];
    expect(learnLayouts(evidence)).toEqual([]);
  });
});

describe("from the database", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan')").run();
    await env.DB.prepare("INSERT INTO suppliers (id, name) VALUES ('sup-ln', 'Lager Nord GmbH'), ('sup-kw', 'Kingsway')").run();
  });

  async function invoiceWithTotal(id: string, supplierId: string, total: number, box = TOTAL) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, ?, ?)").bind(id, JSON.stringify({ "BT-112": total }), supplierId).run();
    await handleRecordRegion(env.DB, id, "BT-112", "u-dan", { pageNumber: 1, box, label: "Gesamtbetrag", value: String(total), source: "found" });
  }

  it("learns a supplier's layout from its own invoices only", async () => {
    await invoiceWithTotal("i1", "sup-ln", 100);
    await invoiceWithTotal("i2", "sup-ln", 200);
    await invoiceWithTotal("i3", "sup-ln", 300);
    await invoiceWithTotal("k1", "sup-kw", 50, { ...TOTAL, y: 0.2 });
    const ln = await supplierLayouts(env.DB, "sup-ln");
    expect(ln.invoices).toBe(3);
    expect(ln.layouts[0].fields[0]).toMatchObject({ field: "BT-112", evidence: 3 });
    expect((await supplierLayouts(env.DB, "sup-kw")).layouts).toEqual([]);
  });

  it("does not count a region whose value is no longer the invoice's", async () => {
    await invoiceWithTotal("i1", "sup-ln", 100);
    await invoiceWithTotal("i2", "sup-ln", 200);
    await invoiceWithTotal("i3", "sup-ln", 300);
    await env.DB.prepare(`UPDATE invoice_headers SET facts_json = '{"BT-112": 301}' WHERE id = 'i3'`).run();
    expect((await supplierLayouts(env.DB, "sup-ln")).layouts).toEqual([]);
  });

  it("gives an invoice its supplier's layouts, and none to an invoice with no supplier", async () => {
    await invoiceWithTotal("i1", "sup-ln", 100);
    await invoiceWithTotal("i2", "sup-ln", 200);
    await invoiceWithTotal("i3", "sup-ln", 300);
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('orphan', '{}')").run();
    expect((await invoiceLayouts(env.DB, "i1"))!.layouts).toHaveLength(1);
    expect(await invoiceLayouts(env.DB, "orphan")).toEqual({ supplierId: null, layouts: [] });
    expect(await invoiceLayouts(env.DB, "nope")).toBeNull();
  });

  it("forgetting starts again from what is recorded afterwards, deleting nothing", async () => {
    await invoiceWithTotal("i1", "sup-ln", 100);
    await invoiceWithTotal("i2", "sup-ln", 200);
    await invoiceWithTotal("i3", "sup-ln", 300);
    expect((await forgetLayouts(env.DB, "sup-ln", "u-dan")).status).toBe(200);
    const after = await supplierLayouts(env.DB, "sup-ln");
    expect(after.layouts).toEqual([]);
    expect(after.forgottenAt).not.toBeNull();
    expect((await env.DB.prepare("SELECT count(*) AS n FROM invoice_field_regions").first<{ n: number }>())!.n).toBe(3);
    expect((await forgetLayouts(env.DB, "nobody", "u-dan")).status).toBe(404);
  });
});

describe("routes", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO suppliers (id, name) VALUES ('sup-ln', 'Lager Nord GmbH')").run();
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('i1', '{}', 'sup-ln')").run();
  });

  async function signedIn(permissions: readonly string[]) {
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES ('u-r', 'r@acme.com', 'R', ?)").bind(await hashApiKey(apiKey)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('role-x', 'X', ?)").bind(JSON.stringify(permissions)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-r', 'role-x')").run();
    const claims = { customerId: "test-customer", plan: "standard", features: [], volumeEntitlement: 10000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
    await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
    return apiKey;
  }
  const call = (method: string, path: string, apiKey: string | null) =>
    worker.fetch(
      new Request(`https://example.com${path}`, { method, headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {} }),
      env as unknown as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
    );

  it("serves an invoice's layouts and a supplier's, and forgets them for an administrator", async () => {
    const apiKey = await signedIn(PERMISSIONS);
    expect(await (await call("GET", "/invoices/i1/layouts", apiKey)).json()).toEqual({ supplierId: "sup-ln", layouts: [] });
    expect((await call("GET", "/suppliers/sup-ln/layouts", apiKey)).status).toBe(200);
    expect((await call("POST", "/suppliers/sup-ln/layouts/forget", apiKey)).status).toBe(200);
  });

  it("lets only an administrator forget", async () => {
    const apiKey = await signedIn(["AP.Validate"]);
    expect((await call("GET", "/suppliers/sup-ln/layouts", apiKey)).status).toBe(200);
    expect((await call("POST", "/suppliers/sup-ln/layouts/forget", apiKey)).status).toBe(403);
    expect((await call("GET", "/invoices/i1/layouts", null)).status).toBe(401);
  });
});
