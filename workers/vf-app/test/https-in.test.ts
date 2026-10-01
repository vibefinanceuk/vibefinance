import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { handleProcessRoutes } from "../src/routes-route.js";
import { handleCreateMapping, handlePublishMapping, handleSaveDraft, senderMatches, senderName } from "../src/supplier-mapping-route.js";

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
  await env.DB.prepare("INSERT INTO org_users (id, name, email) VALUES ('u-x', 'Dan Young', 'dan@acme.co.uk')").run();
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

// The Munch fixtures of supplier-mappings.test.ts.
const munch = (opts: { date?: string; number?: string } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<Rechnung xmlns="urn:munch:rechnung">
  <Kopf><Rechnungsnummer>${opts.number ?? "88240"}</Rechnungsnummer><Datum>${opts.date ?? "29.09.2026"}</Datum><Faelligkeit>29.10.2026</Faelligkeit><Waehrung>EUR</Waehrung></Kopf>
  <Lieferant><Name>Munch GmbH</Name><UStIdNr>DE812345678</UStIdNr></Lieferant>
  <Kunde><Name>Acme UK Ltd</Name><Land>GB</Land></Kunde>
  <Position nr="1"><Beschreibung>Hydraulic seal kit</Beschreibung><Menge>12</Menge><Einheit>Stk</Einheit><Einzelpreis>45,50</Einzelpreis><Netto>546,00</Netto></Position>
  <Summen><Netto>546,00</Netto><MwSt>103,74</MwSt><Brutto>649,74</Brutto></Summen>
</Rechnung>`;

const dc = [{ fn: "decimal_comma" }];
const DEFINITION = {
  linesPath: "Rechnung/Position",
  lines: [
    { target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", fx: [] },
    { target: "BT-2", source: "Rechnung/Kopf/Datum", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }], say: "day.month.year" },
    { target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }] },
    { target: "BT-5", source: "Rechnung/Kopf/Waehrung", fx: [] },
    { target: "BT-9", source: "Rechnung/Kopf/Faelligkeit", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-27", source: "Rechnung/Lieferant/Name", fx: [] },
    { target: "BT-31", source: "Rechnung/Lieferant/UStIdNr", fx: [] },
    { target: "BT-40", source: "Rechnung/Lieferant/UStIdNr", fx: [{ fn: "first_letters", args: { n: 2 } }] },
    { target: "BT-44", source: "Rechnung/Kunde/Name", fx: [] },
    { target: "BT-55", source: "Rechnung/Kunde/Land", fx: [] },
    { target: "BT-106", source: "Rechnung/Summen/Netto", fx: dc },
    { target: "BT-109", source: "Rechnung/Summen/Netto", fx: dc },
    { target: "BT-110", source: "Rechnung/Summen/MwSt", fx: dc },
    { target: "BT-112", source: "Rechnung/Summen/Brutto", fx: dc },
    { target: "BT-115", source: "Rechnung/Summen/Brutto", fx: dc },
    { target: "BT-126", source: "@nr", fx: [] },
    { target: "BT-129", source: "Menge", fx: [] },
    { target: "BT-130", source: "Einheit", fx: [{ fn: "unit_code" }] },
    { target: "BT-131", source: "Netto", fx: dc },
    { target: "BT-146", source: "Einzelpreis", fx: dc },
    { target: "BT-153", source: "Beschreibung", fx: [] },
  ],
};


/**
 * **Mappings shared by every Source route — decision 0579.** Dan sent a
 * <Rechnung> over HTTPS on 1 October and it failed: its mapping was on
 * Email in, and for an email domain. A mapping now reads the format
 * whichever way it arrives, and Who it is for can name an HTTPS key.
 */
describe("supplier mappings over HTTPS — decision 0579", () => {
  const send = (key: string, xml: string) =>
    call("/v1/sources/src-portal/invoices", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/xml", "X-Filename": "Rechnung_88240.xml" },
      body: xml,
    }).then((r) => r.json() as Promise<{ message: string; status: string; error?: string; invoices: string[] }>);

  async function emailMapping(senders: string[] | null) {
    await env.DB.prepare("INSERT INTO supplier_mappings (id, route_id, name, root, senders, created_at) VALUES ('MAP-MUNCH', 'email-in', 'Munch GmbH XML', 'Rechnung', ?, '2026-09-30T10:00:00Z')")
      .bind(senders ? JSON.stringify(senders) : null)
      .run();
    await env.DB.prepare(
      "INSERT INTO supplier_mapping_versions (mapping_id, version, status, definition_json, created_at, published_at) VALUES ('MAP-MUNCH', 1, 'live', ?, '2026-09-30T10:00:00Z', '2026-09-30T10:00:00Z')"
    )
      .bind(JSON.stringify({ root: "Rechnung", ...DEFINITION }))
      .run();
  }

  it("reads a file over HTTPS with a mapping drawn on Email in, once Who it is for names the key", async () => {
    await emailMapping(["@munch.de"]);
    const { key } = await makeKey("src-portal", "Lager Nord ERP");
    const refused = await send(key, munch());
    expect(refused.status).toBe("failed");
    expect(refused.error).toBe(`this is <Rechnung>, a supplier's own XML; the mapping "Munch GmbH XML" reads <Rechnung>, but is not for lager nord erp`);

    const saved = await handleSaveDraft(env.DB, "u-x", "MAP-MUNCH", { definition: DEFINITION, senders: ["@munch.de", "Lager Nord ERP"] });
    expect(saved.status).toBe(200);
    const row = await env.DB.prepare("SELECT senders FROM supplier_mappings WHERE id = 'MAP-MUNCH'").first<{ senders: string }>();
    expect(JSON.parse(row!.senders)).toEqual(["@munch.de", "lager nord erp"]);

    const read = await send(key, munch({ number: "88241" }));
    expect(read).toMatchObject({ status: "delivered", invoices: ["88241"] });
    // Another key on the same source is not who it is for.
    const other = await makeKey("src-portal", "Someone else");
    expect((await send(other.key, munch({ number: "88242" }))).status).toBe("failed");
  });

  it("a mapping for anyone reads it from any route, and the list is the same from every route", async () => {
    await emailMapping(null);
    const { key } = await makeKey("src-portal", "Portal");
    expect(await send(key, munch())).toMatchObject({ status: "delivered", invoices: ["88240"] });
    for (const route of ["email-in", "https-in"]) {
      const listed = await call(`/supplier-mappings?route=${route}`, { headers: { Authorization: `Bearer ${admin}` } });
      expect(((await listed.json()) as { mappings: Array<{ id: string; routeId: string }> }).mappings.map((m) => [m.id, m.routeId])).toEqual([["MAP-MUNCH", "email-in"]]);
    }
  });

  it("drawn from a file sent over HTTPS, a mapping is for the key that sent it", async () => {
    const { key } = await makeKey("src-portal", "Lager Nord ERP");
    const failed = await send(key, munch());
    expect(failed.error).toBe("this is <Rechnung>, a supplier's own XML, and no mapping reads it yet");
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-x", { messageId: failed.message, partSeq: 1 });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string; name: string }).id;
    expect((created.body as { name: string }).name).toBe("Lager Nord ERP <Rechnung>");
    const row = await env.DB.prepare("SELECT route_id, senders FROM supplier_mappings WHERE id = ?").bind(id).first<{ route_id: string; senders: string }>();
    expect(row).toEqual({ route_id: "https-in", senders: JSON.stringify(["lager nord erp"]) });
    await handleSaveDraft(env.DB, "u-x", id, { definition: DEFINITION });
    expect((await handlePublishMapping(env.DB, env.DOCUMENTS, "u-x", id)).status).toBe(200);
    expect(await send(key, munch({ number: "88243" }))).toMatchObject({ status: "delivered", invoices: ["88243"] });
  });
});

