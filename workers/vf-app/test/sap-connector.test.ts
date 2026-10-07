import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { checkSettings, csrfAddress, handleCreateDestination, handleGetConnector, handlePreviewDelivery, handleSaveConnector, handleSendNow, type DeliveryDeps } from "../src/destination-delivery.js";
import { handleTryOutboundMapping } from "../src/outbound-mapping-route.js";
import { connectorLibrary } from "../src/partner-library.js";

/**
 * **SAP S/4HANA Cloud — decision 0606.** Added from the Route library,
 * it fetches a CSRF token with the session's cookies, then posts a
 * supplier invoice with a G/L account item per distribution, in OData's
 * dates and SAP's text amounts, to a simulated SAP Gateway, and keeps
 * SAP's document number.
 */

const KEY = btoa("k".repeat(32));
const SAP = "https://my401234-api.s4hana.cloud.sap/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice";
const ROOT = "https://my401234-api.s4hana.cloud.sap/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** A simulated SAP Gateway: a token and cookies for a signed-in GET with x-csrf-token: Fetch; a POST only with both. */
function gateway(opts: { post?: { status: number; body: unknown }; tokenStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    const headers = init.headers as Record<string, string>;
    calls.push({ url: String(url), method: init.method ?? "GET", headers, body: String(init.body ?? "") });
    if ((init.method ?? "GET") === "GET") {
      if (opts.tokenStatus) return new Response("", { status: opts.tokenStatus });
      const h = new Headers({ "x-csrf-token": headers["x-csrf-token"] === "Fetch" ? "Tok3n==" : "Required", "Content-Type": "application/json" });
      h.append("set-cookie", "SAP_SESSIONID_ABC_100=s3ss; path=/; secure; HttpOnly");
      h.append("set-cookie", "sap-usercontext=sap-client=100; path=/");
      return new Response('{"d":{"EntitySets":["A_SupplierInvoice"]}}', { status: 200, headers: h });
    }
    if (headers["x-csrf-token"] !== "Tok3n==" || !String(headers.Cookie ?? "").includes("SAP_SESSIONID_ABC_100=s3ss")) {
      return new Response("CSRF token validation failed", { status: 403, headers: { "x-csrf-token": "Required" } });
    }
    const reply = opts.post ?? { status: 201, body: { d: { SupplierInvoice: "5105600417", FiscalYear: "2026" } } };
    return new Response(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body), { status: reply.status, headers: { "Content-Type": "application/json" } });
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
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-de', 'Acme GmbH')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, erp_identifier) VALUES ('sup-1', 'Lager Nord GmbH', '17300032')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id, org_unit_id) VALUES ('inv-a', json_set(?1, '$.BT-1', 'RE-4417'), 'sup-1', 'acme-de')")
    .bind(JSON.stringify({ "BT-1": "RE-4417", "BT-2": "2026-09-29", "BT-5": "EUR", "BT-112": 357, "BT-109": 300, "BT-110": 57 }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-a', 1, ?), ('inv-a', 2, ?)")
    .bind(
      JSON.stringify({ "BT-153": "Palettenregale", "BT-131": 200, "BT-129": 10, "BT-151": "S", "coding.gl_code": "61000000", "BT-133": "10101101" }),
      JSON.stringify({ "BT-153": "Fracht", "BT-131": 100, "BT-129": 1, "BT-151": "S", "coding.gl_code": "61010000", "BT-133": "10101101" })
    )
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-a', 'ap', 'invoice', 'inv-a', 'ap-eligible', 'in_progress')").run();
});

async function addSap() {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "SAP S/4HANA", connectorId: "sap-s4hana-cloud" }, await connectorLibrary(env.DB));
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  const saved = await handleSaveConnector(
    env.DB,
    "u-dan",
    id,
    { settings: { url: SAP, method: "POST", format: "mapped", auth: { type: "basic", username: "VIBEFINANCE_COMM" }, referencePath: "$.d.SupplierInvoice", csrf: true }, secret: "comm-pw" },
    KEY,
    await connectorLibrary(env.DB)
  );
  expect(saved.status).toBe(200);
  await fill("SAP company codes", [["acme-de", "1010"]]);
  await fill("SAP tax codes", [["S", "V1"]]);
  return { id, listsCreated: (made.body as { listsCreated: string[] }).listsCreated };
}

describe("fetching a CSRF token first — decision 0606", () => {
  it("is a setting of its own, fetched from the service the address belongs to", () => {
    expect(checkSettings({ url: SAP, csrf: true })).toMatchObject({ settings: { csrf: true } });
    expect("csrf" in (checkSettings({ url: SAP }) as { settings: object }).settings).toBe(false);
    expect(csrfAddress(SAP)).toBe(ROOT);
    expect(csrfAddress(`${SAP}?sap-client=100`)).toBe(ROOT);
  });
});

