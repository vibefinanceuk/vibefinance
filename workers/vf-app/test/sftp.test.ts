import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import {
  checkSftpSettings,
  fileNameFor,
  globMatch,
  handleCollectNow,
  handleForgetSftpIdentity,
  handleGetSftp,
  handleSaveSftp,
  handleTestSftp,
  type SftpConnection,
  type SftpOp,
  type SftpRun,
} from "../src/sftp.js";
import { handleCreateDestination, handlePreviewDelivery, handleSendNow, handleStartDestination, runDeliveries } from "../src/destination-delivery.js";
import { connectorLibrary } from "../src/partner-library.js";

/**
 * **SFTP — decision 0620, the proof of concept.** SFTP out writes each
 * invoice's file into a folder; SFTP in collects files from one. The
 * SFTP itself is vf-sftp's (proved against a real SFTP server in its own
 * tests); here it is a server held in memory, answering as vf-sftp does.
 */

const KEY = btoa("k".repeat(32));
const IDENTITY = "SHA256:Q2xvdWRmbGFyZSBTRlRQIHRlc3Qgc2VydmVyIGtleQ";
const OTHER = "SHA256:U29tZW9uZSBlbHNlIGVudGlyZWx5IGRpZmZlcmVudA";

/** An SFTP server as vf-sftp answers for it: files in memory, a password, an identity. */
function fakeServer(opts: { identity?: string; password?: string; unreachable?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const folders = new Set(["/", "/to-erp", "/inbox"]);
  const calls: Array<{ connection: SftpConnection; ops: SftpOp[] }> = [];
  const identity = opts.identity ?? IDENTITY;
  const parent = (p: string) => p.replace(/\/[^/]+$/, "") || "/";
  const run: SftpRun = async (connection, ops) => {
    calls.push({ connection, ops });
    if (opts.unreachable) return { hostKey: null, error: { code: "connect_failed", message: `${connection.host}:22 could not be reached (ECONNREFUSED)` } };
    if (connection.hostKey && connection.hostKey !== identity) {
      return { hostKey: identity, error: { code: "host_key_changed", message: `${connection.host} showed a different identity (${identity})` } };
    }
    if (connection.password !== (opts.password ?? "s3cret")) return { hostKey: identity, error: { code: "auth_failed", message: `${connection.username} could not sign in` } };
    const results = [];
    let stopped = false;
    for (const op of ops) {
      if (stopped) {
        results.push({ ok: false, error: { code: "skipped", message: "not tried" } });
        continue;
      }
      const fail = (code: string, message: string) => {
        results.push({ ok: false, error: { code, message } });
        stopped = true;
      };
      if (op.op === "list") {
        if (!folders.has(op.path)) {
          fail("not_found", `listing ${op.path}: no such file or folder`);
          continue;
        }
        const prefix = op.path === "/" ? "/" : `${op.path}/`;
        const entries = [...files.keys()]
          .filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes("/"))
          .map((p) => ({ name: p.slice(prefix.length), size: files.get(p)!.length, modifiedAt: null, isFile: true }))
          .sort((a, b) => a.name.localeCompare(b.name));
        results.push({ ok: true, entries });
      } else if (op.op === "put") {
        if (files.has(op.path)) fail("exists", `${op.path} is already there, and is not overwritten`);
        else if (!folders.has(parent(op.path))) fail("not_found", `writing ${op.path}: no such folder`);
        else {
          files.set(op.path, Uint8Array.from(atob(op.contentBase64), (c) => c.charCodeAt(0)));
          results.push({ ok: true, path: op.path, bytes: files.get(op.path)!.length });
        }
      } else if (op.op === "ensureDir") {
        folders.add(op.path);
        results.push({ ok: true, path: op.path });
      } else if (op.op === "move") {
        if (!files.has(op.from)) fail("not_found", `moving ${op.from}: no such file`);
        else if (files.has(op.to)) fail("exists", `${op.to} is already there`);
        else {
          files.set(op.to, files.get(op.from)!);
          files.delete(op.from);
          results.push({ ok: true });
        }
      } else if (op.op === "get") {
        const f = files.get(op.path);
        if (!f) fail("not_found", `reading ${op.path}: no such file`);
        else results.push({ ok: true, path: op.path, bytes: f.length, contentBase64: btoa(String.fromCharCode(...f)) });
      }
    }
    return { hostKey: identity, results };
  };
  return { run, files, folders, calls };
}