describe("Who it is for — decision 0579", () => {
  it("keeps a domain, an address or a name, and matches a name exactly", () => {
    expect(senderName(" @Munch.de ")).toBe("@munch.de");
    expect(senderName("Anna@Munch.de")).toBe("anna@munch.de");
    expect(senderName("  Lager   Nord ERP ")).toBe("lager nord erp");
    expect(senderName("a, b")).toBeNull();
    expect(senderName("a@b@c")).toBeNull();
    expect(senderName("")).toBeNull();
    expect(senderMatches(["lager nord erp"], "Lager Nord  ERP")).toBe(true);
    expect(senderMatches(["lager nord erp"], "Lager Nord ERP Ltd")).toBe(false);
    expect(senderMatches(["lager nord erp"], "Lager Nord ERP <ap@lagernord.de>")).toBe(false);
    expect(senderMatches(["@munch.de"], "Lager Nord ERP")).toBe(false);
  });
});

describe("an HTTPS source on Process routes — decision 0580", () => {
  it("counts its live keys, so its card can say whether it receives", async () => {
    const liveKeys = async () =>
      ((await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { sources: Array<{ id: string; liveKeys: number }> }).sources.find((s) => s.id === "src-portal")?.liveKeys;
    expect(await liveKeys()).toBe(0);
    const { id } = await makeKey("src-portal", "Portal");
    await makeKey("src-portal", "Coupa");
    expect(await liveKeys()).toBe(2);
    await call(`/sources/src-portal/keys/${id}/revoke`, { method: "POST", headers: { Authorization: `Bearer ${admin}` } });
    expect(await liveKeys()).toBe(1);
  });
});
