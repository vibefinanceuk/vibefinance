import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { hashApiKey } from "../src/auth.js";
import { PARTNER_CONNECTOR_SCHEMA, standardOutboundMapping, type PartnerConnectorDefinition } from "@vibefinance/shared";
import { partnerConnectorState, submitPartnerConnector, withdrawPartnerConnector } from "../src/partner-connectors.js";
import { handleCreatePartner, handlePartnerCustomer, handlePartnerPerson, handleSuspendPartner } from "../src/partners-route.js";

/**
 * **A partner submits a connector — decision 0595.** From its sandbox,
 * by one of its people, for VibeFinance's review.
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
const submission = (extra: Record<string, unknown> = {}) => ({
  instanceId: "dest-1",
  submittedBy: ANA,
  name: "Oracle Fusion Payables (Northwind)",
  description: "Creates the invoice in Oracle Payables with its lines and distributions.",
  notes: "First version.",
  audience: "all",
  definition: definition(),
  ...extra,
});

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd'), ('globex', 'Globex plc'), ('other', 'Other Co')").run();
  await handleCreatePartner(db(), OP, { id: "northwind", name: "Northwind" });
  await db()
    .prepare("INSERT INTO environments (id, customer_id, kind, region, instance_url, api_key_hash) VALUES ('nw-sbx', 'partner-northwind', 'sandbox', 'eu', 'https://nw.example', ?), ('acme-prod', 'acme', 'production', 'eu', 'https://acme.example', ?)")
    .bind(await hashApiKey("nw-key"), await hashApiKey("acme-key"))
    .run();
  await handlePartnerPerson(db(), OP, "northwind", "POST", { email: ANA });
  await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "acme" });
  await handlePartnerCustomer(db(), OP, "northwind", "POST", { customerId: "globex" });
});

describe("submitting a connector — decision 0595", () => {
  it("says whether an environment is a partner's sandbox, who it serves, and whether this person may submit", async () => {
    expect((await partnerConnectorState(db(), "acme-prod", "dest-1", "x@acme.example")).body).toEqual({ partner: null });
    expect((await partnerConnectorState(db(), "nw-sbx", "dest-1", ANA)).body).toEqual({
      partner: { id: "northwind", name: "Northwind", status: "active" },
      customers: [
        { id: "acme", name: "Acme Ltd" },
        { id: "globex", name: "Globex plc" },
      ],
      canSubmit: true,
      connector: null,
    });
    expect(((await partnerConnectorState(db(), "nw-sbx", "dest-1", "someone@else.example")).body as { canSubmit: boolean }).canSubmit).toBe(false);
  });

  it("makes version 1, waiting for review, and the next version from the same Destination once that is decided", async () => {
    expect(await submitPartnerConnector(db(), "nw-sbx", submission())).toMatchObject({ status: 201, body: { version: 1, status: "submitted" } });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission())).toMatchObject({ status: 409, body: { reason: "already_waiting" } });
    const state = (await partnerConnectorState(db(), "nw-sbx", "dest-1", ANA)).body as { connector: { versions: Array<Record<string, unknown>> } };
    expect(state.connector.versions).toEqual([
      expect.objectContaining({ version: 1, status: "submitted", name: "Oracle Fusion Payables (Northwind)", audience: "all", submittedBy: ANA, notes: "First version." }),
    ]);
    const stored = await db().prepare("SELECT definition_json FROM partner_connector_versions").first<{ definition_json: string }>();
    expect(JSON.parse(stored!.definition_json)).toEqual(definition());

    expect(await withdrawPartnerConnector(db(), "nw-sbx", { instanceId: "dest-1", version: 1, submittedBy: ANA })).toEqual({ status: 200, body: { version: 1, status: "withdrawn" } });
    expect(await withdrawPartnerConnector(db(), "nw-sbx", { instanceId: "dest-1", version: 1, submittedBy: ANA })).toMatchObject({ status: 409 });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ audience: ["acme"], name: "Oracle Payables" }))).toMatchObject({ status: 201, body: { version: 2 } });
    const after = (await partnerConnectorState(db(), "nw-sbx", "dest-1", ANA)).body as { connector: { name: string; versions: Array<{ version: number; status: string; audience: unknown }> } };
    expect(after.connector.name).toBe("Oracle Payables");
    expect(after.connector.versions.map((v) => [v.version, v.status, v.audience])).toEqual([
      [2, "submitted", ["acme"]],
      [1, "withdrawn", "all"],
    ]);
  });

  it("refuses a customer's environment, someone not the partner's, a suspended partner, an unlinked audience, and what a connector cannot carry", async () => {
    expect(await submitPartnerConnector(db(), "acme-prod", submission())).toMatchObject({ status: 403, body: { reason: "not_partner_sandbox" } });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ submittedBy: "eve@elsewhere.example" }))).toMatchObject({ status: 403, body: { reason: "not_partner_person" } });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ audience: ["other"] }))).toMatchObject({ status: 422, body: { reason: "not_linked" } });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ audience: [] }))).toMatchObject({ status: 400, body: { reason: "no_audience" } });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ description: "" }))).toMatchObject({ status: 400, body: { reason: "bad_description" } });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ definition: { ...definition(), url: "https://erp.example" } }))).toMatchObject({
      status: 422,
      body: { reason: "invalid_definition", error: "a connector does not carry url" },
    });
    await submitPartnerConnector(db(), "nw-sbx", submission());
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ instanceId: "dest-2" }))).toMatchObject({ status: 409, body: { reason: "connector_name_taken" } });
    await handleSuspendPartner(db(), OP, "northwind", true, { reason: "Review" });
    expect(await submitPartnerConnector(db(), "nw-sbx", submission({ instanceId: "dest-3", name: "Other" }))).toMatchObject({ status: 403, body: { reason: "partner_suspended" } });
  });
});

describe("through the router", () => {
  it("takes the sandbox's own key only", async () => {
    const call = (path: string, key: string, body?: unknown) =>
      SELF.fetch(`https://licence.example.com${path}`, {
        method: body ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    expect((await call("/environments/nw-sbx/partner-connectors", "acme-key", submission())).status).toBe(401);
    expect((await call("/environments/nw-sbx/partner-connectors", "nw-key", submission())).status).toBe(201);
    const state = (await (await call(`/environments/nw-sbx/partner-connectors?instanceId=dest-1&email=${encodeURIComponent(ANA)}`, "nw-key")).json()) as { canSubmit: boolean; connector: { versions: unknown[] } };
    expect(state.canSubmit).toBe(true);
    expect(state.connector.versions).toHaveLength(1);
    expect((await call("/environments/nw-sbx/partner-connectors/withdraw", "nw-key", { instanceId: "dest-1", version: 1, submittedBy: ANA })).status).toBe(200);
  });
});