const UBL = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>88240</cbc:ID>
  <cbc:IssueDate>2026-09-29</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyTaxScheme><cbc:CompanyID>DE812345678</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Lager Nord GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">738.99</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`;

const model = { extract: async () => ({}) } as never;
const bytes = (text: string) => new TextEncoder().encode(text);

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.example', 'Dan Young')").run();
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await seedStage("ap-intake", "ap", "Intake", 1);
  await seedStage("ap-eligible", "ap", "Payment Eligible", 2);
  await env.DB.prepare("INSERT INTO suppliers (id, name, erp_identifier) VALUES ('sup-1', 'Lager Nord GmbH', '17300032')").run();
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES ('inv-a', json_set(?1, '$.BT-1', 'RE-4417'), 'sup-1')")
    .bind(JSON.stringify({ "BT-1": "RE-4417", "BT-2": "2026-09-29", "BT-5": "EUR", "BT-112": 357 }))
    .run();
  await env.DB.prepare("INSERT INTO invoice_lines (invoice_id, line_number, facts_json) VALUES ('inv-a', 1, ?)")
    .bind(JSON.stringify({ "BT-153": "Palettenregale", "BT-131": 300, "BT-129": 10, "coding.gl_code": "61000000" }))
    .run();
  await env.DB.prepare("INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-a', 'ap', 'invoice', 'inv-a', 'ap-eligible', 'in_progress')").run();
});

/** Decision 0621: SFTP out is planned in the library until the container runs; these tests add it as available, as it was built. */
async function sftpAvailable() {
  return (await connectorLibrary(env.DB)).map((c) => (c.id === "sftp-out" ? { ...c, status: "available" as const } : c));
}

async function addSftpOut(server = fakeServer()) {
  const made = await handleCreateDestination(env.DB, "u-dan", "ap", { name: "ERP drop", connectorId: "sftp-out" }, await sftpAvailable());
  expect(made.status).toBe(201);
  const id = (made.body as { id: string }).id;
  const saved = await handleSaveSftp(env.DB, "u-dan", id, { settings: { host: "sftp.acme.example", username: "vibefinance", folder: "/to-erp", format: "csv" }, secret: "s3cret" }, KEY);
  expect(saved.status).toBe(200);
  return { id, server };
}

describe("settings, in words", () => {
  it("checks the server, user, folder, file name and what to collect", () => {
    expect(checkSftpSettings({ host: "sftp://x.example", username: "u" }, "out", null)).toMatchObject({ reason: "bad_host" });
    expect(checkSftpSettings({ host: "x.example", username: "u", port: 70000 }, "out", null)).toMatchObject({ reason: "bad_port" });
    expect(checkSftpSettings({ host: "x.example" }, "out", null)).toMatchObject({ reason: "no_username" });
    expect(checkSftpSettings({ host: "x.example", username: "u", folder: "/a/../../etc" }, "out", null)).toMatchObject({ reason: "bad_folder" });
    expect(checkSftpSettings({ host: "x.example", username: "u", filename: "export.csv" }, "out", null)).toMatchObject({ reason: "filename_not_unique" });
    expect(checkSftpSettings({ host: "x.example", username: "u", folder: "/in", doneFolder: "/in" }, "in", null)).toMatchObject({ reason: "done_is_folder" });
    expect(checkSftpSettings({ host: " x.example ", username: "u", folder: "to-erp/" }, "out", null)).toMatchObject({
      settings: { host: "x.example", port: 22, folder: "/to-erp", format: "csv", filename: "{invoiceNumber}.{ext}", hostKey: null },
    });
  });

  it("keeps the server's identity while the host and port stay, and forgets it when they change", () => {
    const current = { host: "x.example", port: 22, username: "u", auth: "password" as const, folder: "/", hostKey: IDENTITY };
    expect((checkSftpSettings({ host: "x.example", username: "v" }, "out", current) as { settings: { hostKey: string | null } }).settings.hostKey).toBe(IDENTITY);
    expect((checkSftpSettings({ host: "y.example", username: "u" }, "out", current) as { settings: { hostKey: string | null } }).settings.hostKey).toBeNull();
    expect((checkSftpSettings({ host: "x.example", port: 2222, username: "u" }, "out", current) as { settings: { hostKey: string | null } }).settings.hostKey).toBeNull();
  });

  it("matches files by * and ?, and names each invoice's file safely", () => {
    expect(globMatch("*.xml", "Rechnung_88240.xml")).toBe(true);
    expect(globMatch("*.xml", "88240.xml.part")).toBe(false);
    expect(globMatch("RE-????.csv", "RE-4417.csv")).toBe(true);
    expect(globMatch("*", "anything")).toBe(true);
    expect(fileNameFor("{invoiceNumber}_{date}.{ext}", { invoiceNumber: "RE/4417 A", invoiceId: "inv-a", date: "2026-10-03", ext: "csv" })).toBe("RE_4417_A_2026-10-03.csv");
  });
});

