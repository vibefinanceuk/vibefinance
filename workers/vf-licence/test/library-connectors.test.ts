import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { hashApiKey } from "../src/auth.js";
import { PARTNER_CONNECTOR_SCHEMA, standardOutboundMapping, type PartnerConnectorDefinition } from "@vibefinance/shared";
import { libraryConnectorsFor, submitPartnerConnector, withdrawPartnerConnector } from "../src/partner-connectors.js";
import { reviewVersion, suspendConnector } from "../src/connector-review.js";
import { handleCreatePartner, handlePartnerCustomer, handlePartnerPerson, handleSuspendPartner } from "../src/partners-route.js";

/**
 * **Partner connectors in the Route library — decision 0601.** What the
 * control plane offers each customer: the latest approved version of each
 * connector of an active partner that serves it, for an audience it is in.
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
const submit = (extra: Record<string, unknown> = {}) =>
  submitPartnerConnector(db(), "acme-prod", {
    instanceId: "dest-1",
    submittedBy: ANA,
    name: "Oracle Payables",
    description: "Creates the invoice in Oracle Payables.",
    audience: "all",
    definition: definition(),
    ...extra,
  });
const offered = async (environmentId: string) =>
  ((await libraryConnectorsFor(db(), environmentId)).body as { connectors: Array<{ name: string; version: number; partner: { name: string } }> }).connectors;

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd'), ('globex', 'Globex plc'), ('other', 'Other Co')").run();
  await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
  await db()
    .prepare(
      `INSERT INTO environments (id, customer_id, kind, region, instance_url, api_key_hash) VALUES
       ('nw-sbx', 'partner-northwind', 'sandbox', 'eu', 'https://nw.example', ?),
       ('acme-prod', 'acme', 'production', 'eu', 'https://acme.example', ?),
       ('globex-prod', 'globex', 'production', 'eu', 'https://globex.example', ?),
       ('other-prod', 'other', 'production', 'eu', 'https://other.example', ?)`
    )
    .bind(await hashApiKey("nw-key"), await hashApiKey("acme-key"), await hashApiKey("globex-key"), await hashApiKey("other-key"))
    .run();
  await handlePartnerPerson(db(), OP, "northwind", "POST", { email: ANA });
  await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "acme" });
  await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "globex" });
});

describe("what the Route library offers each customer — decision 0601", () => {
  it("offers nothing until VibeFinance approves it, then the approved version to the customers the partner serves, and its sandbox", async () => {
    const made = (await submit()).body as { connectorId: string };
    expect(await offered("acme-prod")).toEqual([]);
    await reviewVersion(db(), OP, made.connectorId, 1, "approve", {});
    const acme = (await libraryConnectorsFor(db(), "acme-prod")).body as { connectors: Array<Record<string, unknown>> };
    expect(acme.connectors).toEqual([
      expect.objectContaining({ connectorId: made.connectorId, version: 1, name: "Oracle Payables", partner: { id: "northwind", name: "Northwind" }, definition: definition() }),
    ]);
    expect((await offered("globex-prod")).map((c) => c.name)).toEqual(["Oracle Payables"]);
    expect((await offered("nw-sbx")).map((c) => c.name)).toEqual(["Oracle Payables"]);
    expect(await offered("other-prod")).toEqual([]);
  });

  it("offers the latest approved version, never one waiting or sent back, and only to its audience", async () => {
    const id = ((await submit()).body as { connectorId: string }).connectorId;
    await reviewVersion(db(), OP, id, 1, "approve", {});
    await submit({ name: "Oracle Payables", audience: ["acme"] });
    expect((await offered("acme-prod")).map((c) => c.version)).toEqual([1]);
    await reviewVersion(db(), OP, id, 2, "return", { reason: "Not yet" });
    expect((await offered("acme-prod")).map((c) => c.version)).toEqual([1]);
    await submit({ audience: ["acme"] });
    await reviewVersion(db(), OP, id, 3, "approve", {});
    // Version 3 is for Acme only: Globex keeps being offered version 1.
    expect((await offered("acme-prod")).map((c) => c.version)).toEqual([3]);
    expect((await offered("globex-prod")).map((c) => c.version)).toEqual([1]);
    expect(await withdrawPartnerConnector(db(), "acme-prod", { instanceId: "dest-1", version: 3, submittedBy: ANA })).toMatchObject({ status: 409 });
  });

  it("stops offering it when the connector or partner is suspended, or the customer unlinked", async () => {
    const id = ((await submit()).body as { connectorId: string }).connectorId;
    await reviewVersion(db(), OP, id, 1, "approve", {});
    await suspendConnector(db(), OP, id, true, { reason: "Looking into a fault" });
    expect(await offered("acme-prod")).toEqual([]);
    await suspendConnector(db(), OP, id, false, {});
    expect(await offered("acme-prod")).toHaveLength(1);
    await handleSuspendPartner(db(), OP, "northwind", true, { reason: "Review" });
    expect(await offered("acme-prod")).toEqual([]);
    await handleSuspendPartner(db(), OP, "northwind", false, {});
    await handlePartnerCustomer(db(), OP, "northwind", "DELETE", { customerId: "globex" });
    expect(await offered("globex-prod")).toEqual([]);
    expect(await offered("acme-prod")).toHaveLength(1);
  });

  it("answers an environment with its own key only", async () => {
    const id = ((await submit()).body as { connectorId: string }).connectorId;
    await reviewVersion(db(), OP, id, 1, "approve", {});
    const call = (path: string, key: string) => SELF.fetch(`https://licence.example.com${path}`, { headers: { Authorization: `Bearer ${key}` } });
    expect((await call("/environments/acme-prod/library-connectors", "globex-key")).status).toBe(401);
    const r = await call("/environments/acme-prod/library-connectors", "acme-key");
    expect(r.status).toBe(200);
    expect(((await r.json()) as { connectors: unknown[] }).connectors).toHaveLength(1);
  });
});
