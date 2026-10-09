import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { handleRecordRegion, listRegions, regionTimeline, sameValue } from "../src/field-regions.js";
import { handleGetActivity } from "../src/activity-route.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { PERMISSIONS } from "../src/permissions.js";

/**
 * **Where each header value is on its document — decision 0701.** Step 1 of
 * docs/design/supplier-layout-learning.md.
 */

const BOX = { x: 0.82, y: 0.28, w: 0.07, h: 0.015 };

async function invoice(facts: Record<string, unknown>) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', ?)").bind(JSON.stringify(facts)).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan')").run();
});

describe("sameValue", () => {
  it("compares numbers by amount and text without case or punctuation", () => {
    expect(sameValue(1683.26, "1683.26")).toBe(true);
    expect(sameValue("1683.2", 1683.26)).toBe(false);
    expect(sameValue("RE-2026-0815", "re 2026 0815")).toBe(true);
    expect(sameValue("", "")).toBe(false);
    expect(sameValue(undefined, "x")).toBe(false);
  });
});

describe("handleRecordRegion", () => {
  it("records a found region with its label", async () => {
    await invoice({ "BT-112": 1683.26 });
    const r = await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 1, box: BOX, label: "Gesamtbetrag:", value: "1683.26", source: "found" });
    expect(r).toEqual({ status: 200, body: { recorded: "found" } });
    const [region] = (await listRegions(env.DB, "inv-1"))!;
    expect(region).toMatchObject({ field: "BT-112", pageNumber: 1, label: "gesamtbetrag", source: "found", current: true });
    expect(region.box.x).toBeCloseTo(0.82);
  });

  it("records a lasso that replaced a different value as a correction", async () => {
    await invoice({ "BT-112": 1683.26 });
    const r = await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 1, box: BOX, value: "1683.26", previous: "1683.2", source: "lassoed" });
    expect(r.body).toEqual({ recorded: "lassoed_corrected" });
  });

  it("a lasso of the value already there is a plain lasso", async () => {
    await invoice({ "BT-112": 1683.26 });
    const r = await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 1, box: BOX, value: "1683.26", previous: "1683.26", source: "lassoed" });
    expect(r.body).toEqual({ recorded: "lassoed" });
  });

  it("does not let a found region replace a lassoed one for the same value", async () => {
    await invoice({ "BT-112": 1683.26 });
    await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 1, box: BOX, value: "1683.26", source: "lassoed" });
    const r = await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 2, box: BOX, value: "1683.26", source: "found" });
    expect(r.body).toEqual({ kept: "lassoed" });
    expect((await listRegions(env.DB, "inv-1"))![0].pageNumber).toBe(1);
  });

  it("a region whose value is no longer the invoice's is not current", async () => {
    await invoice({ "BT-112": 99 });
    await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 1, box: BOX, value: "1683.26", source: "lassoed" });
    expect((await listRegions(env.DB, "inv-1"))![0].current).toBe(false);
  });

  it.each([
    ["a line field no table is learned from", "line.1.BT-133", { pageNumber: 1, box: BOX, value: "1", source: "found" }],
    ["no box", "BT-112", { pageNumber: 1, value: "1", source: "found" }],
    ["a box off the page", "BT-112", { pageNumber: 1, box: { ...BOX, x: 1.4 }, value: "1", source: "found" }],
    ["no value", "BT-112", { pageNumber: 1, box: BOX, value: "", source: "found" }],
    ["an unknown source", "BT-112", { pageNumber: 1, box: BOX, value: "1", source: "guessed" }],
  ])("refuses %s", async (_name, field, body) => {
    await invoice({});
    expect((await handleRecordRegion(env.DB, "inv-1", field, "u-dan", body)).status).toBe(400);
  });

  it("answers 404 for an invoice that does not exist", async () => {
    expect((await handleRecordRegion(env.DB, "nope", "BT-112", "u-dan", { pageNumber: 1, box: BOX, value: "1", source: "found" })).status).toBe(404);
  });
});

describe("the Timeline line", () => {
  it("names who took which field from which page, while it is still the invoice's value", async () => {
    await invoice({ "BT-112": 1683.26, "BT-1": "RE-1" });
    await handleRecordRegion(env.DB, "inv-1", "BT-112", "u-dan", { pageNumber: 1, box: BOX, value: "1683.26", previous: "1683.2", source: "lassoed" });
    await handleRecordRegion(env.DB, "inv-1", "BT-1", "u-dan", { pageNumber: 1, box: BOX, value: "RE-1", source: "found" });
    await handleRecordRegion(env.DB, "inv-1", "BT-2", "u-dan", { pageNumber: 1, box: BOX, value: "2026-10-09", source: "lassoed" });
    const lines = await regionTimeline(env.DB, "inv-1");
    // A found region is not a person's act; BT-2 was never saved.
    expect(lines).toEqual([
      expect.objectContaining({ kind: "action_taken", action: "value_from_document", userName: "Dan", field: "BT-112", pageNumber: 1, corrected: true }),
    ]);
    const activity = await handleGetActivity(env.DB, "inv-1");
    expect((activity.body as { items: { action?: string }[] }).items.some((i) => i.action === "value_from_document")).toBe(true);
  });
});

describe("routes", () => {
  async function signedIn(permissions: string[]) {
    const apiKey = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-dan'").bind(await hashApiKey(apiKey)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('role-x', 'X', ?)").bind(JSON.stringify(permissions)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-dan', 'role-x')").run();
    const claims = { customerId: "test-customer", plan: "standard", features: [], volumeEntitlement: 10000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
    await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
    return apiKey;
  }

  const call = (method: string, path: string, apiKey: string | null, body?: unknown) =>
    worker.fetch(
      new Request(`https://example.com${path}`, {
        method,
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env as unknown as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
    );

  it("records with PUT and reads back with GET, as the signed-in person", async () => {
    await invoice({ "BT-112": 1683.26 });
    const apiKey = await signedIn(PERMISSIONS as unknown as string[]);
    const put = await call("PUT", "/invoices/inv-1/regions/BT-112", apiKey, { pageNumber: 1, box: BOX, value: "1683.26", source: "lassoed" });
    expect(put.status).toBe(200);
    const got = (await (await call("GET", "/invoices/inv-1/regions", apiKey)).json()) as { regions: { field: string; current: boolean }[] };
    expect(got.regions).toEqual([expect.objectContaining({ field: "BT-112", current: true })]);
    const who = await env.DB.prepare("SELECT recorded_by FROM invoice_field_regions").first<{ recorded_by: string }>();
    expect(who!.recorded_by).toBe("u-dan");
  });

  it("refuses someone signed out, and someone who may not see invoices", async () => {
    await invoice({});
    expect((await call("GET", "/invoices/inv-1/regions", null)).status).toBe(401);
    const apiKey = await signedIn([]);
    expect((await call("PUT", "/invoices/inv-1/regions/BT-112", apiKey, { pageNumber: 1, box: BOX, value: "1", source: "found" })).status).toBe(403);
  });
});