describe("SFTP out — decision 0620", () => {
  it("is added from the Route library, paused, and its password kept encrypted", async () => {
    const { id } = await addSftpOut();
    const got = (await handleGetSftp(env.DB, id)).body as { instance: { routeId: string; status: string }; settings: Record<string, unknown>; secrets: Record<string, string> };
    expect(got.instance).toMatchObject({ routeId: "sftp-out", status: "paused" });
    expect(got.settings).toMatchObject({ host: "sftp.acme.example", username: "vibefinance", folder: "/to-erp", hostKey: null });
    expect(Object.keys(got.secrets)).toEqual(["password"]);
    const stored = await env.DB.prepare("SELECT value_enc FROM connector_secrets WHERE instance_id = ?").bind(id).first<{ value_enc: string }>();
    expect(stored?.value_enc).not.toContain("s3cret");
  });

  it("keeps the server's identity on the first test, and refuses a server showing another after", async () => {
    const { id, server } = await addSftpOut();
    const first = (await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: server.run })).body;
    expect(first).toMatchObject({ ok: true, hostKey: IDENTITY, kept: true, folder: "/to-erp", files: 0 });
    expect(server.calls[0].connection).toMatchObject({ host: "sftp.acme.example", port: 22, username: "vibefinance", password: "s3cret", hostKey: null });

    const impostor = fakeServer({ identity: OTHER });
    const second = (await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: impostor.run })).body;
    expect(second).toMatchObject({ ok: false, code: "host_key_changed", hostKey: OTHER, trusted: IDENTITY });
    expect(impostor.calls[0].connection.hostKey).toBe(IDENTITY);

    await handleForgetSftpIdentity(env.DB, id);
    expect((await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: impostor.run })).body).toMatchObject({ ok: true, hostKey: OTHER, kept: true });
  });

  it("says a refused password, a server out of reach, and SFTP not set up", async () => {
    const { id } = await addSftpOut();
    expect((await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: fakeServer({ password: "other" }).run })).body).toMatchObject({ ok: false, code: "auth_failed" });
    expect((await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: fakeServer({ unreachable: true }).run })).body).toMatchObject({ ok: false, code: "connect_failed" });
    const none = await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: null });
    expect(none.status).toBe(503);
    expect(none.body).toMatchObject({ code: "runner_unavailable" });
  });

  it("previews the file and where it would go, and sends nothing until a test has kept the server's identity", async () => {
    const { id, server } = await addSftpOut();
    const preview = (await handlePreviewDelivery(env.DB, id, { invoiceId: "inv-a" })).body as { method: string; url: string; body: string };
    expect(preview).toMatchObject({ method: "SFTP", url: "sftp://vibefinance@sftp.acme.example/to-erp/RE-4417.csv" });
    expect(preview.body).toContain("RE-4417");

    const untested = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, { secretsKey: KEY, sftp: server.run })).body;
    expect(untested).toMatchObject({ status: "retrying", error: "test the connection first, to confirm the server's identity" });
    expect(server.files.size).toBe(0);
    expect((await handleStartDestination(env.DB, id, {})).body).toMatchObject({ reason: "not_tested" });
  });

  it("writes the invoice's file into the folder, keeps its path as the reference, and keeps the file sent", async () => {
    const { id, server } = await addSftpOut();
    await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: server.run });
    const sent = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, { secretsKey: KEY, sftp: server.run, bucket: env.DOCUMENTS, customerId: "acme" })).body as {
      status: string;
      reference: string;
      messageId: string;
    };
    expect(sent).toMatchObject({ status: "delivered", reference: "/to-erp/RE-4417.csv" });
    const written = new TextDecoder().decode(server.files.get("/to-erp/RE-4417.csv"));
    expect(written).toContain("RE-4417");
    expect(written).toContain("61000000");
    const put = server.calls.at(-1)!;
    expect(put.connection.hostKey).toBe(IDENTITY);
    expect(put.ops).toEqual([{ op: "put", path: "/to-erp/RE-4417.csv", contentBase64: expect.any(String) }]);

    const parts = (await env.DB.prepare("SELECT role, filename FROM route_message_parts WHERE message_id = ?").bind(sent.messageId).all()).results;
    expect(parts).toEqual([{ role: "sent", filename: "file-1.csv" }]);
    const events = (await env.DB.prepare("SELECT event, detail FROM route_message_events WHERE message_id = ? ORDER BY seq").bind(sent.messageId).all<{ event: string; detail: string }>()).results;
    expect(events.find((e) => e.event === "attempt")?.detail).toBe("1: file written");
    expect(events.find((e) => e.event === "reference")?.detail).toBe("/to-erp/RE-4417.csv");
  });

  it("never writes over a file already there: it fails for a person to look at, not tried again", async () => {
    const { id, server } = await addSftpOut();
    await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: server.run });
    server.files.set("/to-erp/RE-4417.csv", bytes("someone else's"));
    const sent = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, { secretsKey: KEY, sftp: server.run })).body;
    expect(sent).toMatchObject({ status: "failed", error: "/to-erp/RE-4417.csv is already there, and is not overwritten" });
    expect(new TextDecoder().decode(server.files.get("/to-erp/RE-4417.csv"))).toBe("someone else's");
  });

  it("is tried again when the server cannot be reached, and sent by the five-minute sweep once started", async () => {
    const { id, server } = await addSftpOut();
    await handleTestSftp(env.DB, id, { secretsKey: KEY, sftp: server.run });
    const away = (await handleSendNow(env.DB, "u-dan", id, { invoiceId: "inv-a" }, { secretsKey: KEY, sftp: fakeServer({ unreachable: true }).run })).body;
    expect(away).toMatchObject({ status: "retrying" });

    await env.DB.prepare("DELETE FROM destination_deliveries").run();
    expect((await handleStartDestination(env.DB, id, { includeWaiting: true })).body).toMatchObject({ status: "active", waiting: 1 });
    const swept = await runDeliveries(env.DB, { secretsKey: KEY, sftp: server.run });
    expect(swept.attempted).toBe(1);
    expect(server.files.has("/to-erp/RE-4417.csv")).toBe(true);
  });
});

