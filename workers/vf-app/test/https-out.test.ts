import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import {
  checkSettings,
  handleCreateDestination,
  handleGetConnector,
  handlePreviewDelivery,
  handleSaveConnector,
  handleSendNow,
  handleSetDestinationUnits,
  handleStartDestination,
  readPath,
  runDeliveries,
  type DeliveryDeps,
} from "../src/destination-delivery.js";
import { decryptSecret } from "../src/connector-secrets.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { handleProcessRoutes, handleSetInstanceStatus } from "../src/routes-route.js";
import { handleGetRouteMessage, handleListRouteMessages, routeMessagePart } from "../src/route-monitor-route.js";

/**
 * **HTTPS out and the delivery engine — decision 0585.** A Destination
 * posts each payment-eligible invoice to an address, signed in, once;
 * retries what may pass, says what the target refused, keeps the
 * target's reference, and records every request and reply.
 */

const CUSTOMER = "acme";
const KEY = btoa("k".repeat(32));

type Call = { url: string; method: string; headers: Record<string, string>; body: string };

/** A target that answers from a queue of replies, and records every call. */
function target(replies: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), method: init.method ?? "GET", headers: init.headers as Record<string, string>, body: String(init.body ?? "") });
    const next = replies.shift() ?? { status: 200, body: {} };
    if (next instanceof Error) throw next;
    return new Response(next.body === undefined ? "" : typeof next.body === "string" ? next.body : JSON.stringify(next.body), {
      status: next.status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetcher };
}

const deps = (fetcher: typeof fetch, now?: Date): DeliveryDeps => ({
  secretsKey: KEY,
  bucket: env.DOCUMENTS,
  customerId: CUSTOMER,
  fetcher,
  ...(now ? { now: () => now } : {}),
});

async function invoice(id: string, stage: string, status = "in_progress") {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?1, json_set(?2, '$.BT-1', ?3))")
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), "BT-2": "2026-09-29", "BT-5": "EUR", "BT-112": 120, "BT-109": 100, "BT-110": 20, "BT-27": "Lager Nord GmbH" }), id.toUpperCase())
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES (?, 1, ?)")
    .bind(id, JSON.stringify({ "BT-153": "Pallet racking", "BT-131": 100, "BT-129": 1, "coding.gl_code": "620300", "BT-133": "4100" }))
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, 'ap', 'invoice', ?, ?, ?)")
    .bind(`pi-${id}`, id, stage, status)
    .run();
}

let destinations = 0;
async function destination(settings: Record<string, unknown> = { url: "https://erp.acme.example/api/invoices" }, secret?: string, name?: string) {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: name ?? (destinations++ === 0 ? "ERP push" : `ERP push ${destinations}`) });
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  const saved = await handleSaveConnector(env.DB, "u-dan", id, { settings, ...(secret ? { secret } : {}) }, KEY);
  expect(saved.status).toBe(200);
  return id;
}

const delivery = (id: string, invoiceId: string) =>
  env.DB.prepare("SELECT * FROM destination_deliveries WHERE instance_id = ? AND invoice_id = ?").bind(id, invoiceId).first<Record<string, unknown>>();

beforeEach(async () => {
  destinations = 0;
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.example', 'Dan Young')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await seedStage("ap-intake", "ap", "Intake", 1);
  await seedStage("ap-eligible", "ap", "Payment Eligible", 2);
});

