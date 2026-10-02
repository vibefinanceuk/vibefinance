import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { PARTNER_CONNECTOR_SCHEMA, standardOutboundMapping, type OutboundMapping, type PartnerConnectorDefinition } from "@vibefinance/shared";
import { handleConnectorLibrary } from "../src/connector-library-route.js";
import { handleCreateDestination, handleGetConnector, handleSaveConnector, handleUpgradeConnector } from "../src/destination-delivery.js";
import { handleGetOutboundMapping } from "../src/outbound-mapping-route.js";
import { handleProcessRoutes } from "../src/routes-route.js";
import { connectorLibrary, refreshPartnerConnectors } from "../src/partner-library.js";
import type { LicenceLink } from "../src/invitations-route.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Partner connectors in the Route library — decision 0601.** What the
 * control plane offers is kept as a copy, listed with its partner, added
 * with its mapping and look-up lists, and upgraded while the customer's
 * mapping still follows it.
 */

const KEY = btoa("k".repeat(32));
const ID = "partner:c-oracle";

function mapping(extra: string | null = null): OutboundMapping {
  const m = standardOutboundMapping();
  m.invoice.push({ target: "BusinessUnit", source: "supplier.name", fx: [{ fn: "look_up", args: { list: "Business units", otherwise: "refuse" } }] });
  if (extra) m.invoice.push({ target: extra, source: null, fixed: "yes", fx: [] });
  return m;
}
const definition = (extra: string | null = null, format: "mapped" | "vf_json" = "mapped"): PartnerConnectorDefinition => ({
  schema: PARTNER_CONNECTOR_SCHEMA,
  direction: "destination",
  routeId: "https-out",
  transport: "https",
  settings: { defaults: { method: "POST", format, auth: { type: "basic" }, referencePath: "$.InvoiceId" }, fixed: ["format"], authTypes: ["basic", "oauth2_client_credentials"] },
  outboundMapping: format === "mapped" ? mapping(extra) : null,
  lookupLists: format === "mapped" ? ["Business units"] : [],
  vendorDocs: "https://docs.oracle.com/x",
});
const offer = (version: number, def = definition()) => ({
  connectorId: "c-oracle",
  version,
  name: "Oracle Payables",
  description: "Creates the invoice in Oracle Payables.",
  partner: { id: "northwind", name: "Northwind" },
  approvedAt: "2026-10-02T10:00:00Z",
  definition: def,
});

function licence(reply: { status: number; body: unknown }) {
  const state = { reply };
  const service = {
    fetch: async (url: string) => {
      expect(new URL(String(url)).pathname).toBe("/environments/acme-prod/library-connectors");
      return new Response(JSON.stringify(state.reply.body), { status: state.reply.status });
    },
  } as unknown as Fetcher;
  return { state, link: { service, environmentId: "acme-prod", apiKey: "acme-key" } as LicenceLink };
}

type Card = { id: string; status: string; publisher: string; partner: unknown; name: string | null; description: string | null; categories: string[]; formats: string[]; inUse: Array<{ upgradeAvailable: boolean }> };
const cards = async () => ((await handleConnectorLibrary(env.DB, await connectorLibrary(env.DB))).body as { connectors: Card[] }).connectors;
const live = async (id: string) =>
  env.DB.prepare("SELECT version, definition_json, copied_from FROM outbound_mapping_versions WHERE instance_id = ? AND status = 'live'").bind(id).first<{ version: number; definition_json: string; copied_from: string }>();
async function add(name = "Oracle push") {
  const r = await handleCreateDestination(env.DB, "u-dan", "ap", { name, connectorId: ID }, await connectorLibrary(env.DB));
  expect(r.status).toBe(201);
  return r.body as { id: string; listsCreated: string[] };
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP')").run();
});

