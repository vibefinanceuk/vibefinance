import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { validatePartnerDefinition, type PartnerConnectorDefinition } from "@vibefinance/shared";
import { handleCreateDestination, handleSaveConnector } from "../src/destination-delivery.js";
import { handleCopyOutboundMapping, handlePublishOutboundMapping, handleSaveOutboundMapping, handleTryOutboundMapping } from "../src/outbound-mapping-route.js";
import { handleGetSubmission, handleSubmit, handleWithdraw } from "../src/library-submission-route.js";
import type { LicenceLink } from "../src/invitations-route.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Submit for review — decision 0595.** A Destination in a partner's
 * sandbox becomes a connector version for VibeFinance to review: what it
 * does, never its address or secrets, its mapping's lists by name.
 */

const KEY = btoa("k".repeat(32));
type Call = { url: string; method: string; body: Record<string, unknown> | null };

function licence(replies: Record<string, { status: number; body: unknown }>) {
  const calls: Call[] = [];
  const service = {
    fetch: async (url: string, init: RequestInit = {}) => {
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      calls.push({ url: String(url), method: init.method ?? "GET", body });
      const key = `${init.method ?? "GET"} ${new URL(String(url)).pathname}`;
      const reply = replies[key] ?? { status: 404, body: { error: "no stub" } };
      return new Response(JSON.stringify(reply.body), { status: reply.status });
    },
  } as unknown as Fetcher;
  return { calls, link: { service, environmentId: "nw-sbx", apiKey: "nw-key" } as LicenceLink };
}

const PARTNER = { partner: { id: "northwind", name: "Northwind", status: "active" }, customers: [{ id: "acme", name: "Acme Ltd" }], canSubmit: true, connector: null };

async function invoice(id: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?1, json_set(?2, '$.BT-1', ?3))")
    .bind(id, JSON.stringify({ "BT-1": "INV-A", "BT-2": "2026-09-29", "BT-5": "EUR", "BT-112": 120, "BT-109": 100, "BT-110": 20, "BT-27": "Lager Nord GmbH" }), "INV-A")
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES (?, 1, ?)").bind(id, JSON.stringify({ "BT-153": "Pallets", "BT-131": 100, "coding.gl_code": "620300" })).run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'ap-eligible', 'in_progress')").bind(`pi-${id}`, id).run();
}

async function destination(settings: Record<string, unknown>, secret?: string) {
  const made = await handleCreateDestination(env.DB, "u-ana", "ap", { name: "Oracle push" });
  const id = (made.body as { id: string }).id;
  expect((await handleSaveConnector(env.DB, "u-ana", id, { settings, ...(secret ? { secret } : {}) }, KEY)).status).toBe(200);
  return id;
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-ana', 'ana@northwind.example', 'Ana')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await seedStage("ap-intake", "ap", "Intake", 1);
  await seedStage("ap-eligible", "ap", "Payment Eligible", 2);
});