describe("settings", () => {
  it("are checked: an https address, a known sign-in, and what each sign-in needs", () => {
    expect(checkSettings({ url: "http://erp.example" })).toMatchObject({ reason: "bad_url" });
    expect(checkSettings({ url: "https://erp.example/x", auth: { type: "api_key_header" } })).toMatchObject({ reason: "bad_header" });
    expect(checkSettings({ url: "https://erp.example/x", auth: { type: "basic" } })).toMatchObject({ reason: "no_username" });
    expect(checkSettings({ url: "https://erp.example/x", auth: { type: "oauth2_client_credentials", tokenUrl: "https://id.example/token" } })).toMatchObject({ reason: "no_client_id" });
    expect(checkSettings({ url: "https://erp.example/x", referencePath: "id" })).toMatchObject({ reason: "bad_reference_path" });
    expect(checkSettings({ url: "https://erp.example/x", method: "PUT", format: "csv", referencePath: "$.data[0].id", auth: { type: "api_key_header", header: "X-API-Key" } })).toEqual({
      settings: { url: "https://erp.example/x", method: "PUT", format: "csv", referencePath: "$.data[0].id", auth: { type: "api_key_header", header: "X-API-Key" } },
    });
  });

  it("keep the secret encrypted, never return it, and refuse it with no key set", async () => {
    const id = await destination({ url: "https://erp.example/x", auth: { type: "bearer" } }, "s3cret-token");
    const row = await env.DB.prepare("SELECT value_enc FROM connector_secrets WHERE instance_id = ?").bind(id).first<{ value_enc: string }>();
    expect(row!.value_enc).not.toContain("s3cret");
    expect(await decryptSecret(KEY, id, "token", row!.value_enc)).toBe("s3cret-token");
    // Bound to its instance and name: copied elsewhere it does not decrypt.
    await expect(decryptSecret(KEY, "other", "token", row!.value_enc)).rejects.toThrow();
    const got = (await handleGetConnector(env.DB, id)).body as Record<string, unknown>;
    expect(JSON.stringify(got)).not.toContain("s3cret");
    expect(got.secrets).toEqual({ token: expect.any(String) });
    const refused = await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://erp.example/x", auth: { type: "bearer" } }, secret: "x" }, undefined);
    expect(refused).toMatchObject({ status: 503, body: { reason: "no_secrets_key" } });
  });
});