describe("partner connectors in the Route library — decision 0601", () => {
  it("lists what the control plane offers, with its partner, name and description, and keeps a copy", async () => {
    const { link } = licence({ status: 200, body: { connectors: [offer(1)] } });
    expect(await refreshPartnerConnectors(env.DB, link)).toEqual({ ok: true });
    const card = (await cards()).find((c) => c.id === ID)!;
    expect(card).toMatchObject({
      status: "available",
      publisher: "partner",
      partner: { id: "northwind", name: "Northwind" },
      name: "Oracle Payables",
      description: "Creates the invoice in Oracle Payables.",
      categories: ["partner"],
      formats: ["mapped"],
      inUse: [],
    });
    // The control plane cannot be reached: what was kept stands.
    const { link: down } = licence({ status: 502, body: { error: "the control plane could not be reached" } });
    expect(await refreshPartnerConnectors(env.DB, down)).toEqual({ ok: false, error: "the control plane could not be reached" });
    expect((await cards()).some((c) => c.id === ID)).toBe(true);
    // An invalid definition is never kept.
    const { link: bad } = licence({ status: 200, body: { connectors: [{ ...offer(2), definition: { ...definition(), url: "https://x" } }] } });
    await refreshPartnerConnectors(env.DB, bad);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM partner_connector_copies WHERE version = 2").first<{ n: number }>()).toEqual({ n: 0 });
  });

  it("adds one with its settings and its mapping live, making the look-up list it needs, or using the customer's own", async () => {
    await refreshPartnerConnectors(env.DB, licence({ status: 200, body: { connectors: [offer(1)] } }).link);
    const made = await add();
    expect(made.listsCreated).toEqual(["Business units"]);
    const list = await env.DB.prepare("SELECT id, description FROM lookup_lists WHERE name = 'Business units'").first<{ id: string; description: string }>();
    expect(list!.description).toBe("Needed by Oracle Payables");
    const row = await live(made.id);
    expect(row).toMatchObject({ version: 1, copied_from: `${ID}@1` });
    const def = JSON.parse(row!.definition_json) as OutboundMapping;
    expect(def.invoice.at(-1)!.fx[0].args).toEqual({ list: list!.id, otherwise: "refuse" });

    const got = (await handleGetConnector(env.DB, made.id, await connectorLibrary(env.DB))).body as Record<string, unknown>;
    expect(got.settings).toMatchObject({ method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" });
    expect(got.connector).toMatchObject({ id: ID, name: "Oracle Payables", publisher: "partner", partner: { name: "Northwind" }, version: 1, upgradeAvailable: false, offered: true, fixed: ["format"] });
    expect(got.lists).toEqual([{ name: "Business units", entries: 0, exists: true }]);

    // A second one uses the list now there.
    expect((await add("Oracle push 2")).listsCreated).toEqual([]);
    expect(await env.DB.prepare("SELECT count(*) AS n FROM lookup_lists").first<{ n: number }>()).toEqual({ n: 1 });

    // What it fixes holds, and only its sign-ins; the customer may still change the mapping.
    const lib = await connectorLibrary(env.DB);
    const save = (settings: Record<string, unknown>) => handleSaveConnector(env.DB, "u-dan", made.id, { settings: { url: "https://erp.acme.example/x", ...settings } }, KEY, lib);
    expect(await save({ format: "vf_json", auth: { type: "basic", username: "i" } })).toMatchObject({ status: 400, body: { reason: "fixed_setting" } });
    expect(await save({ format: "mapped", auth: { type: "bearer" } })).toMatchObject({ status: 400, body: { reason: "auth_not_allowed" } });
    expect(await save({ format: "mapped", auth: { type: "basic", username: "i" }, referencePath: "$.InvoiceId" })).toMatchObject({ status: 200 });
    expect(((await handleGetOutboundMapping(env.DB, made.id, lib)).body as { formatFixed: boolean }).formatFixed).toBe(false);
  });

  it("offers a later version as Upgrade, which brings its mapping while the customer's still follows it, and keeps the customer's own once changed", async () => {
    const { state, link } = licence({ status: 200, body: { connectors: [offer(1)] } });
    await refreshPartnerConnectors(env.DB, link);
    const made = await add();
    state.reply = { status: 200, body: { connectors: [offer(2, definition("Site"))] } };
    await refreshPartnerConnectors(env.DB, link);
    expect((await cards()).find((c) => c.id === ID)!.inUse).toMatchObject([{ upgradeAvailable: true }]);
    const routes = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { destinations: Array<{ id: string; connectorUpgrade: boolean }> };
    expect(routes.destinations.find((d) => d.id === made.id)!.connectorUpgrade).toBe(true);

    expect(await handleUpgradeConnector(env.DB, made.id, await connectorLibrary(env.DB), "u-dan")).toEqual({
      status: 200,
      body: { id: made.id, connectorId: ID, from: 1, to: 2, authChanged: false, mapping: "updated", listsCreated: [] },
    });
    const v2 = await live(made.id);
    expect(v2).toMatchObject({ version: 2, copied_from: `${ID}@2` });
    expect((JSON.parse(v2!.definition_json) as OutboundMapping).invoice.map((f) => f.target)).toContain("Site");

    // The customer publishes their own change; version 3 then leaves it alone.
    const own = JSON.parse(v2!.definition_json) as OutboundMapping;
    own.invoice.push({ target: "Ours", source: null, fixed: "1", fx: [] });
    await env.DB.prepare("UPDATE outbound_mapping_versions SET definition_json = ? WHERE instance_id = ? AND status = 'live'").bind(JSON.stringify(own), made.id).run();
    state.reply = { status: 200, body: { connectors: [offer(3, definition("Region"))] } };
    await refreshPartnerConnectors(env.DB, link);
    expect(await handleUpgradeConnector(env.DB, made.id, await connectorLibrary(env.DB), "u-dan")).toMatchObject({ status: 200, body: { to: 3, mapping: "kept" } });
    expect(JSON.parse((await live(made.id))!.definition_json)).toEqual(own);
  });

  it("when no longer offered, leaves the library unless in use, cannot be added, and its Destinations keep working from their copy", async () => {
    const { state, link } = licence({ status: 200, body: { connectors: [offer(1)] } });
    await refreshPartnerConnectors(env.DB, link);
    state.reply = { status: 200, body: { connectors: [] } };
    await refreshPartnerConnectors(env.DB, link);
    expect((await cards()).some((c) => c.id === ID)).toBe(false);
    expect(await handleCreateDestination(env.DB, "u-dan", "ap", { name: "X", connectorId: ID }, await connectorLibrary(env.DB))).toMatchObject({ status: 409, body: { reason: "not_available" } });

    state.reply = { status: 200, body: { connectors: [offer(1)] } };
    await refreshPartnerConnectors(env.DB, link);
    const made = await add();
    state.reply = { status: 200, body: { connectors: [] } };
    await refreshPartnerConnectors(env.DB, link);
    expect((await cards()).find((c) => c.id === ID)).toMatchObject({ status: "withdrawn", inUse: [{ upgradeAvailable: false }] });
    const got = (await handleGetConnector(env.DB, made.id, await connectorLibrary(env.DB))).body as { connector: Record<string, unknown> };
    expect(got.connector).toMatchObject({ id: ID, offered: false, fixed: ["format"] });
  });
});

describe("through the router", () => {
  it("asks the control plane when the library opens, and says when it could not", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-dan'").bind(await hashApiKey(key)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'Role', ?)").bind(JSON.stringify(["Admin.Configure"])).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-dan', 'r')").run();
    const { state, link } = licence({ status: 200, body: { connectors: [offer(1)] } });
    const e = { ...env, LICENCE_SERVICE: link.service, ENVIRONMENT_ID: "acme-prod", VF_LICENCE_API_KEY: "acme-key" } as unknown as Env;
    const open = async () => (await (await worker.fetch(new Request("https://vf.example/connector-library", { headers: { Authorization: `Bearer ${key}` } }), e)).json()) as { connectors: Card[]; partnerError?: string };
    const first = await open();
    expect(first.connectors.find((c) => c.id === ID)).toMatchObject({ name: "Oracle Payables", publisher: "partner" });
    expect(first.partnerError).toBeUndefined();
    state.reply = { status: 401, body: { error: "unauthorized" } };
    const second = await open();
    expect(second.partnerError).toBe("unauthorized");
    expect(second.connectors.some((c) => c.id === ID)).toBe(true);
    // Adding one through the router uses what was kept.
    const r = await worker.fetch(
      new Request("https://vf.example/processes/ap/destinations", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Oracle", connectorId: ID }) }),
      e
    );
    expect(r.status).toBe(201);
  });
});
