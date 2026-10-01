import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { standardOutboundMapping, type CompilerModel, type OutboundMapping } from "@vibefinance/shared";
import {
  handleCreateDestination,
  handleGetConnector,
  handlePreviewDelivery,
  handleSaveConnector,
  handleSendNow,
  type DeliveryDeps,
} from "../src/destination-delivery.js";
import {
  handleCompileOutboundFunction,
  handleCopyOutboundMapping,
  handleGetOutboundMapping,
  handlePublishOutboundMapping,
  handleSaveOutboundMapping,
  handleTryOutboundMapping,
} from "../src/outbound-mapping-route.js";
import { handleListLookupLists } from "../src/lookup-lists-route.js";
import { handleGetRouteMessage } from "../src/route-monitor-route.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Outbound mapping — decision 0591**, slice 3 of the connector
 * framework: a Destination's own layout of each invoice, copied from the
 * standard, tried on a real invoice, published, then sent.
 */

const CUSTOMER = "acme";
const KEY = btoa("k".repeat(32));

function target() {
  const calls: Array<{ body: string }> = [];
  const fetcher = (async (_url: string, init: RequestInit) => {
    calls.push({ body: String(init.body ?? "") });
    return new Response(JSON.stringify({ InvoiceId: 300100 }), { status: 201, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}
const deps = (fetcher: typeof fetch): DeliveryDeps => ({ secretsKey: KEY, bucket: env.DOCUMENTS, customerId: CUSTOMER, fetcher });

async function invoice(id: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, invoice_number) VALUES (?, ?, ?)")
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), "BT-2": "2026-09-29", "BT-5": "EUR", "BT-112": 120, "BT-109": 100, "BT-110": 20, "BT-27": "Lager Nord GmbH" }), id.toUpperCase())
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES (?, 1, ?)")
    .bind(id, JSON.stringify({ "BT-153": "Pallet racking", "BT-131": 100, "BT-129": 1, "coding.gl_code": "620300", "BT-133": "4100" }))
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, 'ap-eligible', 'in_progress')")
    .bind(`pi-${id}`, id)
    .run();
}

