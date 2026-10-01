import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **HTTPS in — decision 0578.** A source's own address and keys; each
 * request a route message read as email is; the reply, and asking again.
 */

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>88240</cbc:ID>
  <cbc:IssueDate>2026-09-29</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>DE812345678</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Lager Nord GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">738.99</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`;

// A test env with an AI binding, which these XML invoices never call.
const testEnv = (): Env => ({ ...env, CUSTOMER_ID: "acme", AI: { run: async () => ({ response: "{}" }) } }) as unknown as Env;
const call = (path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://vf.example${path}`, init), testEnv());

let admin: string;
let validator: string;

async function person(permissions: string[]): Promise<string> {
  const id = crypto.randomUUID();
  const key = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, 'Dan Young', ?)").bind(id, `${id}@acme.example`, await hashApiKey(key)).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, 'Role', ?)").bind(id, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, id).run();
  return key;
}

async function makeKey(sourceId: string, name: string): Promise<{ id: string; key: string; prefix: string }> {
  const res = await call(`/sources/${sourceId}/keys`, {
    method: "POST",
    headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; key: string; prefix: string };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-in', 'ap', 'In')").run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism) VALUES ('src-portal', 'ap', 'Supplier portal API', 'https'), ('src-other', 'ap', 'Other API', 'https'), ('src-mail', 'ap', 'AP mailbox', 'email')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('src-portal', 'https-in', 'ap', 'src-portal'), ('src-other', 'https-in', 'ap', 'src-other'), ('src-mail', 'email-in', 'ap', 'src-mail')"
  ).run();
  admin = await person(["Admin.Configure"]);
  validator = await person(["AP.Validate"]);
});

describe("an HTTPS source's keys", () => {
  it("are made with a name, shown once, listed by their start only, and revoked", async () => {
    const made = await makeKey("src-portal", "Coupa portal");
    expect(made.key).toMatch(/^vf_in_[A-Za-z0-9_-]{30,}$/);
    expect(made.prefix).toBe(made.key.slice(0, 10));

    const list = await call("/sources/src-portal/keys", { headers: { Authorization: `Bearer ${admin}` } });
    const body = (await list.json()) as { address: string; keys: Array<Record<string, unknown>> };
    expect(body.address).toBe("https://vf.example/v1/sources/src-portal/invoices");
    expect(body.keys).toEqual([
      { id: made.id, name: "Coupa portal", prefix: made.prefix, createdAt: expect.any(String), createdBy: "Dan Young", lastUsedAt: null, revokedAt: null },
    ]);
    expect(JSON.stringify(body)).not.toContain(made.key);

    const twice = await call("/sources/src-portal/keys", {
      method: "POST",
      headers: { Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "coupa portal" }),
    });
    expect(twice.status).toBe(409);
    const revoked = await call(`/sources/src-portal/keys/${made.id}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${admin}` } });
    expect(revoked.status).toBe(200);
    expect((await call(`/sources/src-portal/keys/${made.id}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${admin}` } })).status).toBe(409);
  });

  it("belong to HTTPS sources only, and need Admin.Configure", async () => {
    expect((await call("/sources/src-mail/keys", { headers: { Authorization: `Bearer ${admin}` } })).status).toBe(404);
    expect((await call("/sources/src-portal/keys", { headers: { Authorization: `Bearer ${validator}` } })).status).toBe(403);
    expect((await call("/sources/src-portal/keys")).status).toBe(401);
  });
});

describe("sending an invoice", () => {
  it("reads it as email does, says what became of it, and answers again later", async () => {
    const { key } = await makeKey("src-portal", "Lager Nord ERP");
    const sent = await call("/v1/sources/src-portal/invoices", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/xml", "X-Filename": "Rechnung_88240.xml", "X-Reference": "LN-2026-0929" },
      body: UBL,
    });
    expect(sent.status).toBe(202);
    const reply = (await sent.json()) as Record<string, unknown> & { message: string; check: string };
    expect(reply).toMatchObject({
      status: "delivered",
      reference: "LN-2026-0929",
      files: [{ filename: "Rechnung_88240.xml", outcome: "captured" }],
      invoices: ["88240"],
    });
    expect(reply.message).toMatch(/^MSG-/);
    expect(reply.check).toBe(`https://vf.example/v1/sources/src-portal/messages/${reply.message}`);

    const row = await env.DB.prepare("SELECT instance_id, counterparty, recipient, subject FROM route_messages WHERE id = ?").bind(reply.message).first();
    expect(row).toEqual({ instance_id: "src-portal", counterparty: "Lager Nord ERP", recipient: "Supplier portal API", subject: "LN-2026-0929" });
    const used = await env.DB.prepare("SELECT last_used_at FROM source_keys WHERE name = 'Lager Nord ERP'").first<{ last_used_at: string | null }>();
    expect(used?.last_used_at).not.toBeNull();

    const again = await call(`/v1/sources/src-portal/messages/${reply.message}`, { headers: { Authorization: `Bearer ${key}` } });
    expect(await again.json()).toMatchObject({ message: reply.message, status: "delivered", invoices: ["88240"] });
  });

  it("takes the file as JSON with base64 too", async () => {
    const { key } = await makeKey("src-portal", "Portal");
    const sent = await call("/v1/sources/src-portal/invoices", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "88240.xml", content: btoa(UBL), reference: "batch 7" }),
    });
    expect(sent.status).toBe(202);
    expect(await sent.json()).toMatchObject({ status: "delivered", reference: "batch 7", invoices: ["88240"] });
  });

  it("refuses without a live key of this source, and what an invoice does not arrive as", async () => {
    const { id, key } = await makeKey("src-portal", "Portal");
    const other = await makeKey("src-other", "Other");
    const post = (k: string | null, headers: Record<string, string> = {}, body: BodyInit = UBL) =>
      call("/v1/sources/src-portal/invoices", {
        method: "POST",
        headers: { ...(k ? { Authorization: `Bearer ${k}` } : {}), "Content-Type": "application/xml", "X-Filename": "a.xml", ...headers },
        body,
      });
    expect((await post(null)).status).toBe(401);
    expect((await post(other.key)).status).toBe(401);
    expect((await post(admin)).status).toBe(401);
    expect((await post(key, { "X-Filename": "notes.docx", "Content-Type": "application/octet-stream" })).status).toBe(415);
    expect((await post(key, { "X-Filename": "" })).status).toBe(400);
    expect((await post(key, {}, "")).status).toBe(400);

    // Another source's key never sees this source's messages.
    const sent = (await (await post(key)).json()) as { message: string };
    expect((await call(`/v1/sources/src-other/messages/${sent.message}`, { headers: { Authorization: `Bearer ${other.key}` } })).status).toBe(404);

    await call(`/sources/src-portal/keys/${id}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${admin}` } });
    expect((await post(key)).status).toBe(401);
  });
});
