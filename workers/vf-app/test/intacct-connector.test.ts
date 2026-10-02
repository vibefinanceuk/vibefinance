import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { checkSettings, handleCreateDestination, handleGetConnector, handleSaveConnector, handleSendNow, readPath, type DeliveryDeps } from "../src/destination-delivery.js";
import { handleTryOutboundMapping } from "../src/outbound-mapping-route.js";
import { connectorLibrary } from "../src/partner-library.js";

/**
 * **Sage Intacct — decision 0607.** Added from the Route library with its
 * address and token address filled in, it signs in with OAuth client
 * credentials for a web services user, posts an AP bill with a line per
 * distribution to a simulated Intacct, and keeps the record's key.
 */

const KEY = btoa("k".repeat(32));
const BILL = "https://api.intacct.com/ia/api/v1/objects/accounts-payable/bill";
const TOKEN = "https://api.intacct.com/ia/api/v1/oauth2/token";

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** A simulated Intacct: a token for the web services user's client credentials, then the bill. */
function intacct(post: { status: number; body: unknown } = { status: 201, body: { "ia::result": { key: "2051", id: "INV-4417", href: "/objects/accounts-payable/bill/2051" }, "ia::meta": { totalCount: 1 } } }) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: String(init.body ?? "") });
    if (String(url) === TOKEN) {
      const form = new URLSearchParams(String(init.body));
      const ok = form.get("grant_type") === "client_credentials" && form.get("client_id") === "vf-app.app.sage.com" && form.get("client_secret") === "cs-1" && form.get("username") === "vibefinance@ACME-UK";
      return new Response(JSON.stringify(ok ? { token_type: "Bearer", access_token: "at-1", expires_in: 43200 } : { error: "invalid_client" }), { status: ok ? 200 : 401, headers: { "Content-Type": "application/json" } });
    }
    if ((init.headers as Record<string, string>).Authorization !== "Bearer at-1") return new Response('{"ia::result":{"ia::error":{"code":"invalidRequest"}}}', { status: 401 });
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
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('acme-uk', 'Acme UK')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, erp_identifier) VALUES ('sup-1', 'Northern Freight Ltd', 'V-1001')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, invoice_number, supplier_id, org_unit_id) VALUES ('inv-a', ?, 'INV-4417', 'sup-1', 'acme-uk')")
    .bind(JSON.stringify({ "BT-1": "INV-4417", "BT-2": "2026-09-29", "BT-9": "2026-10-29", "BT-5": "GBP", "BT-112": 360, "BT-109": 300, "BT-110": 60 }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-a', 1, ?), ('inv-a', 2, ?)")
    .bind(
      JSON.stringify({ "BT-153": "Pallet racking", "BT-131": 200, "BT-129": 10, "BT-151": "S", "coding.gl_code": "6000", "BT-133": "OPS" }),
      JSON.stringify({ "BT-153": "Delivery", "BT-131": 100, "BT-129": 1, "BT-151": "S", "coding.gl_code": "6100", "BT-133": "OPS" })
    )
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-a', 'ap', 'invoice', 'inv-a', 'ap-eligible', 'in_progress')").run();
});

async function addIntacct() {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Sage Intacct", connectorId: "sage-intacct" }, await connectorLibrary(env.DB));
  expect(made.status).toBe(201);
  return made.body as { id: string; listsCreated: string[] };
}
async function signIn(id: string) {
  const got = (await handleGetConnector(env.DB, id, await connectorLibrary(env.DB))).body as { settings: Record<string, unknown> & { auth: Record<string, unknown> } };
  const settings = { ...got.settings, auth: { ...got.settings.auth, clientId: "vf-app.app.sage.com", username: "vibefinance@ACME-UK" } };
  const saved = await handleSaveConnector(env.DB, "u-dan", id, { settings, secret: "cs-1" }, KEY, await connectorLibrary(env.DB));
  expect(saved.status).toBe(200);
}