describe("submitting a Destination for review — decision 0595", () => {
  it("builds the connector from what the Destination does: its sign-in, reference and mapping, lists by name, never its address or secret", async () => {
    await invoice("inv-a");
    const at = "2026-10-02T00:00:00Z";
    await env.DB.prepare("INSERT INTO lookup_lists (id, name, created_at, updated_at) VALUES ('lst-1', 'Business units', ?, ?)").bind(at, at).run();
    await env.DB.prepare("INSERT INTO lookup_entries (list_id, key, from_value, to_value) VALUES ('lst-1', 'lager nord gmbh', 'Lager Nord GmbH', 'BU1')").run();
    const id = await destination({ url: "https://erp.northwind.example/invoices", auth: { type: "basic", username: "integration" }, referencePath: "$.InvoiceId" }, "s3cret-password");
    await handleCopyOutboundMapping(env.DB, "u-ana", id);
    const got = (await env.DB.prepare("SELECT definition_json FROM outbound_mapping_versions").first<{ definition_json: string }>())!;
    const def = JSON.parse(got.definition_json);
    def.invoice.push({ target: "BusinessUnit", source: "supplier.name", fx: [{ fn: "look_up", args: { list: "lst-1", otherwise: "refuse" } }] });
    await handleSaveOutboundMapping(env.DB, "u-ana", id, { definition: def });
    await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" });
    await handlePublishOutboundMapping(env.DB, "u-ana", id, {});

    const { calls, link } = licence({
      "GET /environments/nw-sbx/partner-connectors": { status: 200, body: PARTNER },
      "POST /environments/nw-sbx/partner-connectors": { status: 201, body: { version: 1, status: "submitted" } },
    });
    const state = await handleGetSubmission(env.DB, link, id, "ana@northwind.example");
    expect(state.body).toMatchObject({
      ...PARTNER,
      destination: { name: "Oracle push", method: "POST", format: "mapped", authType: "basic", referencePath: "$.InvoiceId", lookupLists: ["Business units"], problems: [], draftNotPublished: null },
    });
    expect(calls[0].url).toBe(`https://vf-licence.internal/environments/nw-sbx/partner-connectors?instanceId=${id}&email=ana%40northwind.example`);

    const sent = await handleSubmit(env.DB, link, id, "ana@northwind.example", {
      name: "Oracle Payables",
      description: "Creates the invoice in Oracle Payables.",
      notes: "Tried on INV-A.",
      audience: ["acme"],
      fixed: ["format"],
      authTypes: ["basic", "oauth2_client_credentials"],
      vendorDocs: "https://docs.oracle.com/x",
      // Ignored: the definition is the Destination's own.
      definition: { url: "https://evil.example" },
    });
    expect(sent).toEqual({ status: 201, body: { version: 1, status: "submitted" } });
    const submitted = calls[1].body!;
    expect(submitted).toMatchObject({ instanceId: id, submittedBy: "ana@northwind.example", name: "Oracle Payables", audience: ["acme"], notes: "Tried on INV-A." });
    const definition = submitted.definition as PartnerConnectorDefinition;
    expect(validatePartnerDefinition(definition)).toBeNull();
    expect(definition.settings).toEqual({
      defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" },
      fixed: ["format"],
      authTypes: ["basic", "oauth2_client_credentials"],
    });
    expect(definition.lookupLists).toEqual(["Business units"]);
    expect(definition.outboundMapping!.invoice.at(-1)!.fx[0].args).toEqual({ list: "Business units", otherwise: "refuse" });
    const text = JSON.stringify(submitted);
    expect(text).not.toContain("erp.northwind.example");
    expect(text).not.toContain("s3cret");
    expect(text).not.toContain("integration");
    expect(text).not.toContain("lst-1");
  });

  it("says when it cannot be submitted yet, and passes on what the control plane says", async () => {
    const id = await destination({ url: "https://erp.example/x" });
    // Its own layout chosen with nothing published is refused when saving; so make one, then take it away.
    await env.DB.prepare("UPDATE route_instances SET settings_json = json_set(settings_json, '$.format', 'mapped') WHERE id = ?").bind(id).run();
    const { link } = licence({
      "GET /environments/nw-sbx/partner-connectors": { status: 200, body: PARTNER },
      "POST /environments/nw-sbx/partner-connectors/withdraw": { status: 409, body: { reason: "not_waiting", error: "that version is not waiting for review" } },
    });
    expect(((await handleGetSubmission(env.DB, link, id, "ana@northwind.example")).body as { destination: { problems: string[] } }).destination.problems).toEqual(["no_live_mapping"]);
    expect(await handleSubmit(env.DB, link, id, "ana@northwind.example", { name: "X", description: "Y", audience: "all" })).toMatchObject({ status: 409, body: { reason: "no_live_mapping" } });
    expect(await handleWithdraw(link, id, "ana@northwind.example", { version: 1 })).toMatchObject({ status: 409, body: { reason: "not_waiting" } });

    // Not a partner's sandbox: nothing more is shown.
    const { link: customer } = licence({ "GET /environments/nw-sbx/partner-connectors": { status: 200, body: { partner: null } } });
    expect((await handleGetSubmission(env.DB, customer, id, "x")).body).toEqual({ partner: null });
    expect(await handleGetSubmission(env.DB, customer, "nope", "x")).toMatchObject({ status: 404 });
  });

  it("sends the standard layout when the Destination does, with no mapping or lists", async () => {
    const id = await destination({ url: "https://erp.example/x", auth: { type: "api_key_header", header: "X-Key" } }, "k");
    const { calls, link } = licence({ "POST /environments/nw-sbx/partner-connectors": { status: 201, body: { version: 1 } } });
    await handleSubmit(env.DB, link, id, "ana@northwind.example", { name: "Generic", description: "Posts JSON.", audience: "all" });
    const d = calls[0].body!.definition as PartnerConnectorDefinition;
    expect(d).toMatchObject({ outboundMapping: null, lookupLists: [], settings: { defaults: { format: "vf_json", auth: { type: "api_key_header", header: "X-Key" } }, fixed: [], authTypes: ["api_key_header"] } });
  });
});

describe("through the router", () => {
  it("is Admin.Configure's, and goes to the control plane with this environment's key", async () => {
    const key = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES ('u-admin', 'admin@northwind.example', 'A', ?)").bind(await hashApiKey(key)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'Role', ?)").bind(JSON.stringify(["Admin.Configure"])).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-admin', 'r')").run();
    const id = await destination({ url: "https://erp.example/x" });
    const { calls, link } = licence({ "GET /environments/nw-sbx/partner-connectors": { status: 200, body: { partner: null } } });
    const e = { ...env, LICENCE_SERVICE: link.service, ENVIRONMENT_ID: "nw-sbx", VF_LICENCE_API_KEY: "nw-key" } as unknown as Env;
    const r = await worker.fetch(new Request(`https://vf.example/route-instances/${id}/library-submission`, { headers: { Authorization: `Bearer ${key}` } }), e);
    expect(r.status).toBe(200);
    expect(calls[0].url).toContain("email=admin%40northwind.example");
    const anaKey = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-ana'").bind(await hashApiKey(anaKey)).run();
    expect((await worker.fetch(new Request(`https://vf.example/route-instances/${id}/library-submission`, { headers: { Authorization: `Bearer ${anaKey}` } }), e)).status).toBe(403);
  });
});
