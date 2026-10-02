import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker, { isPrivileged } from "../src/index.js";
import type { Env } from "../src/index.js";
import { hashApiKey } from "../src/auth.js";
import { PARTNER_CONNECTOR_SCHEMA, standardOutboundMapping, type PartnerConnectorDefinition } from "@vibefinance/shared";
import { partnerConnectorState, submitPartnerConnector } from "../src/partner-connectors.js";
import { listPartnerConnectors, reviewVersion, suspendConnector } from "../src/connector-review.js";
import { handleCreatePartner, handlePartnerCustomer, handlePartnerPerson } from "../src/partners-route.js";

/**
 * **Reviewing partners' connectors — decision 0600.** The queue, approve,
 * send back with a reason, suspend and reinstate.
 */

const db = () => env.CONTROL_DB;
const OP = "dan@vibefinance.example";
const ANA = "ana@northwind.example";
const definition = (): PartnerConnectorDefinition => ({
  schema: PARTNER_CONNECTOR_SCHEMA,
  direction: "destination",
  routeId: "https-out",
  transport: "https",
  settings: { defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" }, fixed: ["format"], authTypes: ["basic"] },
  outboundMapping: standardOutboundMapping(),
  lookupLists: [],
  vendorDocs: null,
});
const submit = (instanceId: string, env_ = "acme-prod", extra: Record<string, unknown> = {}) =>
  submitPartnerConnector(db(), env_, { instanceId, submittedBy: ANA, name: `Oracle ${instanceId}`, description: "Creates the invoice.", notes: "Tried on INV-A.", audience: ["acme"], definition: definition(), ...extra });

type Listed = { versions: Array<Record<string, any>> };

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd'), ('globex', 'Globex plc')").run();
  await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
  await db()
    .prepare("INSERT INTO environments (id, customer_id, kind, region, instance_url, api_key_hash) VALUES ('nw-sbx', 'partner-northwind', 'sandbox', 'eu', 'https://nw.example', ?), ('acme-prod', 'acme', 'production', 'eu', 'https://acme.example', NULL)")
    .bind(await hashApiKey("nw-key"))
    .run();
  await handlePartnerPerson(db(), OP, "northwind", "POST", { email: ANA });
  await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "acme" });
});

describe("the review queue — decision 0600", () => {
  it("lists what waits, oldest first, with everything a decision rests on", async () => {
    await submit("dest-1");
    await submit("dest-2", "nw-sbx", { audience: "all" });
    const queue = ((await listPartnerConnectors(db(), "submitted")).body as Listed).versions;
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({
      version: 1,
      status: "submitted",
      name: "Oracle dest-1",
      description: "Creates the invoice.",
      notes: "Tried on INV-A.",
      audience: [{ id: "acme", name: "Acme Ltd" }],
      submittedBy: ANA,
      partner: { id: "northwind", name: "Northwind", status: "active" },
      connector: { status: "active", suspendedReason: null },
      source: { environmentId: "acme-prod", kind: "production", customerId: "acme", customerName: "Acme Ltd", sandbox: false },
      definition: definition(),
    });
    expect(queue[1]).toMatchObject({ audience: "all", source: { customerId: "partner-northwind", sandbox: true } });
  });

  it("approves, or sends back with a reason the partner sees; only what waits", async () => {
    const one = (await submit("dest-1")).body as { connectorId: string };
    expect(await reviewVersion(db(), OP, one.connectorId, 1, "return", {})).toMatchObject({ status: 400, body: { reason: "no_reason" } });
    expect(await reviewVersion(db(), OP, one.connectorId, 1, "return", { reason: "Add the supplier site." })).toEqual({ status: 200, body: { connectorId: one.connectorId, version: 1, status: "returned" } });
    expect(await reviewVersion(db(), OP, one.connectorId, 1, "approve", {})).toMatchObject({ status: 409, body: { reason: "not_waiting" } });
    const state = (await partnerConnectorState(db(), "acme-prod", "dest-1", ANA)).body as { connector: { versions: Array<Record<string, unknown>> } };
    expect(state.connector.versions[0]).toMatchObject({ version: 1, status: "returned", reviewReason: "Add the supplier site." });

    await submit("dest-1");
    expect(await reviewVersion(db(), OP, one.connectorId, 2, "approve", {})).toMatchObject({ status: 200, body: { status: "approved" } });
    const row = await db().prepare("SELECT reviewed_by, reviewed_at FROM partner_connector_versions WHERE version = 2").first<{ reviewed_by: string; reviewed_at: string }>();
    expect(row!.reviewed_by).toBe(OP);
    expect(((await listPartnerConnectors(db(), "submitted")).body as Listed).versions).toEqual([]);
    expect(await reviewVersion(db(), OP, "nope", 1, "approve", {})).toMatchObject({ status: 404 });
  });

  it("suspends a connector with a reason, which the partner sees and which stops new versions, and reinstates it", async () => {
    const one = (await submit("dest-1")).body as { connectorId: string };
    expect(await suspendConnector(db(), OP, one.connectorId, true, {})).toMatchObject({ status: 400, body: { reason: "no_reason" } });
    expect(await suspendConnector(db(), OP, one.connectorId, true, { reason: "Posts to the wrong endpoint" })).toEqual({ status: 200, body: { connectorId: one.connectorId, status: "suspended" } });
    const state = (await partnerConnectorState(db(), "acme-prod", "dest-1", ANA)).body as { connector: Record<string, unknown> };
    expect(state.connector).toMatchObject({ status: "suspended", suspendedReason: "Posts to the wrong endpoint" });
    await reviewVersion(db(), OP, one.connectorId, 1, "return", { reason: "x" });
    expect(await submit("dest-1")).toMatchObject({ status: 403, body: { reason: "connector_suspended" } });
    expect(((await listPartnerConnectors(db(), null)).body as Listed).versions[0].connector).toEqual({ status: "suspended", suspendedReason: "Posts to the wrong endpoint" });
    expect(await suspendConnector(db(), OP, one.connectorId, false, {})).toEqual({ status: 200, body: { connectorId: one.connectorId, status: "active" } });
    expect(await submit("dest-1")).toMatchObject({ status: 201 });
  });
});

describe("through the router", () => {
  it("is the operator's alone, and attributed to the operator Access verified", async () => {
    for (const [m, p] of [["GET", "/partner-connectors"], ["POST", "/partner-connectors/c1/versions/2/approve"], ["POST", "/partner-connectors/c1/versions/2/return"], ["POST", "/partner-connectors/c1/suspend"], ["POST", "/partner-connectors/c1/reinstate"]]) {
      expect(isPrivileged(m, p), p).toBe(true);
    }
    expect((await SELF.fetch("https://licence.example.com/partner-connectors", { headers: { Authorization: "Bearer x" } })).status).toBe(401);
    const one = (await submit("dest-1")).body as { connectorId: string };
    const key = "k".repeat(48);
    const call = (path: string, body?: unknown) =>
      worker.fetch(
        new Request(`https://licence.example.com${path}`, {
          method: body ? "POST" : "GET",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "Cf-Access-Authenticated-User-Email": OP },
          ...(body ? { body: JSON.stringify(body) } : {}),
        }),
        { ...env, ADMIN_API_KEY: key } as unknown as Env
      );
    expect(((await (await call("/partner-connectors?status=submitted")).json()) as Listed).versions).toHaveLength(1);
    expect((await call(`/partner-connectors/${one.connectorId}/versions/1/approve`, {})).status).toBe(200);
    expect(await db().prepare("SELECT reviewed_by FROM partner_connector_versions").first()).toEqual({ reviewed_by: OP });
  });
});
