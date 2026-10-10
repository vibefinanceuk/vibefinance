import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { awaitingReply, handleGetSupplierMessages, handlePostSupplierMessage, type MessageEmail } from "../src/supplier-messages.js";
import { handleGetActivity } from "../src/activity-route.js";
import { handleGetInvoice } from "../src/invoice-facts-route.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS } from "@vibefinance/shared";

/**
 * **The conversation with the supplier — decision 0721.** Ask supplier,
 * the supplier's reply from the network, who is told, and the status.
 */

const PRIVATE_KEY: JsonWebKey = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "U-Zs04Hy_MlWHr9GlT1gZJgkbxmqFRJmP1VcTUx2Xmg",
  y: "okr43t1WZRRR27D1U_M2Ao18PjA6Fuk19NSuJ0MCijg",
  crv: "P-256",
  d: "meU9gflxUslwDVkLkdadGBdCX1VLlDcg1YDTdbUY3vk",
};

const PEOPLE = {
  links: [
    { id: "pl-1", email: "jo@lager-nord.example", status: "active", orgUnits: [{ id: "uk", name: "Acme UK Ltd" }] },
    { id: "pl-2", email: "kim@lager-nord.example", status: "active", orgUnits: [{ id: "ie", name: "Acme Ireland Ltd" }] },
    { id: "pl-3", email: "gone@lager-nord.example", status: "ended", orgUnits: [{ id: "uk", name: "Acme UK Ltd" }] },
  ],
  invitations: [],
};
const licence = () => ({ service: { fetch: async () => Response.json(PEOPLE) } as unknown as Fetcher, environmentId: "test-environment", apiKey: "k" });
const NO_EMAIL: MessageEmail = { apiKey: null, from: null, networkUrl: "https://network.example", appUrl: "https://app.example" };

async function licensed(features = ["supplier_portal"]) {
  const claims = { customerId: "c", plan: "standard", features, volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await licensed();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-alice', 'alice@acme.example', 'Alice McDonald')").run();
  // Acme UK North sits under Acme UK Ltd: a link for the company covers it.
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, parent_unit_id) VALUES ('uk-north', 'Acme UK North', 'uk')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name) VALUES ('sup-ln', 'Lager Nord GmbH')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id) VALUES ('inv-1', ?, 'sup-ln', 'uk-north')")
    .bind(JSON.stringify({ "BT-1": "LN-412", "BT-112": 479.04 }))
    .run();
});

const ask = (body: Record<string, unknown>) => handlePostSupplierMessage(env.DB, licence(), "inv-1", { id: "u-alice", name: "Alice McDonald" }, body, NO_EMAIL);

describe("who is told", () => {
  it("the supplier's people linked for the invoice's company or a company above it, never an ended link", async () => {
    const r = (await handleGetSupplierMessages(env.DB, licence(), "inv-1")).body as { available: boolean; canWrite: boolean; recipients: string[] };
    expect(r).toMatchObject({ available: true, canWrite: true, recipients: ["jo@lager-nord.example"] });
  });

  it("nobody, and nothing offered, without the portal licensed or anyone linked", async () => {
    await licensed([]);
    expect((await handleGetSupplierMessages(env.DB, licence(), "inv-1")).body).toMatchObject({ available: false, canWrite: false, recipients: [] });
    expect((await ask({ body: "Hello" })).status).toBe(409);
  });
});

