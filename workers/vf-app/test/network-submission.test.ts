import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { handleCreateSource, handleSetNetworkCompanies } from "../src/source-route.js";
import { handlePortalSubmission, handleSubmissionCompanies, isBis3Invoice } from "../src/network-submission.js";
import { handleProcessRoutes } from "../src/routes-route.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";

/**
 * **Invoice submission through the supplier network — decision 0726.**
 * The Supplier network in source; the company the supplier chose, the
 * supplier their invitation is for; a Peppol BIS Billing 3.0 invoice only.
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

const claims = (orgUnitIds = ["uk"]): PortalAccessClaims => ({
  kind: "portal_access",
  email: "jo@lager-nord.example",
  supplierOrgId: "so",
  linkId: "pl-1",
  environmentId: "test-environment",
  supplierId: "sup-ln",
  orgUnitIds,
  issuedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString(),
});

const BIS3 = (sellerVat = "DE123456789", number = "LN-500") => `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:CustomizationID>urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0</cbc:CustomizationID>
  <cbc:ProfileID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</cbc:ProfileID>
  <cbc:ID>${number}</cbc:ID>
  <cbc:IssueDate>2026-10-11</cbc:IssueDate>
  <cbc:InvoiceTypeCode>380</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>GBP</cbc:DocumentCurrencyCode>
  <cbc:BuyerReference>AP-UK</cbc:BuyerReference>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>${sellerVat}</cbc:CompanyID><cac:TaxScheme><cbc:ID>VAT</cbc:ID></cac:TaxScheme></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Lager Nord GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="GBP">120.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;

const NO_MODEL = { extract: async () => ({ ok: false, reason: "not needed" }) } as never;
const submit = (body: Record<string, unknown>, c = claims()) => handlePortalSubmission(env.DB, c, body, { model: NO_MODEL });

async function licensed() {
  const c = { customerId: "c", plan: "standard", features: ["supplier_portal"], volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(c), new Date().toISOString()).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await licensed();
  await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
  await handleCreateStage(env.DB, "ap", { id: "review", name: "Review", sequence: 1 });
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd'), ('ie', 'Acme Ireland Ltd')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name, parent_unit_id) VALUES ('uk-north', 'Acme UK North', 'uk')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE123456789'), ('sup-other', 'Other Ltd', 'GB111')").run();
});

const addSource = () => handleCreateSource(env.DB, "ap", { id: "network", name: "Supplier network", mechanism: "network" });

describe("the Supplier network in source", () => {
  it("is added to an invoice process like any source, once per process, and shows as what it is", async () => {
    const made = await addSource();
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ mechanism: "network" });
    const instance = await env.DB.prepare("SELECT route_id FROM route_instances WHERE source_id = 'network'").first<{ route_id: string }>();
    expect(instance?.route_id).toBe("network-in");
    expect((await handleCreateSource(env.DB, "ap", { id: "network-2", name: "Another", mechanism: "network" })).body).toMatchObject({ reason: "one_per_process" });
    const view = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { sources: { id: string; mechanism: string; networkOrgUnitIds: unknown }[] };
    expect(view.sources.find((s) => s.id === "network")).toMatchObject({ mechanism: "network", networkOrgUnitIds: null });
  });

  it("accepts every company until companies are ticked; a ticked company covers the units beneath it", async () => {
    await addSource();
    expect(((await handleSubmissionCompanies(env.DB, claims(["uk", "ie"]))).body as { companies: { id: string }[] }).companies.map((c) => c.id)).toEqual(["uk", "ie"]);
    expect((await handleSetNetworkCompanies(env.DB, "network", { orgUnitIds: ["uk"] })).status).toBe(200);
    expect(((await handleSubmissionCompanies(env.DB, claims(["uk", "ie"]))).body as { companies: { id: string }[] }).companies.map((c) => c.id)).toEqual(["uk"]);
    expect((await handleSetNetworkCompanies(env.DB, "network", { orgUnitIds: ["nowhere"] })).status).toBe(422);
  });

  it("offers nothing, and refuses, where the customer has not added one", async () => {
    expect(((await handleSubmissionCompanies(env.DB, claims())).body as { companies: unknown[] }).companies).toEqual([]);
    expect((await submit({ orgUnitId: "uk", xml: BIS3() })).body).toMatchObject({ reason: "not_accepting" });
  });
});

describe("sending an invoice", () => {
  it("arrives as a message of the source, in the chosen company, for the invitation's supplier", async () => {
    await addSource();
    const r = await submit({ orgUnitId: "uk-north", filename: "LN-500.xml", xml: BIS3() });
    expect(r.status).toBe(202);
    const { message, invoiceId } = r.body as { message: string; invoiceId: string };
    expect(message).toMatch(/^MSG-/);
    const m = await env.DB.prepare("SELECT instance_id, counterparty, status FROM route_messages WHERE id = ?").bind(message).first<Record<string, string>>();
    expect(m).toMatchObject({ instance_id: "network", counterparty: "jo@lager-nord.example", status: "delivered" });
    const h = await env.DB.prepare("SELECT org_unit_id, supplier_id, facts_json FROM invoice_headers WHERE id = ?").bind(invoiceId).first<{ org_unit_id: string; supplier_id: string; facts_json: string }>();
    expect(h).toMatchObject({ org_unit_id: "uk-north", supplier_id: "sup-ln" });
    expect(JSON.parse(h!.facts_json)).toMatchObject({ "intake.network": true, "supplier.networkVatDiffers": false, "BT-1": "LN-500" });
  });

  it("keeps the invitation's supplier when the document names another's VAT number, and flags it", async () => {
    await addSource();
    const r = await submit({ orgUnitId: "uk", xml: BIS3("GB111") });
    const h = await env.DB.prepare("SELECT supplier_id, facts_json FROM invoice_headers WHERE id = ?").bind((r.body as { invoiceId: string }).invoiceId).first<{ supplier_id: string; facts_json: string }>();
    expect(h?.supplier_id).toBe("sup-ln");
    expect(JSON.parse(h!.facts_json)["supplier.networkVatDiffers"]).toBe(true);
  });

  it("refuses a company the invitation does not cover, and anything but a Peppol BIS Billing 3.0 invoice", async () => {
    await addSource();
    expect((await submit({ orgUnitId: "ie", xml: BIS3() })).body).toMatchObject({ reason: "not_covered" });
    expect((await submit({ orgUnitId: "uk", xml: "<Invoice/>" })).body).toMatchObject({ reason: "not_bis3" });
    expect((await submit({ orgUnitId: "uk", xml: "" })).status).toBe(400);
    expect(isBis3Invoice(BIS3())).toBe(true);
    expect(isBis3Invoice(BIS3().replace("billing:3.0", "billing:2.0"))).toBe(false);
  });

  it("is reached only with a portal token, and a staff session is no use there", async () => {
    await addSource();
    expect((await SELF.fetch("https://app.example.com/portal/submission-companies")).status).toBe(401);
    const token = await signPortalToken(claims(), PRIVATE_KEY);
    const companies = await SELF.fetch("https://app.example.com/portal/submission-companies", { headers: { Authorization: `Bearer ${token}` } });
    expect(companies.status).toBe(200);
    expect(((await companies.json()) as { companies: { id: string }[] }).companies.map((c) => c.id)).toEqual(["uk"]);
  });
});
