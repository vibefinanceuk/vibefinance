import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { handleCreateDestination, handleSaveConnector, handleSendNow, handleStartDestination, runDeliveries } from "../src/destination-delivery.js";
import { handleDeleteDestination, handleProcessRoutes, handleRenameDestination, handleRetireDestination, handleSetInstanceStatus } from "../src/routes-route.js";
import { openOutboundMessage } from "../src/route-messages.js";
import { handleCopyOutboundMapping } from "../src/outbound-mapping-route.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Renaming and retiring a Destination — decision 0597**, as a Source
 * can be.
 */

const KEY = btoa("k".repeat(32));

async function destination(name: string) {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name });
  const id = (made.body as { id: string }).id;
  await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://erp.example/x" } }, KEY);
  return id;
}

async function rule(id: string, name: string, compiled: unknown, effectiveTo: string | null = null) {
  await env.DB.prepare("INSERT OR IGNORE INTO rule_sets (id, name, mode, status) VALUES ('rs', 'AP', 'all_matches', 'active')").run();
  await env.DB.prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled, name) VALUES (?, 'rs', 1, 1, ?)").bind(id, name).run();
  await env.DB.prepare("INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by, effective_to) VALUES (?, 1, 'x', ?, 'test', ?)")
    .bind(id, JSON.stringify(compiled), effectiveTo)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.example', 'Dan')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await seedStage("ap-intake", "ap", "Intake", 1);
  await seedStage("ap-eligible", "ap", "Payment Eligible", 2);
});

describe("renaming a Destination — decision 0597", () => {
  it("renames it, refusing an empty name, another's name in the process, and a retired one", async () => {
    const a = await destination("Oracle push");
    const b = await destination("Test push");
    expect(await handleRenameDestination(env.DB, a, "  Oracle   Payables ")).toEqual({ status: 200, body: { id: a, name: "Oracle Payables" } });
    expect(await handleRenameDestination(env.DB, a, "")).toMatchObject({ status: 400, body: { reason: "bad_name" } });
    expect(await handleRenameDestination(env.DB, a, "test PUSH")).toMatchObject({ status: 409, body: { reason: "name_taken" } });
    await handleRetireDestination(env.DB, "u-dan", b);
    // A retired one's name is free again, and it is not renamed.
    expect(await handleRenameDestination(env.DB, a, "Test push")).toMatchObject({ status: 200 });
    expect(await handleRenameDestination(env.DB, b, "Anything")).toMatchObject({ status: 409, body: { reason: "retired" } });
    expect(await handleRenameDestination(env.DB, "nope", "x")).toMatchObject({ status: 404 });
  });
});

describe("retiring a Destination — decision 0597", () => {
  it("stops it sending, for good, and keeps it on Process routes as retired", async () => {
    const id = await destination("Oracle push");
    await handleStartDestination(env.DB, id, {});
    expect(await handleRetireDestination(env.DB, "u-dan", id)).toEqual({ status: 200, body: { id, status: "retired" } });
    expect(await env.DB.prepare("SELECT status, retired_by FROM route_instances WHERE id = ?").bind(id).first()).toEqual({ status: "retired", retired_by: "u-dan" });
    expect(await handleRetireDestination(env.DB, "u-dan", id)).toMatchObject({ status: 409, body: { reason: "retired" } });
    expect(await handleSetInstanceStatus(env.DB, id, { status: "active" })).toMatchObject({ status: 409, body: { reason: "retired" } });
    // Nothing more is sent: the sweep takes only active ones, and Send is refused.
    expect((await runDeliveries(env.DB, { secretsKey: KEY, fetcher: (async () => { throw new Error("must not send"); }) as unknown as typeof fetch })).attempted).toBe(0);
    expect(await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, { secretsKey: KEY })).toMatchObject({ status: 409, body: { reason: "retired" } });
    const flow = (await handleProcessRoutes(env.DB, new URLSearchParams({ process: "ap" }))).body as { destinations: Array<{ id: string; status: string }> };
    expect(flow.destinations.find((d) => d.id === id)?.status).toBe("retired");
  });

  it("is refused while a rule in force sends invoices to it, naming the rule; an ended rule does not count", async () => {
    const id = await destination("Oracle push");
    await rule("r-1", "Germany to Oracle", { id: "r-1", version: 1, conditions: {}, actions: [{ type: "send_to_destination", params: { destination: id } }] });
    await rule("r-2", "Old rule", { id: "r-2", version: 1, conditions: {}, actions: [{ type: "send_to_destination", params: { destination: id } }] }, "2020-01-01T00:00:00Z");
    expect(await handleRetireDestination(env.DB, "u-dan", id)).toMatchObject({ status: 409, body: { reason: "rule_sends_here", rules: [{ id: "r-1", name: "Germany to Oracle" }] } });
  });

  it("does not retire the ERP CSV file, whose export screen is how its invoices leave", async () => {
    const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "ERP", connectorId: "erp-csv" });
    const id = (made.body as { id?: string }).id;
    if (id) expect(await handleRetireDestination(env.DB, "u-dan", id)).toMatchObject({ status: 409, body: { reason: "erp_csv" } });
    else {
      await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-ap', 'erp-csv', 'ap', 'ERP', 'active')").run();
      expect(await handleRetireDestination(env.DB, "u-dan", "erp-ap")).toMatchObject({ status: 409, body: { reason: "erp_csv" } });
    }
  });
});

