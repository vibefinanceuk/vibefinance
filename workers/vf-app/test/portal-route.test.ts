import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, signSessionToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import { portalStatusOf } from "../src/portal-route.js";

/**
 * **The supplier portal's view of an instance — decision 0714.** Only the
 * token's supplier, only the token's companies, in the supplier's words.
 */

// The test keypair whose public half is in wrangler.test.jsonc (see session-routes.test.ts).
const PRIVATE_KEY: JsonWebKey = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "U-Zs04Hy_MlWHr9GlT1gZJgkbxmqFRJmP1VcTUx2Xmg",
  y: "okr43t1WZRRR27D1U_M2Ao18PjA6Fuk19NSuJ0MCijg",
  crv: "P-256",
  d: "meU9gflxUslwDVkLkdadGBdCX1VLlDcg1YDTdbUY3vk",
};

function access(o: Partial<PortalAccessClaims> = {}): Promise<string> {
  const now = new Date();
  return signPortalToken(
    {
      kind: "portal_access",
      email: "jo@lager-nord.example",
      supplierOrgId: "so-1",
      linkId: "pl-1",
      environmentId: "test-environment",
      supplierId: "sup-ln",
      orgUnitIds: ["uk"],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString(),
      ...o,
    },
    PRIVATE_KEY
  );
}