describe("sending", () => {
  it("posts the invoice as VibeFinance JSON, signed in, once, and keeps the target's reference and both sides", async () => {
    await invoice("inv-a", "ap-eligible");
    const id = await destination({ url: "https://erp.acme.example/api/invoices", referencePath: "$.data.documentId", auth: { type: "bearer" } }, "tok-1");
    const { calls, fetcher } = target([{ status: 201, body: { data: { documentId: "AP-5100023" } } }]);
    const sent = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(sent.body).toMatchObject({ status: "delivered", httpStatus: 201, reference: "AP-5100023" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ url: "https://erp.acme.example/api/invoices", method: "POST" });
    expect(calls[0].headers).toMatchObject({ Authorization: "Bearer tok-1", "Idempotency-Key": `${id}:inv-a`, "Content-Type": "application/json" });
    expect(JSON.parse(calls[0].body)).toMatchObject({
      schema: "vibefinance.invoice.v1",
      id: "inv-a",
      invoiceNumber: "INV-A",
      currency: "EUR",
      totals: { net: 100, vat: 20, total: 120 },
      lines: [{ lineNumber: 1, description: "Pallet racking", netAmount: 100, distributions: [{ costCentre: "4100", glCode: "620300", netAmount: 100 }] }],
    });

    expect(await delivery(id, "inv-a")).toMatchObject({ status: "delivered", attempts: 1, reference: "AP-5100023", last_status: 201 });
    const messageId = (sent.body as { messageId: string }).messageId;
    const message = await env.DB.prepare("SELECT direction, status, destination_id, recipient, subject FROM route_messages WHERE id = ?").bind(messageId).first();
    expect(message).toEqual({ direction: "out", status: "delivered", destination_id: id, recipient: "erp.acme.example", subject: "INV-A" });
    const parts = (await env.DB.prepare("SELECT seq, role FROM route_message_parts WHERE message_id = ? ORDER BY seq").bind(messageId).all()).results;
    expect(parts).toEqual([{ seq: 1, role: "sent" }, { seq: 2, role: "reply" }]);
    const events = (await env.DB.prepare("SELECT event, detail FROM route_message_events WHERE message_id = ? ORDER BY seq").bind(messageId).all<{ event: string; detail: string | null }>()).results;
    expect(events.map((e) => e.event)).toEqual(["sending", "attempt", "reference", "delivered"]);
    // The Route monitor shows it: the Destination, the invoice, both sides, who sent it.
    const detail = (await handleGetRouteMessage(env.DB, messageId)).body as {
      message: Record<string, unknown>;
      parts: { seq: number; role: string }[];
      events: { event: string; actorName: string | null; detail: string | null }[];
      invoices: { invoiceId: string }[];
    };
    expect(detail.message).toMatchObject({ direction: "out", status: "delivered", sourceId: id, sourceName: "ERP push" });
    expect(detail.invoices.map((i) => i.invoiceId)).toEqual(["inv-a"]);
    expect(detail.events[0]).toMatchObject({ event: "sending", actorName: "Dan Young" });
    expect(detail.events[1].detail).toBe("1: HTTP 201");
    const sentFile = (await routeMessagePart(env.DB, env.DOCUMENTS, messageId, 1)) as Response;
    expect(await sentFile.text()).toContain('"invoiceNumber": "INV-A"');
    const replyFile = (await routeMessagePart(env.DB, env.DOCUMENTS, messageId, 2)) as Response;
    expect(await replyFile.text()).toContain("AP-5100023");
    const listed = (await handleListRouteMessages(env.DB, new URLSearchParams("period=today"))).body as { messages: Array<{ id: string }> };
    expect(listed.messages.some((m) => m.id === messageId)).toBe(true);
    // Never twice.
    expect((await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher))).body).toMatchObject({ reason: "already_delivered" });
  });

  it("sends the ERP CSV layout, with a key in a header, or basic sign-in", async () => {
    await invoice("inv-a", "ap-eligible");
    await invoice("inv-b", "ap-eligible");
    const csv = await destination({ url: "https://erp.example/csv", format: "csv", auth: { type: "api_key_header", header: "X-API-Key" } }, "k-9");
    const { calls, fetcher } = target([{ status: 200 }, { status: 200 }]);
    await handleSendNow(env.DB, "u-dan", csv, { invoiceId: "inv-a" }, deps(fetcher));
    expect(calls[0].headers).toMatchObject({ "X-API-Key": "k-9", "Content-Type": "text/csv; charset=utf-8" });
    expect(calls[0].body.split("\n")[0]).toContain("invoice_number");
    expect(calls[0].body).toContain("INV-A");
    const basic = (await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Basic" })).body as { id: string };
    await handleSaveConnector(env.DB, "u-dan", basic.id, { settings: { url: "https://erp.example/b", auth: { type: "basic", username: "vf" } }, secret: "pw" }, KEY);
    await handleSendNow(env.DB, "u-dan", basic.id, { invoiceId: "inv-b" }, deps(fetcher));
    expect(calls[1].headers.Authorization).toBe(`Basic ${btoa("vf:pw")}`);
  });

  it("signs in with OAuth client credentials, fetching a token first", async () => {
    await invoice("inv-a", "ap-eligible");
    const id = await destination({ url: "https://erp.example/x", auth: { type: "oauth2_client_credentials", tokenUrl: "https://id.example/oauth/token", clientId: "vf-client", scope: "ap.write" } }, "cs-1");
    const { calls, fetcher } = target([{ status: 200, body: { access_token: "at-77", token_type: "Bearer" } }, { status: 200, body: {} }]);
    await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(calls[0].url).toBe("https://id.example/oauth/token");
    expect(new URLSearchParams(calls[0].body).toString()).toBe("grant_type=client_credentials&client_id=vf-client&client_secret=cs-1&scope=ap.write");
    expect(calls[1].headers.Authorization).toBe("Bearer at-77");
  });

  it("retries a 503 and an unreachable target over about a day, then fails it", async () => {
    await invoice("inv-a", "ap-eligible");
    const id = await destination();
    const replies = [{ status: 503, body: "busy" }, new Error("connect ECONNREFUSED"), ...Array(10).fill({ status: 503, body: "busy" })];
    const { calls, fetcher } = target(replies);
    const t0 = new Date("2026-10-01T10:00:00Z");
    expect((await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher, t0))).body).toMatchObject({ status: "retrying", httpStatus: 503 });
    expect(await delivery(id, "inv-a")).toMatchObject({ status: "retrying", attempts: 1, next_attempt_at: "2026-10-01T10:05:00.000Z", last_error: "busy" });
    // The sweep takes it when due, and not before.
    await handleStartDestination(env.DB, id, { includeWaiting: false });
    expect((await runDeliveries(env.DB, deps(fetcher, new Date("2026-10-01T10:04:00Z")))).attempted).toBe(0);
    await runDeliveries(env.DB, deps(fetcher, new Date("2026-10-01T10:05:00Z")));
    expect(await delivery(id, "inv-a")).toMatchObject({ status: "retrying", attempts: 2, next_attempt_at: "2026-10-01T10:20:00.000Z" });
    expect(String((await delivery(id, "inv-a"))!.last_error)).toContain("could not be reached");
    for (const at of ["2026-10-01T10:20:00Z", "2026-10-01T11:20:00Z", "2026-10-01T14:20:00Z", "2026-10-01T20:20:00Z", "2026-10-02T08:20:00Z"]) {
      await runDeliveries(env.DB, deps(fetcher, new Date(at)));
    }
    expect(await delivery(id, "inv-a")).toMatchObject({ status: "failed", attempts: 7, next_attempt_at: null });
    expect(calls).toHaveLength(7);
    const message = await env.DB.prepare("SELECT status, failed_part, error_code FROM route_messages WHERE destination_id = ?").bind(id).first();
    expect(message).toEqual({ status: "failed", failed_part: "delivery", error_code: "http_503" });
  });

  it("says what the target refused on a 4xx, does not retry it, and sends again when asked", async () => {
    await invoice("inv-a", "ap-eligible");
    const id = await destination();
    const { calls, fetcher } = target([{ status: 422, body: { error: "Supplier LAGER NORD GMBH has no site HAMBURG" } }, { status: 201, body: {} }]);
    const refused = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(refused.body).toMatchObject({ status: "failed", httpStatus: 422 });
    expect(String((refused.body as { error: string }).error)).toContain("has no site HAMBURG");
    const again = await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    expect(again.body).toMatchObject({ status: "delivered" });
    expect(calls).toHaveLength(2);
    // The same message, with both attempts in it.
    const messages = (await env.DB.prepare("SELECT id, status FROM route_messages WHERE destination_id = ?").bind(id).all()).results;
    expect(messages).toEqual([{ id: (refused.body as { messageId: string }).messageId, status: "delivered" }]);
    const parts = (await env.DB.prepare("SELECT seq, role FROM route_message_parts WHERE message_id = ? ORDER BY seq").bind(messages[0].id).all()).results;
    expect(parts.map((p) => p.role)).toEqual(["sent", "reply", "sent", "reply"]);
  });

  it("previews exactly what would be sent, with the secret hidden, and sends nothing", async () => {
    await invoice("inv-a", "ap-eligible");
    const id = await destination({ url: "https://erp.example/x", auth: { type: "api_key_header", header: "X-API-Key" } }, "k-1");
    const preview = (await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as Record<string, unknown>;
    expect(preview).toMatchObject({ method: "POST", url: "https://erp.example/x", headers: { "X-API-Key": "•••" }, checks: ["no_supplier_erp_id"] });
    expect(JSON.parse(preview.body as string).invoiceNumber).toBe("INV-A");
    expect(JSON.stringify(preview)).not.toContain("k-1");
    expect(await delivery(id, "inv-a")).toBeNull();
  });
});