async function destination(name = "Oracle push", connectorId?: string) {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name, ...(connectorId ? { connectorId } : {}) });
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  if (!connectorId) {
    expect((await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://erp.acme.example/invoices" } }, KEY)).status).toBe(200);
  }
  return id;
}

async function list(id: string, name: string, entries: Record<string, string>) {
  const at = "2026-10-01T00:00:00Z";
  await env.DB.prepare("INSERT INTO lookup_lists (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)").bind(id, name, at, at).run();
  for (const [from, to] of Object.entries(entries)) {
    await env.DB.prepare("INSERT INTO lookup_entries (list_id, key, from_value, to_value) VALUES (?, ?, ?, ?)").bind(id, from.toLowerCase(), from, to).run();
  }
}

/** An Oracle-shaped layout. */
const ORACLE: OutboundMapping = {
  format: "json",
  invoice: [
    { target: "InvoiceNumber", source: "invoiceNumber", fx: [], required: true },
    { target: "InvoiceCurrency", source: "currency", fx: [] },
    { target: "InvoiceAmount", source: "totals.total", fx: [] },
    { target: "BusinessUnit", source: "supplier.name", fx: [{ fn: "look_up", args: { list: "bu", otherwise: "refuse" } }] },
    { target: "Source", source: null, fixed: "VIBEFINANCE", fx: [] },
  ],
  lines: { name: "invoiceLines", fields: [{ target: "LineAmount", source: "line.netAmount", fx: [] }] },
  distributions: {
    name: "invoiceDistributions",
    place: "line",
    fields: [{ target: "DistributionCombination", source: "distribution.glCode", fx: [{ fn: "remove_prefix", args: { prefix: "62" } }] }],
  },
  empty: "omit",
};

beforeEach(async () => {
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.example', 'Dan Young')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await seedStage("ap-intake", "ap", "Intake", 1);
  await seedStage("ap-eligible", "ap", "Payment Eligible", 2);
});

describe("a Destination's own mapping — decision 0591", () => {
  it("starts as the standard layout, and a copy is a draft of it that sends nothing different until published", async () => {
    await invoice("inv-a");
    const id = await destination();
    const before = (await handleGetOutboundMapping(env.DB, id)).body as Record<string, unknown>;
    expect(before).toMatchObject({
      using: false,
      formatFixed: false,
      editing: null,
      versions: [],
      candidates: [{ id: "inv-a" }],
      // The values the editor shows: the latest invoice ready to pay, as the VibeFinance invoice.
      sample: { invoiceId: "inv-a", invoice: { invoiceNumber: "INV-A", lines: [{ distributions: [{ glCode: "620300" }] }] } },
    });
    expect(before.standard).toEqual(standardOutboundMapping());
    expect((before.sources as unknown[]).length).toBeGreaterThan(20);

    expect(await handleCopyOutboundMapping(env.DB, "u-dan", id)).toMatchObject({ status: 201, body: { version: 1, status: "draft" } });
    expect(await handleCopyOutboundMapping(env.DB, "u-dan", id)).toMatchObject({ status: 409, body: { reason: "already_copied" } });
    const after = (await handleGetOutboundMapping(env.DB, id)).body as Record<string, unknown>;
    expect(after).toMatchObject({ editing: { version: 1, status: "draft", definition: standardOutboundMapping() }, versions: [{ version: 1, status: "draft", copiedFrom: "https-out@1" }] });
    expect((await handleGetConnector(env.DB, id)).body).toMatchObject({ mapping: { live: null, draft: 1 }, settings: { format: "vf_json" } });
    // Its own layout cannot be chosen before one is published.
    expect(await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://erp.acme.example/invoices", format: "mapped" } }, KEY)).toMatchObject({
      status: 409,
      body: { reason: "no_live_mapping" },
    });
  });

  it("saves a draft checked, tries it on a real invoice, refuses to publish what it cannot lay out, then publishes and sends it", async () => {
    await invoice("inv-a");
    await list("bu", "Business units", { "Lager Nord GmbH": "Vision Germany BU" });
    const id = await destination();
    await handleCopyOutboundMapping(env.DB, "u-dan", id);

    expect(await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: { ...ORACLE, empty: "maybe" } })).toMatchObject({ status: 422, body: { reason: "invalid" } });
    const unknown = structuredClone(ORACLE);
    unknown.invoice[3].fx = [{ fn: "look_up", args: { list: "nope", otherwise: "refuse" } }];
    expect(await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: unknown })).toMatchObject({ status: 422, body: { reason: "unknown_list" } });

    // A required field the invoice leaves empty: tried, said, and not published.
    const needsPo = structuredClone(ORACLE);
    needsPo.invoice.push({ target: "PoNumber", source: "purchaseOrder", fx: [], required: true });
    expect(await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: needsPo })).toMatchObject({ status: 200, body: { version: 1, status: "draft" } });
    expect(await handlePublishOutboundMapping(env.DB, "u-dan", id, {})).toMatchObject({ status: 409, body: { reason: "not_tried" } });
    const tried = await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" });
    expect(tried.body).toMatchObject({ problems: [{ at: "PoNumber", reason: "is required, and is empty", words: "PoNumber (from purchaseOrder): is required, and is empty" }] });
    expect(await handlePublishOutboundMapping(env.DB, "u-dan", id, {})).toMatchObject({ status: 422, body: { reason: "sample_problems" } });

    await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: ORACLE });
    const good = await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" });
    expect(good.body).toMatchObject({
      problems: [],
      body: {
        InvoiceNumber: "INV-A",
        InvoiceCurrency: "EUR",
        InvoiceAmount: 120,
        BusinessUnit: "Vision Germany BU",
        Source: "VIBEFINANCE",
        invoiceLines: [{ LineAmount: 100, invoiceDistributions: [{ DistributionCombination: "0300" }] }],
      },
    });
    // Published from the invoice it was last tried on; the Destination now sends it.
    expect(await handlePublishOutboundMapping(env.DB, "u-dan", id, {})).toMatchObject({ status: 200, body: { version: 1, status: "live", using: true } });
    expect((await handleGetConnector(env.DB, id)).body).toMatchObject({ mapping: { live: 1, draft: null }, settings: { format: "mapped" } });

    const preview = await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" });
    expect(JSON.parse((preview.body as { body: string }).body)).toMatchObject({ InvoiceNumber: "INV-A", BusinessUnit: "Vision Germany BU" });
    const { calls, fetcher } = target();
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "delivered" });
    expect(JSON.parse(calls[0].body)).toEqual(good.body && (good.body as { body: unknown }).body);

    // The list says which Destination uses it.
    const lists = (await handleListLookupLists(env.DB)).body as { lists: Array<{ id: string; usedBy: string[] }> };
    expect(lists.lists.find((l) => l.id === "bu")?.usedBy).toEqual(["Oracle push"]);
  });

  it("edits after publishing as a new draft beside the live version, and publishing again retires the one before", async () => {
    await invoice("inv-a");
    const id = await destination();
    await handleCopyOutboundMapping(env.DB, "u-dan", id);
    await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" });
    await handlePublishOutboundMapping(env.DB, "u-dan", id, {});
    const changed = standardOutboundMapping();
    changed.invoice[0].fixed = "acme.invoice.v2";
    expect(await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: changed })).toMatchObject({ body: { version: 2, status: "draft" } });
    // Live still sends version 1.
    expect(JSON.parse(((await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { body: string }).body).schema).toBe("vibefinance.invoice.v1");
    expect(await handlePublishOutboundMapping(env.DB, "u-dan", id, {})).toMatchObject({ status: 200, body: { version: 2 } });
    const got = (await handleGetOutboundMapping(env.DB, id)).body as { versions: Array<{ version: number; status: string }> };
    expect(got.versions.map((v) => [v.version, v.status])).toEqual([
      [2, "live"],
      [1, "retired"],
    ]);
    expect(JSON.parse(((await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { body: string }).body).schema).toBe("acme.invoice.v2");
    // Back to the standard layout is the format setting; the mapping is kept.
    await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://erp.acme.example/invoices", format: "vf_json" } }, KEY);
    expect(JSON.parse(((await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { body: string }).body).schema).toBe("vibefinance.invoice.v1");
  });

  it("fails a delivery it cannot lay out at once, in words, without sending, and the monitor says it was the mapping", async () => {
    await invoice("inv-a");
    await list("bu", "Business units", { "Lager Nord GmbH": "Vision Germany BU" });
    const id = await destination();
    await handleCopyOutboundMapping(env.DB, "u-dan", id);
    await handleSaveOutboundMapping(env.DB, "u-dan", id, { definition: ORACLE });
    await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" });
    await handlePublishOutboundMapping(env.DB, "u-dan", id, {});
    // The list loses its entry after publishing.
    await env.DB.prepare("DELETE FROM lookup_entries WHERE list_id = 'bu'").run();
    const preview = (await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { problems: string[] };
    expect(preview.problems).toEqual(['BusinessUnit (from supplier.name): "Lager Nord GmbH" is not in the list Business units']);
    const { calls, fetcher } = target();
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "failed", httpStatus: null, error: expect.stringContaining("the outbound mapping could not lay out this invoice") });
    expect(calls).toHaveLength(0);
    const messageId = (sent.body as { messageId: string }).messageId;
    expect(((await handleGetRouteMessage(env.DB, messageId)).body as { message: Record<string, unknown> }).message).toMatchObject({
      status: "failed",
      errorCode: "outbound_mapping",
    });
  });

  it("is refused where the connector keeps its layout, and for a Destination that is not HTTPS out", async () => {
    const zap = await destination("Zapier", "automation-webhook");
    expect(await handleCopyOutboundMapping(env.DB, "u-dan", zap)).toMatchObject({ status: 409, body: { reason: "format_fixed" } });
    expect(((await handleGetOutboundMapping(env.DB, zap)).body as { formatFixed: boolean }).formatFixed).toBe(true);
    expect(await handleGetOutboundMapping(env.DB, "nope")).toMatchObject({ status: 404 });
  });

  it("compiles a field's function from plain words, with worked examples from the invoice tried", async () => {
    await invoice("inv-a");
    const id = await destination();
    await handleCopyOutboundMapping(env.DB, "u-dan", id);
    await handleTryOutboundMapping(env.DB, id, { invoiceId: "inv-a" });
    let prompt = "";
    const model: CompilerModel = {
      compile: async (p: string) => {
        prompt = p;
        return JSON.stringify({ steps: [{ fn: "remove_prefix", args: { prefix: "62" } }] });
      },
    } as CompilerModel;
    const r = await handleCompileOutboundFunction(env.DB, model, id, { target: "Account", source: "distribution.glCode", say: "drop the 62 at the start" });
    expect(r.body).toMatchObject({ kind: "compiled", steps: [{ fn: "remove_prefix" }], examples: [{ input: "620300", output: "0300" }] });
    expect(prompt).toContain('"620300"');
    expect(prompt).toContain("Account (a field Oracle push sends)");
  });
});

