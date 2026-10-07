import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { TEMPLATE_COLUMNS } from "@vibefinance/shared";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { handleBatchPreview } from "../src/batch-route.js";
import { handleFinishUpload, handleOpenUpload, handleUploadBatchChunk, handleBatchMappings } from "../src/upload-route.js";
import { handleGetActivity } from "../src/activity-route.js";

/**
 * **Create → Batch upload — decision 0576.** A file read into invoices
 * before anything is made; then the ready ones made a few at a time into
 * one upload, the file kept once.
 */

const DAN = { id: "u-dan", name: "Dan Young", email: "dan@acme.example" };
const HEADER = TEMPLATE_COLUMNS.map((c) => c.name).join(",");
const row = (v: Record<string, string>) => TEMPLATE_COLUMNS.map((c) => v[c.name] ?? "").join(",");
const base = { issue_date: "2026-09-30", currency: "EUR", supplier_name: "Hanse Logistik", supplier_vat: "DE999", quantity: "1", vat_rate: "19" };
const bytes = (text: string) => new TextEncoder().encode(text);
const model = { extract: async () => "{}" } as never;
const deps = () => ({ model, bucket: env.DOCUMENTS, customerId: "acme" });

const FILE = [
  HEADER,
  row({ ...base, invoice_number: "STMT-09", line_description: "Delivery 1", unit_price: "100.00" }),
  row({ ...base, invoice_number: "STMT-09", line_description: "Delivery 2", unit_price: "50.00" }),
  row({ ...base, invoice_number: "88240", supplier_name: "Lager Nord GmbH", supplier_vat: "DE812345678", line_description: "Regal", unit_price: "621.00" }),
  row({ ...base, invoice_number: "7781", line_description: "Pallet", unit_price: "81.01" }),
  row({ ...base, invoice_number: "INV-5530", line_description: "x", unit_price: "1", vat_rate: "" }),
].join("\n");

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
    "INSERT INTO sources (id, process_id, name, mechanism, default_org_unit_id) VALUES ('upload-ap', 'ap', 'AP upload', 'file_import', 'ou-uk')"
  ).run();
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('upload-ap', 'file-import', 'ap', 'upload-ap')").run();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)").bind(DAN.id, DAN.email, DAN.name).run();
  // 7781 from Hanse Logistik was received on 12 September.
  await env.DB.prepare(
    "INSERT INTO invoice_headers (id, facts_json, created_at) VALUES ('inv-old', json_set('{\"BT-27\":\"Hanse Logistik\"}', '$.BT-1', '7781', '$.BT-31', 'DE999'), '2026-09-12 10:00:00')"
  ).run();
});

describe("the preview reads the file and keeps nothing", () => {
  it("finds each invoice, what is wrong by row, and what may already have been received", async () => {
    const result = await handleBatchPreview(env.DB, { kind: "template" }, "batch_september.csv", bytes(FILE));
    const body = result.body as {
      rows: number;
      layout: string;
      counts: Record<string, number>;
      invoices: Array<{ number: string; supplier: string; lines: number; total: number; status: string; problems: string[]; duplicateOf: { number: string } | null }>;
      problemsCsv: string;
    };
    expect(body).toMatchObject({ rows: 5, layout: "VibeFinance template", counts: { ready: 2, duplicate: 1, problem: 1 } });
    expect(body.invoices.map((i) => [i.number, i.supplier, i.lines, i.total, i.status])).toEqual([
      ["STMT-09", "Hanse Logistik", 2, 178.5, "ready"],
      ["88240", "Lager Nord GmbH", 1, 738.99, "ready"],
      ["7781", "Hanse Logistik", 1, 96.4, "duplicate"],
      ["INV-5530", "Hanse Logistik", 0, null, "problem"],
    ]);
    expect(body.invoices[2].duplicateOf).toMatchObject({ number: "7781", receivedAt: "2026-09-12 10:00:00" });
    expect(body.invoices[3].problems).toEqual(["Row 6: no VAT rate"]);
    expect(body.problemsCsv).toBe("row,invoice_number,problem\r\n6,INV-5530,Row 6: no VAT rate\r\n");
    const kept = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>();
    expect(kept?.n).toBe(1);
  });

  it("reads an XML invoice for the preview, and says what a supplier's own XML needs", async () => {
    const ubl = `<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"><cbc:ID>88241</cbc:ID><cbc:IssueDate>2026-09-29</cbc:IssueDate><cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity><cbc:RegistrationName>Lager Nord GmbH</cbc:RegistrationName></cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty><cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">1420.50</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal></Invoice>`;
    const read = (await handleBatchPreview(env.DB, { kind: "xml" }, "88241.xml", bytes(ubl))).body as { invoices: Array<Record<string, unknown>> };
    expect(read.invoices[0]).toMatchObject({ number: "88241", supplier: "Lager Nord GmbH", total: 1420.5, status: "ready" });
    const own = (await handleBatchPreview(env.DB, { kind: "xml" }, "r.xml", bytes("<Rechnung><Nr>1</Nr></Rechnung>"))).body as { invoices: Array<{ status: string; problems: string[] }> };
    expect(own.invoices[0].status).toBe("problem");
    expect(own.invoices[0].problems[0]).toContain("Use Upload documents for a supplier's own XML");
  });
});