describe("starting, the sweep, and pausing", () => {
  it("sends what is already waiting only if asked; then each invoice as it becomes payment-eligible", async () => {
    await invoice("inv-old", "ap-eligible");
    await invoice("inv-done", "ap-intake", "completed");
    await invoice("inv-early", "ap-intake");
    const id = await destination();
    // Not sending until started; resuming is not starting.
    expect((await handleSetInstanceStatus(env.DB, id, { status: "active" })).body).toMatchObject({ reason: "not_started" });
    const { calls, fetcher } = target([]);
    expect((await runDeliveries(env.DB, deps(fetcher))).attempted).toBe(0);

    expect((await handleStartDestination(env.DB, id, { includeWaiting: false })).body).toMatchObject({ status: "active", waiting: 2, setAside: 2, sent: 0 });
    expect(await runDeliveries(env.DB, deps(fetcher))).toEqual({ queued: 0, attempted: 0 });
    expect(await delivery(id, "inv-old")).toMatchObject({ status: "skipped" });

    // inv-early reaches Payment Eligible.
    await env.DB.prepare("UPDATE process_instances SET current_stage_id = 'ap-eligible' WHERE id = 'pi-inv-early'").run();
    expect(await runDeliveries(env.DB, deps(fetcher))).toEqual({ queued: 1, attempted: 1 });
    expect(calls.map((c) => JSON.parse(c.body).id)).toEqual(["inv-early"]);
    expect((await handleStartDestination(env.DB, id, {})).body).toMatchObject({ reason: "already_started" });

    // Paused: nothing is taken or sent; resumed, it is.
    await handleSetInstanceStatus(env.DB, id, { status: "paused" });
    await invoice("inv-late", "ap-eligible");
    expect(await runDeliveries(env.DB, deps(fetcher))).toEqual({ queued: 0, attempted: 0 });
    await handleSetInstanceStatus(env.DB, id, { status: "active" });
    expect(await runDeliveries(env.DB, deps(fetcher))).toEqual({ queued: 1, attempted: 1 });
  });

  it("with includeWaiting, sends what was already waiting too; and a missing secret stops it starting", async () => {
    await invoice("inv-old", "ap-eligible");
    const noSecret = await destination({ url: "https://erp.example/x", auth: { type: "bearer" } });
    expect((await handleStartDestination(env.DB, noSecret, { includeWaiting: true })).body).toMatchObject({ reason: "secret_missing" });
    const id = await destination();
    await handleStartDestination(env.DB, id, { includeWaiting: true });
    const { calls, fetcher } = target([]);
    expect(await runDeliveries(env.DB, deps(fetcher))).toMatchObject({ attempted: 1 });
    expect(calls).toHaveLength(1);
  });

  it("shows on Process routes with what is waiting and what failed", async () => {
    await invoice("inv-a", "ap-eligible");
    const id = await destination();
    const { fetcher } = target([{ status: 400, body: "no" }]);
    await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, deps(fetcher));
    const flow = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { destinations: Array<Record<string, unknown>> };
    expect(flow.destinations.find((d) => d.id === id)).toMatchObject({ name: "ERP push", routeId: "https-out", status: "paused", started: false, waiting: 0, failedOpen: 1 });
  });
});

