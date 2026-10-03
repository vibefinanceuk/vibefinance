import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { STANDARD_CONNECTORS, type ConnectorDefinition } from "@vibefinance/shared";
import { handleConnectorLibrary } from "../src/connector-library-route.js";
import { handleCreateDestination, handleGetConnector, handleSaveConnector, handleUpgradeConnector } from "../src/destination-delivery.js";
import { handleProcessRoutes } from "../src/routes-route.js";

/**
 * **The Route library — decision 0589.** Connectors as definitions: the
 * library lists them with where each is in use; a Destination is made
 * from one, with its defaults and what it fixes; a later version is
 * offered as an upgrade that keeps the customer's own settings.
 */

const KEY = btoa("k".repeat(32));

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP'), ('exp', 'Expenses')").run();
  await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism) VALUES ('mail', 'ap', 'AP mailbox', 'email')").run();
  await env.DB.prepare(
    "INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('mail', 'email-in', 'ap', 'mail')"
  ).run();
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-ap', 'erp-csv', 'ap', 'ERP', 'active')").run();
});

type Listed = { connectors: Array<{ id: string; status: string; direction: string; inUse: Array<Record<string, unknown>> }>; processes: Array<{ id: string }> };

describe("the library", () => {
  it("lists every standard connector, Sources and Destinations, with where each is in use", async () => {
    const body = (await handleConnectorLibrary(env.DB)).body as Listed;
    expect(body.connectors.map((c) => c.id)).toEqual(STANDARD_CONNECTORS.map((c) => c.id));
    const by = (id: string) => body.connectors.find((c) => c.id === id)!;
    expect(by("https-out")).toMatchObject({ direction: "destination", status: "available", inUse: [] });
    // Decision 0621: SFTP out is planned again until the container runs.
    expect(by("sftp-out")).toMatchObject({ status: "planned", inUse: [] });
    expect(by("sftp-in")).toMatchObject({ status: "planned", inUse: [] });
    expect(by("edi-in")).toMatchObject({ status: "planned", inUse: [] });
    // Decision 0605: Oracle is available, as a first version.
    expect(by("oracle-fusion-payables")).toMatchObject({ status: "available", inUse: [] });
    // Made before the library: the route's own connector, version 1.
    expect(by("erp-csv").inUse).toEqual([{ instanceId: "erp-ap", processId: "ap", processName: "Standard AP", name: "ERP", version: 1, upgradeAvailable: false }]);
    expect(by("email-in").inUse).toMatchObject([{ instanceId: "mail", name: "AP mailbox" }]);
    expect(body.processes.map((p) => p.id)).toEqual(["exp", "ap"]);
  });
});

