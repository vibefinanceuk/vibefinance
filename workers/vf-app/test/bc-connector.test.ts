import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { handleCreateDestination, handleGetConnector, handleSaveConnector, handleSendNow, type DeliveryDeps } from "../src/destination-delivery.js";
import { connectorLibrary } from "../src/partner-library.js";

/**
 * **Microsoft Dynamics 365 Business Central — decision 0609.** Added from
 * the Route library, it signs in through Microsoft Entra ID with Business
 * Central's scope, posts a draft purchase invoice with its lines and their
 * dimensions in one request to a simulated Business Central, and keeps
 * the invoice's number.
 */

const KEY = btoa("k".repeat(32));
const TENANT = "8f1b7a52-1c3e-4d4a-9a6f-2b0c7d1e5f90";
const BC = `https://api.businesscentral.dynamics.com/v2.0/${TENANT}/Production/api/v2.0/companies(5d115c9c-44e3-ea11-bb43-000d3a2feca1)/purchaseInvoices`;
const TOKEN = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

function businessCentral(post: { status: number; body: unknown } = { status: 201, body: { id: "5d115c9c-0000-ea11-bb43-000d3a2feca1", number: "108017", status: "Draft", vendorNumber: "20000" } }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: String(init.body ?? "") });
    if (String(url) === TOKEN) {
      const form = new URLSearchParams(String(init.body));
      const ok = form.get("grant_type") === "client_credentials" && form.get("scope") === "https://api.businesscentral.dynamics.com/.default" && form.get("client_secret") === "entra-secret";
      return new Response(JSON.stringify(ok ? { token_type: "Bearer", access_token: "bc-at", expires_in: 3599 } : { error: "invalid_client" }), { status: ok ? 200 : 401, headers: { "Content-Type": "application/json" } });
    }
    if ((init.headers as Record<string, string>).Authorization !== "Bearer bc-at") return new Response('{"error":{"code":"Authentication_InvalidCredentials"}}', { status: 401 });
    return new Response(typeof post.body === "string" ? post.body : JSON.stringify(post.body), { status: post.status, headers: { "Content-Type": "application/json" } });
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
  await env.DB.prepare("INSERT INTO suppliers (id, name, erp_identifier) VALUES ('sup-1', 'First Up Consultants', '20000')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, invoice_number, supplier_id) VALUES ('inv-a', ?, 'INV-2231', 'sup-1')")
    .bind(JSON.stringify({ "BT-1": "INV-2231", "BT-2": "2026-09-29", "BT-9": "2026-10-29", "BT-5": "GBP", "BT-112": 360, "BT-109": 300, "BT-110": 60 }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-a', 1, ?), ('inv-a', 2, ?)")
    .bind(
      JSON.stringify({ "BT-153": "Consultancy, September", "BT-131": 200, "BT-129": 10, "BT-151": "S", "coding.gl_code": "8410", "BT-133": "SALES" }),
      JSON.stringify({ "BT-153": "Travel", "BT-131": 100, "BT-129": 1, "BT-151": "S", "coding.gl_code": "8420" })
    )
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-a', 'ap', 'invoice', 'inv-a', 'ap-eligible', 'in_progress')").run();
});

async function addBc() {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Business Central", connectorId: "dynamics-365-bc" }, await connectorLibrary(env.DB));
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  const got = (await handleGetConnector(env.DB, id, await connectorLibrary(env.DB))).body as { settings: Record<string, unknown> & { auth: Record<string, unknown> } };
  const saved = await handleSaveConnector(
    env.DB,
    "u-dan",
    id,
    { settings: { ...got.settings, url: BC, auth: { ...got.settings.auth, tokenUrl: TOKEN, clientId: "3c1e9a6d-entra-app" } }, secret: "entra-secret" },
    KEY,
    await connectorLibrary(env.DB)
  );
  expect(saved.status).toBe(200);
  return { id, listsCreated: (made.body as { listsCreated: string[] }).listsCreated, settings: got.settings };
}

describe("Microsoft Dynamics 365 Business Central — decision 0609", () => {
  it("is added with Business Central's scope filled in, its mapping live, and its tax codes list made", async () => {
    const { id, listsCreated, settings } = await addBc();
    expect(listsCreated).toEqual(["Business Central tax codes"]);
    expect(settings).toMatchObject({ method: "POST", format: "mapped", auth: { type: "oauth2_client_credentials", scope: "https://api.businesscentral.dynamics.com/.default" }, referencePath: "$.number" });
    const got = (await handleGetConnector(env.DB, id, await connectorLibrary(env.DB))).body as Record<string, unknown>;
    expect(got.connector).toMatchObject({ id: "dynamics-365-bc", maturity: "first_version", authTypes: ["oauth2_client_credentials"] });
  });

  it("signs in through Entra ID, posts the draft invoice with its lines and dimensions in one request, and keeps its number", async () => {
    const { id } = await addBc();
    await fill("Business Central tax codes", [["S", "VAT20"]]);
    const { calls, fetcher } = businessCentral();
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "delivered", httpStatus: 201, reference: "108017" });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", TOKEN],
      ["POST", BC],
    ]);
    expect(JSON.parse(calls[1].body)).toEqual({
      vendorNumber: "20000",
      vendorInvoiceNumber: "INV-2231",
      invoiceDate: "2026-09-29",
      postingDate: new Date().toISOString().slice(0, 10),
      dueDate: "2026-10-29",
      pricesIncludeTax: false,
      totalAmountIncludingTax: 360,
      purchaseInvoiceLines: [
        { lineType: "Account", lineObjectNumber: "8410", description: "Consultancy, September", quantity: 1, unitCost: 200, taxCode: "VAT20", dimensionSetLines: [{ code: "DEPARTMENT", valueCode: "SALES" }] },
        { lineType: "Account", lineObjectNumber: "8420", description: "Travel", quantity: 1, unitCost: 100, taxCode: "VAT20" },
      ],
    });
  });

  it("keeps Business Central's own words when it refuses the invoice", async () => {
    const { id } = await addBc();
    const { fetcher } = businessCentral({ status: 400, body: { error: { code: "Internal_RecordNotFound", message: "The Vendor does not exist. Identification fields and values: No.='20000'" } } });
    const out = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher))).body as { status: string; error: string };
    expect(out.status).toBe("failed");
    expect(out.error).toContain("The Vendor does not exist");
  });
});