describe("readPath", () => {
  it("reads a dotted path with indexes, and nothing that is not a value", () => {
    const body = { data: [{ id: 7, doc: { no: "51" } }], ok: true };
    expect(readPath(body, "$.data[0].id")).toBe("7");
    expect(readPath(body, "$.data[0].doc.no")).toBe("51");
    expect(readPath(body, "$.data[0].doc")).toBeNull();
    expect(readPath(body, "$.missing.x")).toBeNull();
    expect(readPath(null, "$.a")).toBeNull();
    expect(readPath(body, null)).toBeNull();
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

  it("lets Admin.Configure set a Destination up, and Integration.Monitor look and send again, but not change it", async () => {
    const admin = await person(["Admin.Configure"]);
    const monitor = await person(["Integration.Monitor"]);
    const made = await call("/processes/ap/destinations", admin, { method: "POST", body: JSON.stringify({ name: "ERP push" }) });
    expect(made.status).toBe(201);
    const { id } = (await made.json()) as { id: string };
    expect((await call("/processes/ap/destinations", monitor, { method: "POST", body: JSON.stringify({ name: "X" }) })).status).toBe(403);
    const save = { method: "PUT", body: JSON.stringify({ settings: { url: "https://erp.example/x", auth: { type: "bearer" } }, secret: "t" }) };
    expect((await call(`/route-instances/${id}/connector`, monitor, save)).status).toBe(403);
    expect((await call(`/route-instances/${id}/connector`, admin, save)).status).toBe(200);
    expect((await call(`/route-instances/${id}/connector`, monitor)).status).toBe(200);
    expect((await call(`/route-instances/${id}/connector/start`, monitor, { method: "POST", body: "{}" })).status).toBe(403);
    expect((await call(`/route-instances/${id}/connector/preview`, monitor, { method: "POST", body: "{}" })).status).toBe(403);
    // Send names an invoice; with none it is refused, but monitor may ask.
    expect((await call(`/route-instances/${id}/connector/send`, monitor, { method: "POST", body: "{}" })).status).toBe(400);
  });
});

/**
 * **Business units — decision 0587.** A customer with two ERPs gives each
 * Destination its units; a unit covers the units beneath it; none chosen
 * is all, as before.
 */
describe("which business units a Destination sends for — decision 0587", () => {
  async function units() {
    await env.DB.prepare(
      "INSERT INTO org_units (id, name, parent_unit_id) VALUES ('de', 'Acme Germany', NULL), ('de-ham', 'Acme Hamburg', 'de'), ('uk', 'Acme UK', NULL)"
    ).run();
  }
  const place = (id: string, unit: string | null) => env.DB.prepare("UPDATE invoice_headers SET org_unit_id = ? WHERE id = ?").bind(unit, id).run();

  it("sends only invoices of the units chosen and those beneath them; none chosen is all", async () => {
    await units();
    for (const [id, unit] of [["inv-de", "de"], ["inv-ham", "de-ham"], ["inv-uk", "uk"], ["inv-none", null]] as const) {
      await invoice(id, "ap-eligible");
      await place(id, unit);
    }
    const sap = await destination(undefined, undefined, "SAP");
    const set = await handleSetDestinationUnits(env.DB, sap, { unitIds: ["de"] });
    expect(set.body).toMatchObject({ unitIds: ["de"], covered: ["de", "de-ham"] });
    const all = await destination(undefined, undefined, "Warehouse");
    await handleStartDestination(env.DB, sap, { includeWaiting: true });
    await handleStartDestination(env.DB, all, { includeWaiting: true });
    const { calls, fetcher } = target([]);
    await runDeliveries(env.DB, deps(fetcher));
    const sent = (instance: string) =>
      env.DB.prepare("SELECT invoice_id FROM destination_deliveries WHERE instance_id = ? ORDER BY invoice_id").bind(instance).all<{ invoice_id: string }>().then((r) => r.results.map((x) => x.invoice_id));
    expect(await sent(sap)).toEqual(["inv-de", "inv-ham"]);
    expect(await sent(all)).toEqual(["inv-de", "inv-ham", "inv-none", "inv-uk"]);
    expect(calls).toHaveLength(6);
    // Its test list is its own units' invoices.
    const got = (await handleGetConnector(env.DB, sap)).body as { candidates: Array<{ id: string }> };
    expect(got.candidates.map((c) => c.id).sort()).toEqual(["inv-de", "inv-ham"]);
  });

  it("asks before sending what is already waiting in units added to a started Destination", async () => {
    await units();
    await invoice("inv-uk", "ap-eligible");
    await place("inv-uk", "uk");
    const id = await destination();
    await handleSetDestinationUnits(env.DB, id, { unitIds: ["de"] });
    await handleStartDestination(env.DB, id, { includeWaiting: false });
    expect((await handleSetDestinationUnits(env.DB, id, { unitIds: ["de", "uk"] })).body).toMatchObject({ reason: "decide_waiting", waiting: 1 });
    expect((await handleSetDestinationUnits(env.DB, id, { unitIds: ["de", "uk"], includeWaiting: false })).body).toMatchObject({ setAside: 1 });
    expect(await delivery(id, "inv-uk")).toMatchObject({ status: "skipped" });
    const { calls, fetcher } = target([]);
    await runDeliveries(env.DB, deps(fetcher));
    expect(calls).toHaveLength(0);
  });

  it("refuses a unit that does not exist, and clears to all with null", async () => {
    const id = await destination();
    expect((await handleSetDestinationUnits(env.DB, id, { unitIds: ["nope"] })).body).toMatchObject({ reason: "unknown_unit" });
    expect((await handleSetDestinationUnits(env.DB, id, { unitIds: null })).body).toMatchObject({ unitIds: null, covered: null });
    const flow = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { destinations: Array<Record<string, unknown>> };
    expect(flow.destinations.find((d) => d.id === id)).toMatchObject({ unitIds: null });
  });
});