describe("through the router", () => {
  async function person(permissions: string[]): Promise<string> {
    const id = crypto.randomUUID();
    const key = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, 'P', ?)").bind(id, `${id}@acme.example`, await hashApiKey(key)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, 'Role', ?)").bind(id, JSON.stringify(permissions)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, id).run();
    return key;
  }
  const call = (path: string, key: string, init: RequestInit = {}) =>
    worker.fetch(
      new Request(`https://vf.example${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) } }),
      { ...env, CUSTOMER_ID: CUSTOMER, CONNECTOR_SECRETS_KEY: KEY } as unknown as Env
    );

  it("is Admin.Configure's: Integration.Monitor cannot look or change it", async () => {
    const admin = await person(["Admin.Configure"]);
    const monitor = await person(["Integration.Monitor"]);
    const id = await destination();
    expect((await call(`/route-instances/${id}/mapping`, monitor)).status).toBe(403);
    expect((await call(`/route-instances/${id}/mapping/copy`, monitor, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await call(`/route-instances/${id}/mapping/copy`, admin, { method: "POST", body: "{}" })).status).toBe(201);
    expect((await call(`/route-instances/${id}/mapping`, admin)).status).toBe(200);
    expect((await call(`/route-instances/${id}/mapping`, admin, { method: "PUT", body: JSON.stringify({ definition: ORACLE }) })).status).toBe(422);
    expect((await call(`/route-instances/${id}/mapping/publish`, admin, { method: "POST", body: "{}" })).status).toBe(409);
    expect((await call(`/route-instances/${id}/mapping/try`, admin, { method: "POST", body: "{}" })).status).toBe(400);
    expect((await call(`/route-instances/${id}/mapping/copy`, admin)).status).toBe(405);
  });
});