describe("adding a Destination from a connector", () => {
  it("fills in the connector's defaults, records it and its version, and shows it in use", async () => {
    const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Zapier", connectorId: "automation-webhook" });
    expect(made).toMatchObject({ status: 201, body: { routeId: "https-out", connectorId: "automation-webhook", status: "paused" } });
    const id = (made.body as { id: string }).id;
    const row = await env.DB.prepare("SELECT connector_id, connector_version, settings_json FROM route_instances WHERE id = ?").bind(id).first<{ connector_id: string; connector_version: number; settings_json: string }>();
    expect(row).toMatchObject({ connector_id: "automation-webhook", connector_version: 1 });
    expect(JSON.parse(row!.settings_json)).toMatchObject({ method: "POST", format: "vf_json", auth: { type: "none" } });
    const got = (await handleGetConnector(env.DB, id)).body as { connector: Record<string, unknown> };
    expect(got.connector).toEqual({ id: "automation-webhook", version: 1, name: null, publisher: "standard", partner: null, offered: true, maturity: null, asks: null, latestVersion: 1, upgradeAvailable: false, fixed: ["method", "format"], authTypes: ["none", "api_key_header"] });
    const listed = (await handleConnectorLibrary(env.DB)).body as Listed;
    expect(listed.connectors.find((c) => c.id === "automation-webhook")!.inUse).toMatchObject([{ instanceId: id, name: "Zapier" }]);
    const flow = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { destinations: Array<Record<string, unknown>> };
    expect(flow.destinations.find((d) => d.id === id)).toMatchObject({ connectorId: "automation-webhook", connectorUpgrade: false });
  });

  it("keeps what the connector fixes, and allows only its ways of signing in", async () => {
    const id = ((await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Zapier", connectorId: "automation-webhook" })).body as { id: string }).id;
    const save = (settings: Record<string, unknown>) => handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://hooks.zapier.com/x", ...settings } }, KEY);
    expect((await save({ format: "csv" })).body).toMatchObject({ reason: "fixed_setting" });
    expect((await save({ method: "PUT" })).body).toMatchObject({ reason: "fixed_setting" });
    expect((await save({ auth: { type: "basic", username: "x" } })).body).toMatchObject({ reason: "auth_not_allowed" });
    expect((await save({ auth: { type: "api_key_header", header: "X-Key" } })).status).toBe(200);
    // The generic connector fixes nothing.
    const generic = ((await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Push" })).body as { id: string }).id;
    expect((await handleSaveConnector(env.DB, "u-dan", generic, { settings: { url: "https://erp.example/x", format: "csv", method: "PUT" } }, KEY)).status).toBe(200);
  });

  it("refuses a planned connector, a Source, an unknown one, and a second ERP CSV file; adds the file where none is", async () => {
    const add = (connectorId: string, processId = "ap", name = "X") => handleCreateDestination(env.DB, "u-dan", processId, { name, connectorId });
    // Decision 0621: SFTP out is planned again, and refused.
    expect((await add("sftp-out")).body).toMatchObject({ reason: "not_available" });
    expect((await add("email-in")).body).toMatchObject({ reason: "unknown_connector" });
    expect((await add("nope")).body).toMatchObject({ reason: "unknown_connector" });
    expect((await add("erp-csv")).body).toMatchObject({ reason: "one_per_process" });
    const file = await add("erp-csv", "exp", "ERP");
    expect(file).toMatchObject({ status: 201, body: { id: "erp-exp", routeId: "erp-csv", status: "active" } });
  });
});

describe("upgrading", () => {
  const v2: ConnectorDefinition[] = STANDARD_CONNECTORS.map((c) =>
    c.id === "automation-webhook"
      ? { ...c, version: 2, settings: { defaults: { method: "POST", format: "vf_json", auth: { type: "bearer" } }, fixed: ["method", "format"], authTypes: ["none", "bearer"] } }
      : c
  );

  it("offers a later version, applies what it fixes and keeps the customer's own settings, saying when sign-in had to change", async () => {
    const id = ((await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Zapier", connectorId: "automation-webhook" })).body as { id: string }).id;
    await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://hooks.zapier.com/x", referencePath: "$.id", auth: { type: "api_key_header", header: "X-Key" } } }, KEY);
    await env.DB.prepare("UPDATE route_instances SET unit_ids = '[\"de\"]' WHERE id = ?").bind(id).run();
    const listed = (await handleConnectorLibrary(env.DB, v2)).body as Listed;
    expect(listed.connectors.find((c) => c.id === "automation-webhook")!.inUse[0]).toMatchObject({ version: 1, upgradeAvailable: true });

    const up = await handleUpgradeConnector(env.DB, id, v2);
    expect(up).toMatchObject({ status: 200, body: { from: 1, to: 2, authChanged: true } });
    const row = await env.DB.prepare("SELECT connector_version, settings_json, unit_ids FROM route_instances WHERE id = ?").bind(id).first<{ connector_version: number; settings_json: string; unit_ids: string }>();
    expect(row!.connector_version).toBe(2);
    expect(JSON.parse(row!.settings_json)).toMatchObject({ url: "https://hooks.zapier.com/x", referencePath: "$.id", auth: { type: "bearer" } });
    expect(row!.unit_ids).toBe('["de"]');
    expect((await handleUpgradeConnector(env.DB, id, v2)).body).toMatchObject({ reason: "up_to_date" });
  });
});