describe("asking and answering", () => {
  it("Ask supplier records the question, the lines and who was emailed, and the invoice waits on it", async () => {
    const r = await ask({ body: "Line 4 is not on the PO.", ask: true, lines: [4, 4, "x"] });
    expect(r.status).toBe(201);
    expect((r.body as { message: unknown }).message).toMatchObject({ direction: "to_supplier", kind: "question", lines: [4], emailed: ["jo@lager-nord.example"], emailError: "email sending is not configured for this deployment" });
    const got = (await handleGetSupplierMessages(env.DB, licence(), "inv-1")).body as { awaiting: boolean };
    expect(got.awaiting).toBe(true);
    const invoice = (await handleGetInvoice(env.DB, "inv-1")).body as { supplierQuery: { askedBy: string; supplierName: string } | null };
    expect(invoice.supplierQuery).toMatchObject({ askedBy: "Alice McDonald", supplierName: "Lager Nord GmbH" });
  });

  it("refuses an empty message", async () => {
    expect((await ask({ body: "   " })).status).toBe(400);
  });

  it("the supplier's reply in the network ends the wait, and both show on the Timeline", async () => {
    await ask({ body: "Line 4 is not on the PO.", ask: true });
    const token = await signPortalToken(
      { kind: "portal_access", email: "jo@lager-nord.example", supplierOrgId: "so", linkId: "pl-1", environmentId: "test-environment", supplierId: "sup-ln", orgUnitIds: ["uk"], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString() },
      PRIVATE_KEY
    );
    const before = (await (await SELF.fetch("https://app.example.com/portal/invoices/inv-1", { headers: { Authorization: `Bearer ${token}` } })).json()) as { invoice: { status: string; messages: { from: string; body: string; authorName: string | null }[] } };
    expect(before.invoice.status).toBe("query_raised");
    // The supplier sees the question, never who at the customer wrote it or who was emailed.
    expect(before.invoice.messages).toEqual([expect.objectContaining({ from: "customer", body: "Line 4 is not on the PO.", authorName: null })]);
    expect(JSON.stringify(before)).not.toContain("alice@acme.example");

    const replied = await SELF.fetch("https://app.example.com/portal/invoices/inv-1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Those were for PO 318; corrected invoice to follow." }),
    });
    expect(replied.status).toBe(201);
    const after = (await (await SELF.fetch("https://app.example.com/portal/invoices/inv-1", { headers: { Authorization: `Bearer ${token}` } })).json()) as { invoice: { status: string } };
    expect(after.invoice.status).not.toBe("query_raised");
    expect(((await handleGetSupplierMessages(env.DB, licence(), "inv-1")).body as { awaiting: boolean }).awaiting).toBe(false);
    // The reply's email went to whoever asked (no task here).
    const reply = await env.DB.prepare("SELECT emailed_json FROM supplier_messages WHERE direction = 'from_supplier'").first<{ emailed_json: string }>();
    expect(JSON.parse(reply!.emailed_json)).toEqual(["alice@acme.example"]);

    const items = ((await handleGetActivity(env.DB, "inv-1")).body as { items: { action?: string; supplierName?: string }[] }).items;
    expect(items.filter((i) => i.action?.startsWith("supplier_")).map((i) => i.action)).toEqual(["supplier_asked", "supplier_replied"]);
  });

  it("a supplier cannot write on an invoice their link does not cover", async () => {
    const token = await signPortalToken(
      { kind: "portal_access", email: "kim@lager-nord.example", supplierOrgId: "so", linkId: "pl-2", environmentId: "test-environment", supplierId: "sup-ln", orgUnitIds: ["ie"], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300e3).toISOString() },
      PRIVATE_KEY
    );
    const r = await SELF.fetch("https://app.example.com/portal/invoices/inv-1/messages", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify({ body: "hi" }) });
    expect(r.status).toBe(404);
  });
});

describe("awaitingReply", () => {
  it("only while a question is the customer's last word", () => {
    expect(awaitingReply([])).toBe(false);
    expect(awaitingReply([{ direction: "to_supplier", kind: "message" }])).toBe(false);
    expect(awaitingReply([{ direction: "to_supplier", kind: "question" }, { direction: "to_supplier", kind: "message" }])).toBe(true);
    expect(awaitingReply([{ direction: "to_supplier", kind: "question" }, { direction: "from_supplier", kind: "message" }])).toBe(false);
  });
});

