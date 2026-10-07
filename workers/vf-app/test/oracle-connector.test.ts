import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { handleConnectorLibrary } from "../src/connector-library-route.js";
import { handleCreateDestination, handleGetConnector, handlePreviewDelivery, handleSaveConnector, handleSendNow, type DeliveryDeps } from "../src/destination-delivery.js";
import { handleGetOutboundMapping, handleSaveOutboundMapping, handleTryOutboundMapping } from "../src/outbound-mapping-route.js";
import { connectorLibrary } from "../src/partner-library.js";
import type { OutboundMapping } from "@vibefinance/shared";

/**
 * **Oracle Fusion Payables — decision 0605.** Added from the Route
 * library with its mapping and look-up lists, it posts each invoice in
 * the shape of Oracle's documented examples to a simulated Oracle, signed
 * in, and keeps Oracle's InvoiceId.
 */

const KEY = btoa("k".repeat(32));
const ORACLE = "https://acme-test.fa.em2.oraclecloud.com/fscmRestApi/resources/11.13.18.05/invoices";

/** A simulated Oracle: answers 201 with the invoice and its InvoiceId, or a 400 in Oracle's plain-text way. */
function oracle(reply: { status: number; body: unknown }) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string>, body: String(init.body ?? "") });
    const body = typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body);
    return new Response(body, { status: reply.status, headers: { "Content-Type": typeof reply.body === "string" ? "text/plain" : "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const deps = (fetcher: typeof fetch): DeliveryDeps => ({ secretsKey: KEY, bucket: env.DOCUMENTS, customerId: "acme", fetcher });

async function fill(list: string, entries: Array<[string, string]>) {
  const row = await env.DB.prepare("SELECT id FROM lookup_lists WHERE name = ?").bind(list).first<{ id: string }>();
  for (const [from, to] of entries) {
    await env.DB.prepare("INSERT INTO lookup_entries (list_id, key, from_value, to_value) VALUES (?, ?, ?, ?)").bind(row!.id, from.trim().toLowerCase(), from, to).run();
  }
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.example', 'Dan Young')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await seedStage("ap-intake", "ap", "Intake", 1);
  await seedStage("ap-eligible", "ap", "Payment Eligible", 2);
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-uk', 'Acme UK')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, erp_identifier, erp_site_identifier) VALUES ('sup-1', 'Advanced Network Devices', '1013', 'FRESNO')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id) VALUES ('inv-a', json_set(?1, '$.BT-1', 'AND-1'), 'sup-1', 'acme-uk')")
    .bind(JSON.stringify({ "BT-1": "AND-1", "BT-2": "2026-09-29", "BT-5": "GBP", "BT-112": 240, "BT-109": 200, "BT-110": 40 }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-a', 1, ?), ('inv-a', 2, ?)")
    .bind(
      JSON.stringify({ "BT-153": "Office supplies", "BT-131": 150, "BT-129": 3, "BT-151": "S", "coding.gl_code": "7110", "BT-133": "100" }),
      JSON.stringify({ "BT-153": "Delivery", "BT-131": 50, "BT-129": 1, "BT-151": "S", "coding.gl_code": "7640", "BT-133": "100" })
    )
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-a', 'ap', 'invoice', 'inv-a', 'ap-eligible', 'in_progress')").run();
});

async function addOracle() {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Oracle Payables", connectorId: "oracle-fusion-payables" }, await connectorLibrary(env.DB));
  expect(made.status).toBe(201);
  return made.body as { id: string; listsCreated: string[] };
}

describe("Oracle Fusion Payables — decision 0605", () => {
  it("is in the Route library, available as a first version", async () => {
    const lib = (await handleConnectorLibrary(env.DB, await connectorLibrary(env.DB))).body as { connectors: Array<Record<string, unknown>> };
    expect(lib.connectors.find((c) => c.id === "oracle-fusion-payables")).toMatchObject({
      status: "available",
      maturity: "first_version",
      lookupLists: ["Oracle business units", "Oracle company segments", "Oracle tax classifications"],
    });
  });

  it("is added with its settings, its mapping live, and its three look-up lists made for the customer to fill in", async () => {
    const made = await addOracle();
    expect([...made.listsCreated].sort()).toEqual(["Oracle business units", "Oracle company segments", "Oracle tax classifications"]);
    const got = (await handleGetConnector(env.DB, made.id, await connectorLibrary(env.DB))).body as Record<string, unknown>;
    expect(got.settings).toMatchObject({ method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" });
    expect(got.connector).toMatchObject({ id: "oracle-fusion-payables", publisher: "standard", fixed: ["method", "format"], authTypes: ["basic", "oauth2_client_credentials"] });
    expect(got.lists).toEqual([
      { name: "Oracle business units", entries: 0, exists: true },
      { name: "Oracle company segments", entries: 0, exists: true },
      { name: "Oracle tax classifications", entries: 0, exists: true },
    ]);
    // The mapping is the customer's own to adjust: the account pattern names their list by id.
    const m = (await handleGetOutboundMapping(env.DB, made.id, await connectorLibrary(env.DB))).body as { formatFixed: boolean; editing: { status: string; definition: OutboundMapping } };
    expect(m.formatFixed).toBe(false);
    expect(m.editing.status).toBe("live");
    const segments = await env.DB.prepare("SELECT id FROM lookup_lists WHERE name = 'Oracle company segments'").first<{ id: string }>();
    expect(m.editing.definition.distributions.fields.find((f) => f.target === "DistributionCombination")!.built).toBe(`{company|${segments!.id}}-{distribution.costCentre}-{distribution.glCode}-0000-000`);
  });

  it("says what the lists still need before anything is sent, then posts the invoice as Oracle's examples show and keeps the InvoiceId", async () => {
    const { id } = await addOracle();
    expect(
      (await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: ORACLE, method: "POST", format: "mapped", auth: { type: "basic", username: "AP.INTEGRATION" }, referencePath: "$.InvoiceId" }, secret: "fusion-pw" }, KEY, await connectorLibrary(env.DB))).status
    ).toBe(200);
    const tried = (await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" })).body as { problems: Array<{ at: string; reason: string }> };
    expect(tried.problems.map((p) => p.reason)).toEqual(
      expect.arrayContaining(['"acme-uk" is not in the list Oracle business units', '"S" is not in the list Oracle tax classifications', '"acme-uk" is not in the list Oracle company segments'])
    );

    await fill("Oracle business units", [["acme-uk", "Vision Operations"]]);
    await fill("Oracle company segments", [["acme-uk", "01"]]);
    await fill("Oracle tax classifications", [["S", "VAT STD"]]);
    const preview = (await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { body?: string; problems?: unknown[] };
    expect(preview.problems ?? []).toEqual([]);

    const { calls, fetcher } = oracle({ status: 201, body: { InvoiceId: 300100208369303, InvoiceNumber: "AND-1", ValidationStatus: null } });
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "delivered", httpStatus: 201, reference: "300100208369303" });
    expect(calls[0].url).toBe(ORACLE);
    expect(calls[0].headers).toMatchObject({ Authorization: `Basic ${btoa("AP.INTEGRATION:fusion-pw")}`, "Content-Type": "application/json" });
    expect(JSON.parse(calls[0].body)).toEqual({
      InvoiceNumber: "AND-1",
      InvoiceCurrency: "GBP",
      InvoiceAmount: 240,
      InvoiceDate: "2026-09-29",
      BusinessUnit: "Vision Operations",
      Supplier: "Advanced Network Devices",
      SupplierSite: "FRESNO",
      Description: "VibeFinance inv-a",
      ControlAmount: 40,
      invoiceLines: [
        {
          LineNumber: 1,
          LineType: "Item",
          LineAmount: 150,
          Description: "Office supplies",
          Quantity: 3,
          TaxClassification: "VAT STD",
          invoiceDistributions: [{ DistributionLineNumber: 1, DistributionLineType: "Item", DistributionAmount: 150, DistributionCombination: "01-100-7110-0000-000" }],
        },
        {
          LineNumber: 2,
          LineType: "Item",
          LineAmount: 50,
          Description: "Delivery",
          Quantity: 1,
          TaxClassification: "VAT STD",
          invoiceDistributions: [{ DistributionLineNumber: 1, DistributionLineType: "Item", DistributionAmount: 50, DistributionCombination: "01-100-7640-0000-000" }],
        },
      ],
    });
  });

  it("keeps what Oracle says when it refuses an invoice, in its own words", async () => {
    const { id } = await addOracle();
    await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: ORACLE, method: "POST", format: "mapped", auth: { type: "basic", username: "AP.INTEGRATION" }, referencePath: "$.InvoiceId" }, secret: "pw" }, KEY, await connectorLibrary(env.DB));
    await fill("Oracle business units", [["acme-uk", "Vision Operations"]]);
    await fill("Oracle company segments", [["acme-uk", "01"]]);
    await fill("Oracle tax classifications", [["S", "VAT STD"]]);
    const { fetcher } = oracle({ status: 400, body: "The value of the attribute Supplier Site isn't valid. (AP-810927)" });
    const sent = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher))).body as { status: string; error: string };
    expect(sent.status).toBe("failed");
    expect(sent.error).toContain("AP-810927");
  });

  it("lets the customer change the account pattern to their chart of accounts", async () => {
    const { id } = await addOracle();
    const m = (await handleGetOutboundMapping(env.DB, id, await connectorLibrary(env.DB))).body as { editing: { definition: OutboundMapping } };
    const def = m.editing.definition;
    const segments = await env.DB.prepare("SELECT id FROM lookup_lists WHERE name = 'Oracle company segments'").first<{ id: string }>();
    def.distributions.fields.find((f) => f.target === "DistributionCombination")!.built = `{company|${segments!.id}}.{distribution.costCentre}.{distribution.glCode}.000.000.000`;
    expect((await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: def })).status).toBe(200);
    def.distributions.fields.find((f) => f.target === "DistributionCombination")!.built = "{company|no-such-list}.{distribution.glCode}";
    expect(await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: def })).toMatchObject({ status: 422, body: { reason: "unknown_list" } });
  });
});