describe("an OAuth user name, and references with colons — decision 0607", () => {
  it("keeps a user name for the token request, and reads a reference under ia::result, a record or a list of one", () => {
    expect(checkSettings({ url: BILL, auth: { type: "oauth2_client_credentials", tokenUrl: TOKEN, clientId: "c", username: "u@co" }, referencePath: "$.ia::result.key" })).toMatchObject({
      settings: { auth: { username: "u@co" }, referencePath: "$.ia::result.key" },
    });
    expect(readPath({ "ia::result": { key: "2051" } }, "$.ia::result.key")).toBe("2051");
    expect(readPath({ "ia::result": [{ key: "2052" }] }, "$.ia::result.key")).toBe("2052");
  });
});

describe("Sage Intacct — decision 0607", () => {
  it("is added with Intacct's address and token address filled in, its mapping live, and its two look-up lists made", async () => {
    const { id, listsCreated } = await addIntacct();
    expect([...listsCreated].sort()).toEqual(["Intacct locations", "Intacct purchase tax details"]);
    const got = (await handleGetConnector(env.DB, id, await connectorLibrary(env.DB))).body as Record<string, unknown>;
    expect(got.settings).toMatchObject({ url: BILL, method: "POST", format: "mapped", auth: { type: "oauth2_client_credentials", tokenUrl: TOKEN }, referencePath: "$.ia::result.key" });
    expect(got.connector).toMatchObject({ id: "sage-intacct", maturity: "first_version", authTypes: ["oauth2_client_credentials"] });
  });

  it("signs in as the web services user, posts the bill with Intacct calculating the tax, and keeps the record's key", async () => {
    const { id } = await addIntacct();
    await signIn(id);
    await fill("Intacct locations", [["acme-uk", "UK"]]);
    await fill("Intacct purchase tax details", [["S", "UK Purchase Goods Standard Rate"]]);
    const { calls, fetcher } = intacct();
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "delivered", httpStatus: 201, reference: "2051" });
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", TOKEN],
      ["POST", BILL],
    ]);
    const body = JSON.parse(calls[1].body);
    expect(body).toEqual({
      billNumber: "INV-4417",
      vendor: { id: "V-1001" },
      createdDate: "2026-09-29",
      postingDate: new Date().toISOString().slice(0, 10),
      dueDate: "2026-10-29",
      currency: { txnCurrency: "GBP" },
      description: "VibeFinance inv-a",
      isTaxInclusive: false,
      lines: [
        { glAccount: { id: "6000" }, txnAmount: "200.00", memo: "Pallet racking", dimensions: { department: { id: "OPS" }, location: { id: "UK" } }, taxEntries: [{ purchasingTaxDetail: { id: "UK Purchase Goods Standard Rate" } }] },
        { glAccount: { id: "6100" }, txnAmount: "100.00", memo: "Delivery", dimensions: { department: { id: "OPS" }, location: { id: "UK" } }, taxEntries: [{ purchasingTaxDetail: { id: "UK Purchase Goods Standard Rate" } }] },
      ],
    });
  });

  it("sends untaxed lines for a company that leaves its lists empty, and keeps Intacct's words when it refuses", async () => {
    const { id } = await addIntacct();
    await signIn(id);
    const { calls, fetcher } = intacct({ status: 400, body: { "ia::result": { "ia::error": { code: "invalidRequest", message: "Vendor V-1001 is inactive" } } } });
    const out = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher))).body as { status: string; error: string };
    expect(JSON.parse(calls[1].body).lines[0]).toEqual({ glAccount: { id: "6000" }, txnAmount: "200.00", memo: "Pallet racking", dimensions: { department: { id: "OPS" } } });
    expect(out.status).toBe("failed");
    expect(out.error).toContain("Vendor V-1001 is inactive");
  });

  it("Try names a tax category missing from a list that has entries", async () => {
    const { id } = await addIntacct();
    await fill("Intacct purchase tax details", [["Z", "UK Purchase Goods Zero Rate"]]);
    const tried = (await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" })).body as { problems: Array<{ reason: string }> };
    expect(tried.problems.map((p) => p.reason)).toEqual(['"S" is not in the list Intacct purchase tax details', '"S" is not in the list Intacct purchase tax details']);
  });
});