describe("SFTP in, collecting — decision 0620", () => {
  async function addSftpIn() {
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism) VALUES ('src-sftp', 'ap', 'Scanning bureau', 'sftp')").run();
    await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('src-sftp', 'sftp-in', 'ap', 'src-sftp')").run();
    const saved = await handleSaveSftp(env.DB, "u-dan", "src-sftp", { settings: { host: "sftp.bureau.example", username: "acme", folder: "/inbox", pattern: "*.xml" }, secret: "s3cret" }, KEY);
    expect(saved.status).toBe(200);
  }

  it("tests the folder and says how many files are waiting", async () => {
    await addSftpIn();
    const server = fakeServer();
    server.files.set("/inbox/Rechnung_88240.xml", bytes(UBL));
    server.files.set("/inbox/readme.txt", bytes("hello"));
    const tested = (await handleTestSftp(env.DB, "src-sftp", { secretsKey: KEY, sftp: server.run })).body;
    expect(tested).toMatchObject({ ok: true, kept: true, files: 2, waiting: 1, sample: ["Rechnung_88240.xml"] });
    expect((await handleGetSftp(env.DB, "src-sftp")).body).toMatchObject({ instance: { routeId: "sftp-in", direction: "in", name: "Scanning bureau" }, doneFolder: "/inbox/processed" });
  });

  it("collects each waiting file, moving it to the done folder first, and reads it as an invoice", async () => {
    await addSftpIn();
    const server = fakeServer();
    server.files.set("/inbox/Rechnung_88240.xml", bytes(UBL));
    server.files.set("/inbox/readme.txt", bytes("not an invoice"));
    await handleTestSftp(env.DB, "src-sftp", { secretsKey: KEY, sftp: server.run });

    const collected = (await handleCollectNow(env.DB, "u-dan", "src-sftp", { secretsKey: KEY, sftp: server.run, model, bucket: env.DOCUMENTS, customerId: "acme" })).body as {
      matching: number;
      collected: Array<{ file: string; status: string; movedTo: string; messageId: string; invoiceIds: string[] }>;
      left: number;
    };
    expect(collected).toMatchObject({ matching: 1, left: 0, collected: [{ file: "Rechnung_88240.xml", status: "collected", movedTo: "/inbox/processed/Rechnung_88240.xml" }] });
    expect(collected.collected[0].invoiceIds).toHaveLength(1);
    // Moved, so never taken twice; the readme was never touched.
    expect([...server.files.keys()].sort()).toEqual(["/inbox/processed/Rechnung_88240.xml", "/inbox/readme.txt"]);

    const message = await env.DB.prepare("SELECT instance_id, direction, counterparty, recipient, subject, status FROM route_messages WHERE id = ?").bind(collected.collected[0].messageId).first();
    expect(message).toEqual({ instance_id: "src-sftp", direction: "in", counterparty: "acme@sftp.bureau.example", recipient: "Scanning bureau", subject: "Rechnung_88240.xml", status: "delivered" });
    const event = await env.DB.prepare("SELECT detail FROM route_message_events WHERE message_id = ? AND event = 'sftp_collected'").bind(collected.collected[0].messageId).first<{ detail: string }>();
    expect(event?.detail).toBe("/inbox/Rechnung_88240.xml → /inbox/processed/Rechnung_88240.xml");
    const invoice = await env.DB.prepare("SELECT invoice_number FROM invoice_headers WHERE id = ?").bind(collected.collected[0].invoiceIds[0]).first<{ invoice_number: string }>();
    expect(invoice?.invoice_number).toBe("88240");

    const again = (await handleCollectNow(env.DB, "u-dan", "src-sftp", { secretsKey: KEY, sftp: server.run, model })).body;
    expect(again).toMatchObject({ matching: 0, collected: [] });
  });

  it("keeps a file of a name collected before beside it, and says a file it cannot read", async () => {
    await addSftpIn();
    const server = fakeServer();
    server.folders.add("/inbox/processed");
    server.files.set("/inbox/processed/88240.xml", bytes(UBL));
    server.files.set("/inbox/88240.xml", bytes("<Not an invoice/>"));
    await handleTestSftp(env.DB, "src-sftp", { secretsKey: KEY, sftp: server.run });
    const out = (await handleCollectNow(env.DB, "u-dan", "src-sftp", { secretsKey: KEY, sftp: server.run, model })).body as {
      collected: Array<{ status: string; movedTo: string; reason: string }>;
    };
    expect(out.collected[0].movedTo).toMatch(/^\/inbox\/processed\/\d{4}-\d{2}-\d{2}T.*-88240\.xml$/);
    expect(out.collected[0].status).toBe("unreadable");
    expect(server.files.get("/inbox/processed/88240.xml")).toEqual(bytes(UBL));
  });

  it("collects nothing until a test has kept the server's identity", async () => {
    await addSftpIn();
    const server = fakeServer();
    server.files.set("/inbox/a.xml", bytes(UBL));
    const out = await handleCollectNow(env.DB, "u-dan", "src-sftp", { secretsKey: KEY, sftp: server.run, model });
    expect(out).toMatchObject({ status: 409, body: { reason: "not_tested" } });
    expect(server.calls).toHaveLength(0);
  });
});

