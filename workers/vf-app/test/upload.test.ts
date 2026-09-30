import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import {
  handleFinishUpload,
  handleOpenUpload,
  handleUploadFile,
  handleUploadTargets,
  uploadType,
} from "../src/upload-route.js";
import { handleGetRouteMessage } from "../src/route-monitor-route.js";
import { handleGetActivity } from "../src/activity-route.js";
import { receivedFiles } from "../src/received-files.js";

/**
 * **Create → Upload documents — decision 0573.** An upload is a route
 * message on an AP upload source, each file a part read as an email
 * attachment is, so it shows in the Route monitor and on each invoice's
 * Timeline and Attachments tab.
 */

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const UBL = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>88240</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>GBP</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Lager Nord GmbH</cbc:Name></cac:PartyName>
    <cac:PartyTaxScheme><cbc:CompanyID>DE812345678</cbc:CompanyID></cac:PartyTaxScheme>
    <cac:PartyLegalEntity><cbc:RegistrationName>Lager Nord GmbH</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="GBP">100.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`);
const DAN = { id: "u-dan", name: "Dan Young", email: "dan@acme.example" };
const PRIYA = { id: "u-priya", name: "Priya Patel", email: "priya@acme.example" };

const model = {
  extract: vi.fn(async () =>
    JSON.stringify({ invoiceNumber: "INV-7", issueDate: "2026-09-01", currency: "EUR", supplierName: "Munch GmbH", totalWithVat: 100, _confidence: 0.9 })
  ),
} as never;

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'Standard AP Process')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO intake_channels (id, process_id, name) VALUES ('ch-upload', 'ap', 'Upload')").run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('ou-uk', 'Acme UK Ltd')").run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism, default_org_unit_id) VALUES ('upload-ap', 'ap', 'AP upload', 'file_import', 'ou-uk'), ('s-mail', 'ap', 'AP mailbox', 'email', NULL)"
  ).run();
  await env.DB.prepare(
    "INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('upload-ap', 'file-import', 'ap', 'upload-ap'), ('s-mail', 'email-in', 'ap', 's-mail')"
  ).run();
  for (const p of [DAN, PRIYA]) {
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(p.id, p.email, p.name).run();
  }
});

const deps = () => ({ model, bucket: env.DOCUMENTS, customerId: "acme" });

describe("the AP upload route (migration 0114)", () => {
  it("is live, named AP upload, and lists its sources with process and company", async () => {
    const route = await env.DB.prepare(
      "SELECT r.name, v.status FROM routes r JOIN route_versions v ON v.route_id = r.id WHERE r.id = 'file-import'"
    ).first<{ name: string; status: string }>();
    expect(route).toEqual({ name: "AP upload", status: "live" });

    const result = await handleUploadTargets(env.DB);
    expect(result.body).toEqual({
      targets: [{ id: "upload-ap", name: "AP upload", processId: "ap", processName: "Standard AP Process", orgName: "Acme UK Ltd" }],
      maxFiles: 50,
      maxBytes: 15 * 1024 * 1024,
    });
  });

  it("knows a file's type from its name before what the browser said", () => {
    expect(uploadType("88240.xml", "application/octet-stream")).toBe("application/xml");
    expect(uploadType("rows.CSV", "")).toBe("text/csv");
    expect(uploadType("scan", "image/png")).toBe("image/png");
    expect(uploadType("notes.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBeNull();
    expect(uploadType("page.html", "text/html")).toBeNull();
  });
});

describe("an upload, file by file", () => {
  it("reads each file into an invoice, as email does, and closes as partial when one was refused", async () => {
    const opened = await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", files: 3 });
    expect(opened.status).toBe(201);
    const { messageId } = opened.body as { messageId: string };
    expect(messageId).toMatch(/^MSG-/);

    // An XML file the browser called bytes: known by its name, read as data.
    const pdf = await handleUploadFile(env.DB, DAN, messageId, { filename: "Rechnung_88240.xml", contentType: "application/octet-stream", bytes: UBL }, deps());
    expect(pdf.body).toMatchObject({
      seq: 1,
      filename: "Rechnung_88240.xml",
      captured: true,
      invoice: { number: "88240", seller: "Lager Nord GmbH", total: 100, currency: "GBP", stage: "Received" },
    });
    const invoiceId = (pdf.body as { invoice: { id: string } }).invoice.id;

    const png = await handleUploadFile(env.DB, DAN, messageId, { filename: "IMG_2208.png", contentType: "", bytes: PNG }, deps());
    expect(png.body).toMatchObject({ seq: 2, captured: true });

    const word = await handleUploadFile(env.DB, DAN, messageId, { filename: "notes.docx", contentType: "application/octet-stream", bytes: PDF }, deps());
    expect(word.body).toEqual({
      seq: 3,
      filename: "notes.docx",
      captured: false,
      why: "this is not a type an invoice arrives as: send a PDF, an image, XML or CSV",
    });

    const finished = await handleFinishUpload(env.DB, DAN, messageId);
    expect(finished.body).toEqual({ messageId, captured: 2, failed: 1 });

    // The Route monitor sees it: from Dan, on AP upload, partial, with both files kept.
    const row = await env.DB.prepare("SELECT status, counterparty, subject, bytes, instance_id FROM route_messages WHERE id = ?").bind(messageId).first();
    expect(row).toEqual({
      status: "partial",
      counterparty: "Dan Young <dan@acme.example>",
      subject: "Upload of 3 files",
      bytes: UBL.length + PNG.length,
      instance_id: "upload-ap",
    });
    const detail = (await handleGetRouteMessage(env.DB, messageId)).body as { events: { event: string; actorName: string | null }[] };
    expect(detail.events.filter((e) => e.actorName === "Dan Young").map((e) => e.event)).toEqual(["upload_opened", "upload_refused", "upload_finished"]);

    // The invoice's Timeline names the upload, and its Attachments tab has the file.
    const activity = (await handleGetActivity(env.DB, invoiceId)).body as { items: Record<string, unknown>[] };
    expect(activity.items.find((i) => i.kind === "received")).toMatchObject({
      messageId,
      source: "AP upload",
      sender: "Dan Young <dan@acme.example>",
      filename: "Rechnung_88240.xml",
    });
    const files = await receivedFiles(env.DB, invoiceId);
    expect(files.map((f) => [f.filename, f.thisInvoice])).toEqual([
      ["Rechnung_88240.xml", true],
      ["IMG_2208.png", false],
    ]);
  });

  it("closes as failed when nothing was read", async () => {
    const { messageId } = (await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", files: 1 })).body as { messageId: string };
    await handleUploadFile(env.DB, DAN, messageId, { filename: "empty.pdf", contentType: "application/pdf", bytes: new Uint8Array() }, deps());
    await handleFinishUpload(env.DB, DAN, messageId);
    const row = await env.DB.prepare("SELECT status, failed_part, error_code FROM route_messages WHERE id = ?").bind(messageId).first();
    expect(row).toEqual({ status: "failed", failed_part: "translation", error_code: "unreadable" });
  });

  it("is only the uploader's, only while open, and only to an upload source", async () => {
    const { messageId } = (await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", files: 1 })).body as { messageId: string };
    expect((await handleUploadFile(env.DB, PRIYA, messageId, { filename: "a.pdf", contentType: "application/pdf", bytes: PDF }, deps())).status).toBe(404);
    await handleFinishUpload(env.DB, DAN, messageId);
    expect((await handleUploadFile(env.DB, DAN, messageId, { filename: "a.pdf", contentType: "application/pdf", bytes: PDF }, deps())).status).toBe(409);
    expect((await handleFinishUpload(env.DB, DAN, messageId)).status).toBe(409);

    expect((await handleOpenUpload(env.DB, DAN, { sourceId: "s-mail", files: 1 })).status).toBe(404);
    expect((await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", files: 51 })).status).toBe(400);
    expect((await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", files: 0 })).status).toBe(400);
    await env.DB.prepare("UPDATE sources SET status = 'retired' WHERE id = 'upload-ap'").run();
    expect((await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", files: 1 })).status).toBe(409);
  });
});

describe("the upload routes need AP.Create", () => {
  async function keyWith(permissions: string[]) {
    const id = crypto.randomUUID();
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, 'Someone', ?)")
      .bind(id, `${id}@acme.example`, await hashApiKey(apiKey))
      .run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, 'Role', ?)").bind(id, JSON.stringify(permissions)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, id).run();
    return apiKey;
  }

  it("refuses without it, and opens an upload with it", async () => {
    expect((await SELF.fetch("https://example.com/uploads/targets")).status).toBe(401);
    const validator = await keyWith(["AP.Validate"]);
    expect((await SELF.fetch("https://example.com/uploads/targets", { headers: { Authorization: `Bearer ${validator}` } })).status).toBe(403);

    const creator = await keyWith(["AP.Create"]);
    const targets = await SELF.fetch("https://example.com/uploads/targets", { headers: { Authorization: `Bearer ${creator}` } });
    expect(targets.status).toBe(200);
    const opened = await SELF.fetch("https://example.com/uploads", {
      method: "POST",
      headers: { Authorization: `Bearer ${creator}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sourceId: "upload-ap", files: 1 }),
    });
    expect(opened.status).toBe(201);
    const { messageId } = (await opened.json()) as { messageId: string };
    const finished = await SELF.fetch(`https://example.com/uploads/${messageId}/finish`, {
      method: "POST",
      headers: { Authorization: `Bearer ${creator}` },
    });
    expect(await finished.json()).toEqual({ messageId, captured: 0, failed: 0 });
  });
});