describe("SAP S/4HANA Cloud — decision 0606", () => {
  it("is added with its settings, CSRF on, its mapping live, and its two look-up lists made", async () => {
    const { id, listsCreated } = await addSap();
    expect([...listsCreated].sort()).toEqual(["SAP company codes", "SAP tax codes"]);
    const got = (await handleGetConnector(env.DB, id, await connectorLibrary(env.DB))).body as Record<string, unknown>;
    expect(got.settings).toMatchObject({ method: "POST", format: "mapped", referencePath: "$.d.SupplierInvoice", csrf: true });
    expect(got.connector).toMatchObject({ id: "sap-s4hana-cloud", maturity: "first_version", fixed: ["method", "format"], asks: ["csrf"] });
  });

  it("fetches the token with the session's cookies, then posts the supplier invoice as SAP wants it, and keeps its document number", async () => {
    const { id } = await addSap();
    const preview = (await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { headers: Record<string, string>; problems: string[] };
    expect(preview.problems).toEqual([]);
    expect(preview.headers["x-csrf-token"]).toBe("••• (fetched first)");

    const { calls, fetcher } = gateway();
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "delivered", httpStatus: 201, reference: "5105600417" });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", ROOT],
      ["POST", SAP],
    ]);
    const basic = `Basic ${btoa("VIBEFINANCE_COMM:comm-pw")}`;
    expect(calls[0].headers).toMatchObject({ Authorization: basic, "x-csrf-token": "Fetch" });
    expect(calls[1].headers).toMatchObject({ Authorization: basic, "x-csrf-token": "Tok3n==", Cookie: "SAP_SESSIONID_ABC_100=s3ss; sap-usercontext=sap-client=100", Accept: "application/json" });
    const body = JSON.parse(calls[1].body);
    const sentOn = new Date().toISOString().slice(0, 10);
    expect(body).toEqual({
      CompanyCode: "1010",
      DocumentDate: `/Date(${Date.UTC(2026, 8, 29)})/`,
      PostingDate: `/Date(${Date.parse(`${sentOn}T00:00:00Z`)})/`,
      InvoicingParty: "17300032",
      SupplierInvoiceIDByInvcgParty: "RE-4417",
      DocumentCurrency: "EUR",
      InvoiceGrossAmount: "357.00",
      TaxIsCalculatedAutomatically: true,
      DueCalculationBaseDate: `/Date(${Date.UTC(2026, 8, 29)})/`,
      DocumentHeaderText: "VibeFinance inv-a",
      to_SupplierInvoiceItemGLAcct: [
        { SupplierInvoiceItem: "0001", CompanyCode: "1010", GLAccount: "61000000", CostCenter: "10101101", DocumentCurrency: "EUR", SupplierInvoiceItemAmount: "200.00", TaxCode: "V1", DebitCreditCode: "S", SupplierInvoiceItemText: "Palettenregale" },
        { SupplierInvoiceItem: "0002", CompanyCode: "1010", GLAccount: "61010000", CostCenter: "10101101", DocumentCurrency: "EUR", SupplierInvoiceItemAmount: "100.00", TaxCode: "V1", DebitCreditCode: "S", SupplierInvoiceItemText: "Fracht" },
      ],
    });
  });

  it("says when the token cannot be fetched, and keeps SAP's own words when it refuses the invoice", async () => {
    const { id } = await addSap();
    const refused = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(gateway({ tokenStatus: 401 }).fetcher));
    expect(refused.body).toMatchObject({ status: "failed", httpStatus: 401, error: `the CSRF token could not be fetched from ${ROOT}: HTTP 401` });
    const sapSays = { error: { code: "M8/321", message: { lang: "en", value: "Balance not zero: 57.00 debits: 300.00 credits: 357.00" } } };
    const out = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(gateway({ post: { status: 400, body: sapSays } }).fetcher))).body as { status: string; error: string };
    expect(out.status).toBe("failed");
    expect(out.error).toContain("Balance not zero");
  });

  it("Try names what the lists still need, and an invoice whose supplier has no SAP number", async () => {
    const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "SAP", connectorId: "sap-s4hana-cloud" }, await connectorLibrary(env.DB));
    await env.DB.prepare("UPDATE suppliers SET erp_identifier = NULL").run();
    const tried = (await handleTryOutboundMapping(env.DB, (made.body as { id: string }).id, { invoiceId: "inv-a" })).body as { problems: Array<{ at: string; reason: string }> };
    expect(tried.problems.map((p) => p.reason)).toEqual(
      expect.arrayContaining(['"acme-de" is not in the list SAP company codes', "is required, and is empty", '"S" is not in the list SAP tax codes'])
    );
  });
});