describe("making a batch, a few at a time", () => {
  it("makes the ready invoices in chunks into one upload, the file kept once, and leaves out the possible duplicate", async () => {
    const { messageId } = (await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", kind: "batch", files: 1 })).body as { messageId: string };
    const file = { filename: "batch_september.csv", bytes: bytes(FILE) };
    const first = await handleUploadBatchChunk(env.DB, DAN, messageId, { kind: "template" }, file, { from: 0, count: 1, duplicates: false }, deps());
    expect(first.body).toMatchObject({ total: 2, from: 0, made: [{ number: "STMT-09" }], failed: [] });
    const second = await handleUploadBatchChunk(env.DB, DAN, messageId, { kind: "template" }, file, { from: 1, count: 1, duplicates: false }, deps());
    expect(second.body).toMatchObject({ total: 2, made: [{ number: "88240" }] });
    // The same chunk again makes nothing new.
    const again = await handleUploadBatchChunk(env.DB, DAN, messageId, { kind: "template" }, file, { from: 1, count: 1, duplicates: false }, deps());
    expect(again.body).toMatchObject({ made: [{ number: "88240", invoiceId: (second.body as { made: Array<{ invoiceId: string }> }).made[0].invoiceId }] });
    expect((await handleFinishUpload(env.DB, DAN, messageId)).body).toEqual({ messageId, captured: 2, failed: 0 });

    const parts = await env.DB.prepare("SELECT seq, filename, content_type, outcome FROM route_message_parts WHERE message_id = ?").bind(messageId).all();
    expect(parts.results).toEqual([{ seq: 1, filename: "batch_september.csv", content_type: "text/csv", outcome: "captured" }]);
    const message = await env.DB.prepare("SELECT status, subject FROM route_messages WHERE id = ?").bind(messageId).first();
    expect(message).toEqual({ status: "delivered", subject: "Batch upload of 1 file" });

    const stmtId = (first.body as { made: Array<{ invoiceId: string }> }).made[0].invoiceId;
    const stmt = await env.DB.prepare("SELECT facts_json, org_unit_id, invoice_number, total_with_vat FROM invoice_headers WHERE id = ?")
      .bind(stmtId)
      .first<{ facts_json: string; org_unit_id: string; invoice_number: string; total_with_vat: number }>();
    expect(stmt).toMatchObject({ org_unit_id: "ou-uk", invoice_number: "STMT-09", total_with_vat: 178.5 });
    expect(JSON.parse(stmt!.facts_json)).toMatchObject({ "BT-27": "Hanse Logistik", "BT-106": 150, "intake.format": "vibefinance_csv" });
    const lines = await env.DB.prepare("SELECT count(*) AS n FROM invoice_lines WHERE invoice_id = ?").bind(stmtId).first<{ n: number }>();
    expect(lines?.n).toBe(2);

    // Its original is the whole file, kept once; its table is its own rows.
    const docs = await env.DB.prepare("SELECT document_type, r2_key, route_message_id, part_seq FROM invoice_documents WHERE invoice_id = ? ORDER BY document_type")
      .bind(stmtId)
      .all<{ document_type: string; r2_key: string; route_message_id: string | null; part_seq: number | null }>();
    const original = docs.results.find((d) => d.document_type === "original");
    expect(original).toMatchObject({ route_message_id: messageId, part_seq: 1 });
    const rendering = docs.results.find((d) => d.document_type === "generated_rendering");
    const html = await (await env.DOCUMENTS.get(rendering!.r2_key))!.text();
    expect(html).toContain("Delivery 2");
    expect(html).not.toContain("Regal");

    const activity = (await handleGetActivity(env.DB, stmtId)).body as { items: Record<string, unknown>[] };
    expect(activity.items.find((i) => i.kind === "received")).toMatchObject({ messageId, source: "AP upload", filename: "batch_september.csv" });
  });

  it("makes the possible duplicate too when asked, and refuses a file with a problem in its columns", async () => {
    const { messageId } = (await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", kind: "batch", files: 1 })).body as { messageId: string };
    const made = await handleUploadBatchChunk(env.DB, DAN, messageId, { kind: "template" }, { filename: "b.csv", bytes: bytes(FILE) }, { from: 0, count: 20, duplicates: true }, deps());
    expect((made.body as { made: Array<{ number: string }> }).made.map((m) => m.number)).toEqual(["STMT-09", "88240", "7781"]);

    const bad = await handleUploadBatchChunk(env.DB, DAN, messageId, { kind: "template" }, { filename: "b.csv", bytes: bytes("a,b\n1,2") }, { from: 0, count: 20, duplicates: false }, deps());
    expect(bad.status).toBe(422);
  });
});

describe("a supplier's own CSV, by its mapping", () => {
  beforeEach(async () => {
    const def = {
      root: "CSV",
      linesPath: "CSV/Row",
      csv: { delimiter: ";", header: true, skip: 0 },
      lines: [
        { target: "BT-1", source: "CSV/First/Rechnungsnr", fx: [] },
        { target: "BT-2", source: "CSV/First/Datum", fx: [] },
        { target: "BT-5", source: null, fx: [{ fn: "always", args: { value: "EUR" } }] },
        { target: "BT-27", source: "CSV/First/Lieferant", fx: [] },
        { target: "BT-153", source: "Artikel", fx: [] },
        { target: "BT-131", source: "Netto", fx: [] },
        { target: "BT-112", source: "CSV/Row/Netto", fx: [] },
      ],
    };
    await env.DB.prepare(
      "INSERT INTO supplier_mappings (id, route_id, name, root, status, created_at) VALUES ('map-ln', 'email-in', 'Lager Nord CSV', 'CSV', 'active', '2026-09-30')"
    ).run();
    await env.DB.prepare(
      "INSERT INTO supplier_mapping_versions (mapping_id, version, status, definition_json, created_at, published_at) VALUES ('map-ln', 2, 'live', ?, '2026-09-30', '2026-09-30')"
    )
      .bind(JSON.stringify(def))
      .run();
  });

  const CSV = "Rechnungsnr;Datum;Lieferant;Artikel;Netto\n88252;2026-09-30;Lager Nord GmbH;Regal;100\n88253;2026-09-30;Lager Nord GmbH;Kiste;5\n88252;2026-09-30;Lager Nord GmbH;Schrauben;2.5\n";

  it("is offered as a layout, and groups the rows by the column it reads the invoice number from", async () => {
    expect((await handleBatchMappings(env.DB)).body).toEqual({ mappings: [{ id: "map-ln", name: "Lager Nord CSV", version: 2 }] });
    const preview = (await handleBatchPreview(env.DB, { kind: "mapping", mappingId: "map-ln" }, "ln.csv", bytes(CSV))).body as {
      layout: string;
      invoices: Array<{ number: string; rows: number[]; lines: number; total: number; status: string }>;
    };
    expect(preview.layout).toBe("Lager Nord CSV v2");
    expect(preview.invoices.map((i) => [i.number, i.rows, i.lines, i.total, i.status])).toEqual([
      ["88252", [2, 4], 2, 102.5, "ready"],
      ["88253", [3], 1, 5, "ready"],
    ]);

    const { messageId } = (await handleOpenUpload(env.DB, DAN, { sourceId: "upload-ap", kind: "batch", files: 1 })).body as { messageId: string };
    const made = await handleUploadBatchChunk(env.DB, DAN, messageId, { kind: "mapping", mappingId: "map-ln" }, { filename: "ln.csv", bytes: bytes(CSV) }, { from: 0, count: 20, duplicates: false }, deps());
    const ids = (made.body as { made: Array<{ invoiceId: string }> }).made.map((m) => m.invoiceId);
    expect(ids).toHaveLength(2);
    const facts = JSON.parse(
      (await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(ids[0]).first<{ facts_json: string }>())!.facts_json
    );
    expect(facts).toMatchObject({ "BT-1": "88252", "BT-112": 102.5, "intake.format": "supplier_csv" });
  });

  it("refuses a mapping that is not published", async () => {
    expect((await handleBatchPreview(env.DB, { kind: "mapping", mappingId: "nope" }, "ln.csv", bytes(CSV))).status).toBe(404);
  });
});

describe("the batch routes need AP.Create", () => {
  it("serves the template and a preview with it, and nothing without it", async () => {
    const id = crypto.randomUUID();
    const key = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, 'Someone', ?)").bind(id, `${id}@a.example`, await hashApiKey(key)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, 'Role', ?)").bind(id, JSON.stringify(["AP.Create"])).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, id).run();

    expect((await SELF.fetch("https://example.com/uploads/template.csv")).status).toBe(401);
    const template = await SELF.fetch("https://example.com/uploads/template.csv", { headers: { Authorization: `Bearer ${key}` } });
    expect(template.headers.get("Content-Disposition")).toBe('attachment; filename="vibefinance-batch-template.csv"');
    expect((await template.text()).split("\r\n")[0]).toBe(HEADER);
    const preview = await SELF.fetch("https://example.com/uploads/preview?layout=template&name=b.csv", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: FILE,
    });
    expect(((await preview.json()) as { counts: Record<string, number> }).counts).toEqual({ ready: 2, duplicate: 1, problem: 1 });
    expect((await SELF.fetch("https://example.com/uploads/preview?layout=nonsense", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: FILE })).status).toBe(400);
  });
});