const get = (path: string, token?: string) => SELF.fetch(`https://app.example.com${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

async function licence(features: string[]) {
  const claims = { customerId: "c", plan: "standard", features, volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
}

async function invoice(id: string, number: string, supplier: string, unit: string | null, createdAt: string, facts: Record<string, unknown> = {}) {
  // The header columns are generated from the facts (decision 0681).
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": number, "BT-2": "2026-10-01", "BT-5": "GBP", "BT-112": 120, "BT-13": "PO-1", "BT-27": "Lager Nord", ...facts }), supplier, unit, createdAt)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await licence(["supplier_portal"]);
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name) VALUES ('sup-ln', 'Lager Nord GmbH'), ('sup-x', 'Other Ltd')").run();
  await invoice("inv-uk", "LN-1", "sup-ln", "uk", "2026-10-02 10:00:00");
  await invoice("inv-ie", "LN-2", "sup-ln", "ie", "2026-10-03 10:00:00");
  await invoice("inv-other", "OX-1", "sup-x", "uk", "2026-10-04 10:00:00");
  await invoice("inv-unplaced", "LN-3", "sup-ln", null, "2026-10-05 10:00:00");
  await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES ('l1', 'inv-uk', 1, ?)")
    .bind(JSON.stringify({ "BT-153": "Kopierpapier A4", "BT-129": 10, "BT-146": 10, "BT-131": 100, "BT-133": "CC-SECRET" }))
    .run();
});

describe("which invoices", () => {
  it("only this supplier's, only the linked companies', never one not yet placed in a company", async () => {
    const res = await get("/portal/invoices", await access());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: { id: string; company: string; invoiceNumber: string; purchaseOrder: string; status: string }[] };
    expect(body.invoices).toEqual([
      expect.objectContaining({ id: "inv-uk", invoiceNumber: "LN-1", company: "Acme UK Ltd", purchaseOrder: "PO-1", status: "received" }),
    ]);
    const both = (await (await get("/portal/invoices", await access({ orgUnitIds: ["uk", "ie"] }))).json()) as { invoices: { id: string }[] };
    expect(both.invoices.map((i) => i.id)).toEqual(["inv-ie", "inv-uk"]);
  });

  it("one invoice with its lines, and the same 404 for another supplier's as for none", async () => {
    const token = await access();
    const one = (await (await get("/portal/invoices/inv-uk", token)).json()) as { invoice: { lines: Record<string, unknown>[] } };
    expect(one.invoice.lines).toEqual([{ lineNumber: 1, description: "Kopierpapier A4", quantity: 10, unitPrice: 10, netAmount: 100 }]);
    // Nothing of the customer's coding.
    expect(JSON.stringify(one)).not.toContain("CC-SECRET");
    const other = await get("/portal/invoices/inv-other", token);
    const none = await get("/portal/invoices/nope", token);
    expect(other.status).toBe(404);
    expect(await other.json()).toEqual(await none.json());
    expect((await get("/portal/invoices/inv-ie", token)).status).toBe(404);
  });

  it("searches the invoice number and purchase order, and filters by status", async () => {
    const token = await access({ orgUnitIds: ["uk", "ie"] });
    const found = (await (await get("/portal/invoices?q=LN-2", token)).json()) as { invoices: { id: string }[] };
    expect(found.invoices.map((i) => i.id)).toEqual(["inv-ie"]);
    const none = (await (await get("/portal/invoices?status=approved", token)).json()) as { invoices: unknown[] };
    expect(none.invoices).toEqual([]);
  });
});

describe("who may ask", () => {
  it("refuses no token, a staff session, a token for another environment, and an expired one", async () => {
    expect((await get("/portal/invoices")).status).toBe(401);
    const staff = await signSessionToken(
      { email: "alice@acme.com", name: "Alice", environmentId: "test-environment", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600e3).toISOString() },
      PRIVATE_KEY
    );
    expect((await get("/portal/invoices", staff)).status).toBe(401);
    expect((await get("/portal/invoices", await access({ environmentId: "elsewhere" }))).status).toBe(401);
    expect((await get("/portal/invoices", await access({ expiresAt: new Date(Date.now() - 1000).toISOString() }))).status).toBe(401);
  });

  it("a portal token opens no staff route", async () => {
    expect((await get("/invoices/inv-uk", await access())).status).toBe(401);
    expect((await get("/whoami", await access())).status).toBe(401);
  });

  it("refuses when the customer's licence does not include the portal", async () => {
    await licence([]);
    const res = await get("/portal/invoices", await access());
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ reason: "portal_not_licensed" });
  });
});

describe("the status, in the supplier's words", () => {
  const base = { instance_status: "in_progress", cur_seq: 2, approval_seq: 4, task_count: 0, exported: 0, delivered: 0 };
  it.each([
    ["no process yet", { instance_status: null, cur_seq: null, approval_seq: null }, "received"],
    ["moving, nobody has had to look", {}, "received"],
    ["a person has a task on it", { task_count: 1 }, "in_review"],
    ["at the approval stage", { cur_seq: 4, task_count: 1 }, "in_review"],
    ["past the approval stage", { cur_seq: 5, task_count: 2 }, "approved"],
    ["finished", { instance_status: "completed" }, "approved"],
    ["exported to the ERP", { instance_status: "completed", exported: 1 }, "sent_for_payment"],
    ["delivered to a Destination", { instance_status: "completed", delivered: 1 }, "sent_for_payment"],
    ["returned to the supplier", { instance_status: "returned_manually", task_count: 1 }, "rejected"],
    ["discarded", { instance_status: "archived" }, "rejected"],
  ])("%s", (_name, over, expected) => {
    expect(portalStatusOf({ ...base, ...over } as never)).toBe(expected);
  });

  it("a returned invoice carries the comment written for the supplier, and nothing else of the return", async () => {
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('p', 'AP')").run();
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('s1', 'p', 'Matching', 1)").run();
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status, end_reason, supplier_comment) VALUES ('pi', 'p', 'invoice', 'inv-uk', 's1', 'returned_manually', 'Internal: wrong entity', 'Please re-issue to Acme UK Ltd with our PO number.')"
    ).run();
    const one = (await (await get("/portal/invoices/inv-uk", await access())).json()) as { invoice: { status: string; comment: string } };
    expect(one.invoice).toMatchObject({ status: "rejected", comment: "Please re-issue to Acme UK Ltd with our PO number." });
    expect(JSON.stringify(one)).not.toContain("Internal");
    expect(JSON.stringify(one)).not.toContain("Matching");
  });
});