describe("the route", () => {
  it("needs a person who may open the invoice", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-alice'").bind(await hashApiKey(key)).run();
    const call = (method: string, body?: unknown) =>
      worker.fetch(
        new Request("https://app.example.com/invoices/inv-1/supplier-messages", { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) }),
        { ...(env as unknown as Env), LICENCE_SERVICE: licence().service, VF_LICENCE_API_KEY: "k" } as Env,
        { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
      );
    expect((await call("GET")).status).toBe(403);
    await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'r', '["AP.Match"]')`).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-alice', 'r')").run();
    expect((await call("GET")).status).toBe(200);
    expect((await call("POST", { body: "Hello", ask: true })).status).toBe(201);
  });
});

/**
 * **Return to supplier, in the network — decision 0724.** The return is a
 * message there (reason, then comment); the linked people are emailed with
 * a link; the invoice shows Returned; the supplier may reply.
 */
describe("Return to supplier in the network", () => {
  async function atReview() {
    await env.DB.prepare("UPDATE suppliers SET email = 'accounts@lager-nord.example' WHERE id = 'sup-ln'").run();
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('p', 'AP')").run();
    await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('s1', 'p', 'Review', 1)").run();
    await env.DB.prepare("INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence) SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id").run();
    await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi', 'p', 'invoice', 'inv-1', 's1', 'in_progress')").run();
    await env.DB.prepare("INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome) VALUES ('v1', 'pi', 's1', 'matched')").run();
    await env.DB.prepare("INSERT INTO tasks (id, stage_id, stage_visit_id, owner_user_id, required_permission) VALUES ('t1', 's1', 'v1', 'u-alice', 'AP.Review')").run();
    await env.DB.prepare(`INSERT INTO org_roles (id, name, permissions_json) VALUES ('rr', 'rr', '["AP.Review","AP.ReturnToSupplier"]')`).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-alice', 'rr')").run();
  }
  const ALICE = { id: "u-alice", email: "alice@acme.example", name: "Alice McDonald" };
  const NO_RESEND = { apiKey: null, fromAddress: null };
  const token = () =>
    signPortalToken(
      { kind: "portal_access", email: "jo@lager-nord.example", supplierOrgId: "so", linkId: "pl-1", environmentId: "test-environment", supplierId: "sup-ln", orgUnitIds: ["uk"], issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 300e3).toISOString() },
      PRIVATE_KEY
    );

  it("puts the reason and the comment in the conversation, emails the linked people with the network, and shows Returned", async () => {
    await atReview();
    const { handleReturnToSupplier } = await import("../src/return-route.js");
    const r = await handleReturnToSupplier(env.DB, "t1", { reasonId: "duplicate_invoice", comment: "Please send a credit note." }, ALICE, NO_RESEND, { link: licence(), email: NO_EMAIL });
    expect(r.status).toBe(200);

    const m = await env.DB.prepare("SELECT kind, direction, body, emailed_json, author_name FROM supplier_messages").first<Record<string, string>>();
    expect(m).toMatchObject({ kind: "return", direction: "to_supplier", body: "Duplicate invoice\n\nPlease send a credit note.", author_name: "Alice McDonald" });
    expect(JSON.parse(m!.emailed_json)).toEqual(["jo@lager-nord.example"]);
    // The return's own email, to the supplier record's address, names the network too.
    const mail = await env.DB.prepare("SELECT to_address, body FROM supplier_return_emails").first<{ to_address: string; body: string }>();
    expect(mail?.to_address).toBe("accounts@lager-nord.example");
    expect(mail?.body).toContain("supplier network: https://network.example/");

    const seen = (await (await SELF.fetch("https://app.example.com/portal/invoices/inv-1", { headers: { Authorization: `Bearer ${await token()}` } })).json()) as {
      invoice: { status: string; comment: string | null; messages: { kind: string; from: string; body: string }[] };
    };
    expect(seen.invoice.status).toBe("returned");
    expect(seen.invoice.messages).toEqual([expect.objectContaining({ kind: "return", from: "customer", body: "Duplicate invoice\n\nPlease send a credit note." })]);
    // Said once, in the conversation.
    expect(seen.invoice.comment).toBeNull();

    // The Timeline's own Return to supplier entry says it; no second entry.
    const items = ((await handleGetActivity(env.DB, "inv-1")).body as { items: { action?: string }[] }).items;
    expect(items.filter((i) => i.action?.startsWith("supplier_"))).toEqual([]);
  });

  it("lets the supplier reply; whoever returned it is emailed, and it stays Returned", async () => {
    await atReview();
    const { handleReturnToSupplier } = await import("../src/return-route.js");
    await handleReturnToSupplier(env.DB, "t1", { reasonId: "duplicate_invoice" }, ALICE, NO_RESEND, { link: licence(), email: NO_EMAIL });
    const replied = await SELF.fetch("https://app.example.com/portal/invoices/inv-1/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ body: "Credit note sent today." }),
    });
    expect(replied.status).toBe(201);
    const reply = await env.DB.prepare("SELECT emailed_json FROM supplier_messages WHERE direction = 'from_supplier'").first<{ emailed_json: string }>();
    expect(JSON.parse(reply!.emailed_json)).toEqual(["alice@acme.example"]);
    const after = (await (await SELF.fetch("https://app.example.com/portal/invoices/inv-1", { headers: { Authorization: `Bearer ${await token()}` } })).json()) as { invoice: { status: string } };
    expect(after.invoice.status).toBe("returned");
  });

  it("adds nothing to the network when nobody is linked, and the email stays as it was", async () => {
    await atReview();
    await licensed([]);
    const { handleReturnToSupplier } = await import("../src/return-route.js");
    await handleReturnToSupplier(env.DB, "t1", { reasonId: "duplicate_invoice" }, ALICE, NO_RESEND, { link: licence(), email: NO_EMAIL });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM supplier_messages").first<{ n: number }>())?.n).toBe(0);
    expect((await env.DB.prepare("SELECT body FROM supplier_return_emails").first<{ body: string }>())?.body).not.toContain("supplier network");
  });
});