describe("the routes — decision 0620", () => {
  it("need Admin.Configure to change or test, and the Route monitor may look and collect", async () => {
    const person = async (permissions: string[]) => {
      const id = crypto.randomUUID();
      const key = generateApiKey();
      await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, 'P', ?)").bind(id, `${id}@acme.example`, await hashApiKey(key)).run();
      await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(id, id, JSON.stringify(permissions)).run();
      await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, id).run();
      return key;
    };
    const { id } = await addSftpOut();
    const monitor = await person(["Integration.Monitor"]);
    const admin = await person(["Admin.Configure"]);
    const call = (path: string, key: string, init: RequestInit = {}) =>
      worker.fetch(new Request(`https://vf.example${path}`, { ...init, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" } }), {
        ...env,
        CONNECTOR_SECRETS_KEY: KEY,
      } as unknown as Env);
    expect((await call(`/route-instances/${id}/sftp`, monitor)).status).toBe(200);
    expect((await call(`/route-instances/${id}/sftp`, monitor, { method: "PUT", body: "{}" })).status).toBe(403);
    expect((await call(`/route-instances/${id}/sftp/test`, monitor, { method: "POST" })).status).toBe(403);
    // No vf-sftp bound in tests: said, not broken.
    const test = await call(`/route-instances/${id}/sftp/test`, admin, { method: "POST" });
    expect(test.status).toBe(503);
    expect(await test.json()).toMatchObject({ code: "runner_unavailable" });
  });
});