/** **Deleting a Destination that has never sent — decision 0599.** */
describe("deleting a Destination that has never sent — decision 0599", () => {
  const exists = async (id: string) => (await env.DB.prepare("SELECT id FROM route_instances WHERE id = ?").bind(id).first()) !== null;
  const flow = async () => ((await handleProcessRoutes(env.DB, new URLSearchParams({ process: "ap" }))).body as { destinations: Array<{ id: string; neverSent: boolean }> }).destinations;

  it("deletes one that never sent, with its secrets, mapping and what was set aside, and says on the flow which may go", async () => {
    const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Mistake" });
    const id = (made.body as { id: string }).id;
    await handleSaveConnector(env.DB, "u-dan", id, { settings: { url: "https://erp.example/x", auth: { type: "bearer" } }, secret: "tok" }, KEY);
    await handleCopyOutboundMapping(env.DB, "u-dan", id);
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-a', '{}')").run();
    await env.DB.prepare("INSERT INTO destination_deliveries (instance_id, invoice_id, status, created_at) VALUES (?, 'inv-a', 'skipped', '2026-10-02')").bind(id).run();
    expect((await flow()).find((d) => d.id === id)?.neverSent).toBe(true);
    expect(await handleDeleteDestination(env.DB, id)).toEqual({ status: 200, body: { id, deleted: true } });
    expect(await exists(id)).toBe(false);
    for (const table of ["connector_secrets", "outbound_mapping_versions", "destination_deliveries"]) {
      expect((await env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE instance_id = ?`).bind(id).first<{ n: number }>())!.n, table).toBe(0);
    }
    expect(await handleDeleteDestination(env.DB, id)).toMatchObject({ status: 404 });
  });

  it("deletes a retired one that never sent, and says so on the flow — decision 0602", async () => {
    const id = ((await handleCreateDestination(env.DB, "u-dan", "ap", { name: "Partner HTTPS" })).body as { id: string }).id;
    await handleRetireDestination(env.DB, "u-dan", id);
    expect((await flow()).find((d) => d.id === id)).toMatchObject({ neverSent: true });
    expect(await handleDeleteDestination(env.DB, id)).toEqual({ status: 200, body: { id, deleted: true } });
    expect(await exists(id)).toBe(false);
  });

  it("refuses one that has sent or tried to, one a rule sent to or still sends to, one an alert watches, and the ERP CSV file", async () => {
    const sent = await destination("Sent");
    await openOutboundMessage(env.DB, { destinationId: sent, recipient: "erp.example", subject: "INV-A", bytes: 10, receivedAt: "2026-10-02T09:00:00Z", event: "sending" });
    expect((await flow()).find((d) => d.id === sent)?.neverSent).toBe(false);
    expect(await handleDeleteDestination(env.DB, sent)).toMatchObject({ status: 409, body: { reason: "has_sent" } });

    const asked = await destination("Asked");
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-b', '{}')").run();
    await env.DB.prepare("INSERT INTO destination_requests (invoice_id, instance_id, requested_at) VALUES ('inv-b', ?, '2026-10-02')").bind(asked).run();
    expect(await handleDeleteDestination(env.DB, asked)).toMatchObject({ status: 409, body: { reason: "rule_requested" } });

    const ruled = await destination("Ruled");
    await rule("r-1", "To Ruled", { id: "r-1", version: 1, conditions: {}, actions: [{ type: "send_to_destination", params: { destination: ruled } }] });
    expect(await handleDeleteDestination(env.DB, ruled)).toMatchObject({ status: 409, body: { reason: "rule_sends_here", rules: [{ name: "To Ruled" }] } });

    const watched = await destination("Watched");
    await env.DB.prepare("INSERT INTO route_alerts (id, instance_id, created_at) VALUES ('al-1', ?, '2026-10-02')").bind(watched).run();
    expect(await handleDeleteDestination(env.DB, watched)).toMatchObject({ status: 409, body: { reason: "has_alerts" } });

    await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES ('erp-ap', 'erp-csv', 'ap', 'ERP', 'active')").run();
    expect(await handleDeleteDestination(env.DB, "erp-ap")).toMatchObject({ status: 409, body: { reason: "not_https_out" } });
  });
});

describe("through the router", () => {
  it("renames and retires with PATCH, under Admin.Configure", async () => {
    const key = generateApiKey();
    await env.DB.prepare("UPDATE org_users SET api_key_hash = ? WHERE id = 'u-dan'").bind(await hashApiKey(key)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r', 'Role', ?)").bind(JSON.stringify(["Admin.Configure"])).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-dan', 'r')").run();
    const id = await destination("Oracle push");
    const patch = (body: unknown) =>
      worker.fetch(new Request(`https://vf.example/route-instances/${id}`, { method: "PATCH", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body) }), env as unknown as Env);
    expect(await (await patch({ name: "Renamed" })).json()).toEqual({ id, name: "Renamed" });
    expect(await (await patch({ status: "retired" })).json()).toEqual({ id, status: "retired" });
    const other = await destination("Another");
    const del = await worker.fetch(new Request(`https://vf.example/route-instances/${other}`, { method: "DELETE", headers: { Authorization: `Bearer ${key}` } }), env as unknown as Env);
    expect(await del.json()).toEqual({ id: other, deleted: true });
  });
});
