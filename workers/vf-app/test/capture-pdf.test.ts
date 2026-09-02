import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCapturePdf, handleCaptureImage } from "../src/intake-capture-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import {
  decodePdf,
  FACTURX_PLAIN_B64,
  FACTURX_COMPRESSED_B64,
  ATTACHMENT_NOT_XML_B64,
  PLAIN_NO_ATTACHMENT_B64,
} from "./fixtures/pdf-fixtures.js";

const facturxPlain = decodePdf(FACTURX_PLAIN_B64);
const facturxCompressed = decodePdf(FACTURX_COMPRESSED_B64);
const attachmentNotXml = decodePdf(ATTACHMENT_NOT_XML_B64);
const plainNoAttachment = decodePdf(PLAIN_NO_ATTACHMENT_B64);

async function seedChannel(id: string, fallback: "refuse" | "fallback" = "refuse") {
  // A real process with a real stage: capture creates a process
  // instance and visits its first stage, so a stageless process is a
  // legitimate 422 from the workflow engine, not a PDF problem.
  const existing = await env.DB.prepare("SELECT id FROM processes WHERE id = 'p-pdf'").first();
  if (!existing) {
    await handleCreateProcess(env.DB, { id: "p-pdf", name: "PDF Intake" });
    await handleCreateStage(env.DB, "p-pdf", { id: "s-pdf", name: "Received", sequence: 1 });
  }
  await env.DB.prepare(
    "INSERT INTO intake_channels (id, process_id, name, hybrid_pdf_fallback) VALUES (?, 'p-pdf', ?, ?)"
  )
    .bind(id, id, fallback)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCapturePdf — the hybrid path (decision 0042)", () => {
  it("captures a real Factur-X invoice, storing the same facts a direct UBL submission would", async () => {
    await seedChannel("ch-hybrid");
    const result = await handleCapturePdf(env.DB, "ch-hybrid", facturxPlain);
    expect(result.status).toBe(201);
    expect(result.body.documentPath).toBe("hybrid-embedded-xml");
    expect(result.body.attachmentFilename).toBe("factur-x.xml");

    // Measure the rendered result, not the instruction issued (§7):
    // the invoice must be genuinely stored, with the embedded XML's
    // own values — never inferred, never approximated.
    const row = await env.DB.prepare(
      "SELECT invoice_number, supplier_vat_id, currency, total_with_vat FROM invoice_headers WHERE id = ?"
    )
      .bind(result.body.id as string)
      .first();
    expect(row).toEqual({
      invoice_number: "ZUGFERD-2026-001",
      supplier_vat_id: "DE900800700",
      currency: "EUR",
      total_with_vat: 1190,
    });
  });

  it("captures the compressed variant identically — compression is an encoding detail, not a data difference", async () => {
    await seedChannel("ch-a");
    await seedChannel("ch-b");
    const plain = await handleCapturePdf(env.DB, "ch-a", facturxPlain);
    const compressed = await handleCapturePdf(env.DB, "ch-b", facturxCompressed);
    expect(compressed.status).toBe(201);

    const rowA = await env.DB.prepare("SELECT invoice_number, total_with_vat FROM invoice_headers WHERE id = ?")
      .bind(plain.body.id as string)
      .first();
    const rowB = await env.DB.prepare("SELECT invoice_number, total_with_vat FROM invoice_headers WHERE id = ?")
      .bind(compressed.body.id as string)
      .first();
    expect(rowB).toEqual(rowA);
  });

  it("stores real invoice lines from the embedded XML, not just header facts", async () => {
    await seedChannel("ch-lines");
    const result = await handleCapturePdf(env.DB, "ch-lines", facturxPlain);
    const lines = await env.DB.prepare("SELECT count(*) AS n FROM invoice_lines WHERE invoice_id = ?")
      .bind(result.body.id as string)
      .first<{ n: number }>();
    expect(lines?.n).toBe(1);
  });

  it("creates a real process instance, exactly as the UBL path does", async () => {
    await seedChannel("ch-instance");
    const result = await handleCapturePdf(env.DB, "ch-instance", facturxPlain);
    expect(result.status).toBe(201);
    // The whole point of routing into handleCaptureUblXml rather than
    // reimplementing: everything downstream happens unchanged.
    expect(result.body.instanceId).toBeTruthy();
    expect(result.body.visit).toBeTruthy();
  });

  it("honours an explicit id override, matching the UBL path", async () => {
    await seedChannel("ch-id");
    const result = await handleCapturePdf(env.DB, "ch-id", facturxPlain, "my-own-id");
    expect(result.body.id).toBe("my-own-id");
  });
});

describe("handleCapturePdf — refusals and the configurable fallback", () => {
  it("422s something that is not a PDF at all", async () => {
    await seedChannel("ch-notpdf");
    const result = await handleCapturePdf(env.DB, "ch-notpdf", new TextEncoder().encode("<Invoice/>"));
    expect(result.status).toBe(422);
  });

  it("404s an intake channel that does not exist", async () => {
    const result = await handleCapturePdf(env.DB, "no-such-channel", facturxPlain);
    expect(result.status).toBe(404);
  });

  it("refuses a malformed hybrid by default — the safer behaviour is the one you get without choosing", async () => {
    await seedChannel("ch-strict"); // defaults to 'refuse'
    const result = await handleCapturePdf(env.DB, "ch-strict", attachmentNotXml);
    expect(result.status).toBe(422);
    expect(String(result.body.detail)).toContain("refuse");
  });

  it("a 'fallback' channel reports honestly that image extraction is not built, rather than silently succeeding", async () => {
    await seedChannel("ch-lenient", "fallback");
    const result = await handleCapturePdf(env.DB, "ch-lenient", attachmentNotXml);
    // 501, not 422 and not a fake 201: the channel WOULD degrade, and
    // there is nothing to degrade to yet. Reporting 201 with nothing
    // extracted would be the genuinely bad outcome.
    expect(result.status).toBe(501);
  });

  it("the two policies genuinely differ on the same document — the setting is not decorative", async () => {
    await seedChannel("ch-x", "refuse");
    await seedChannel("ch-y", "fallback");
    const strict = await handleCapturePdf(env.DB, "ch-x", attachmentNotXml);
    const lenient = await handleCapturePdf(env.DB, "ch-y", attachmentNotXml);
    expect(strict.status).not.toBe(lenient.status);
  });

  it("501s an ordinary PDF with no embedded invoice, regardless of policy", async () => {
    await seedChannel("ch-scan", "refuse");
    const result = await handleCapturePdf(env.DB, "ch-scan", plainNoAttachment);
    // Not a malformed hybrid — genuinely just a scan. Needs a vision
    // model, which is the next piece of work.
    expect(result.status).toBe(501);
    expect(String(result.body.error)).toContain("no embedded invoice");
  });

  it("records every refusal as a real capture event — an exception intake_capture_events exists to make visible", async () => {
    await seedChannel("ch-events");
    await handleCapturePdf(env.DB, "ch-events", attachmentNotXml);
    const events = await env.DB.prepare(
      "SELECT count(*) AS n FROM intake_capture_events WHERE channel_id = ? AND outcome = 'rejected'"
    )
      .bind("ch-events")
      .first<{ n: number }>();
    expect(events?.n).toBe(1);
  });

  it("never stores an invoice when the document was refused", async () => {
    await seedChannel("ch-nostore");
    await handleCapturePdf(env.DB, "ch-nostore", attachmentNotXml);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

describe("handleCaptureImage — the inferred path (decision 0043)", () => {
  const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
  const jpeg = new Uint8Array(JPEG_HEADER);

  // Keyed the way the MODEL answers — human terms, not Business Term
  // ids, which it cannot interpret (decision 0043's second addendum).
  const GOOD = JSON.stringify({
    invoiceNumber: "PHOTO-2026-001",
    issueDate: "2026-09-02",
    currencyCode: "EUR",
    supplierVatNumber: "DE900800700",
    totalWithVat: 1190.0,
    _confidence: 0.91,
  });

  const fakeModel = (response: string) => ({ extract: async () => response });

  it("captures a photographed invoice, storing the extracted facts", async () => {
    await seedChannel("ch-img");
    const result = await handleCaptureImage(env.DB, "ch-img", jpeg, fakeModel(GOOD));
    expect(result.status).toBe(201);
    expect(result.body.documentPath).toBe("image-extraction");
    expect(result.body.confidence).toBe(0.91);

    const row = await env.DB.prepare(
      "SELECT invoice_number, supplier_vat_id, total_with_vat FROM invoice_headers WHERE id = ?"
    )
      .bind(result.body.id as string)
      .first();
    expect(row).toEqual({
      invoice_number: "PHOTO-2026-001",
      supplier_vat_id: "DE900800700",
      total_with_vat: 1190,
    });
  });

  it("marks the document path as inferred — a caller must be able to tell this was not parsed", async () => {
    await seedChannel("ch-marked");
    const result = await handleCaptureImage(env.DB, "ch-marked", jpeg, fakeModel(GOOD));
    // The hybrid path reports "hybrid-embedded-xml"; this reports
    // something visibly different, because the data has genuinely
    // different provenance.
    expect(result.body.documentPath).not.toBe("hybrid-embedded-xml");
    expect(result.body.missingFields).toBeInstanceOf(Array);
  });

  it("refuses a PDF sent to the image endpoint — it must go through the embedded-XML check first", async () => {
    await seedChannel("ch-pdf-here");
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    const result = await handleCaptureImage(env.DB, "ch-pdf-here", pdf, fakeModel(GOOD));
    expect(result.status).toBe(422);
    // The real risk this guards: a hybrid PDF read as a picture would
    // silently substitute inferred data for mandate-grade data.
    expect(String(result.body.error)).toContain("capture-pdf");
  });

  it("422s an unsupported format rather than sending it to a model", async () => {
    await seedChannel("ch-badfmt");
    const result = await handleCaptureImage(env.DB, "ch-badfmt", new TextEncoder().encode("<Invoice/>"), fakeModel(GOOD));
    expect(result.status).toBe(422);
  });

  it("404s an unknown channel", async () => {
    const result = await handleCaptureImage(env.DB, "no-such-channel", jpeg, fakeModel(GOOD));
    expect(result.status).toBe(404);
  });

  it("refuses when the model reads nothing, rather than storing an empty invoice", async () => {
    await seedChannel("ch-empty");
    const result = await handleCaptureImage(env.DB, "ch-empty", jpeg, fakeModel(JSON.stringify({ _confidence: 0.1 })));
    expect(result.status).toBe(422);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("records a refusal as a real capture event", async () => {
    await seedChannel("ch-imgevents");
    await handleCaptureImage(env.DB, "ch-imgevents", jpeg, fakeModel("not json at all"));
    const events = await env.DB.prepare(
      "SELECT count(*) AS n FROM intake_capture_events WHERE channel_id = ? AND outcome = 'rejected'"
    )
      .bind("ch-imgevents")
      .first<{ n: number }>();
    expect(events?.n).toBe(1);
  });

  it("stores extraction confidence as a real fact, so rules can reference it", async () => {
    await seedChannel("ch-conf");
    const result = await handleCaptureImage(env.DB, "ch-conf", jpeg, fakeModel(GOOD));
    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?")
      .bind(result.body.id as string)
      .first<{ facts_json: string }>();
    const facts = JSON.parse(row!.facts_json);
    expect(facts["extraction.confidence"]).toBe(0.91);
  });

  it("asks for the customer's own declared fields alongside the standard ones", async () => {
    await seedChannel("ch-custom");
    await env.DB.prepare(
      "INSERT INTO custom_fields (key, label, type, description) VALUES (?, ?, ?, ?)"
    )
      .bind("custom.transport_reference", "Transport Reference", "text", "the carrier consignment reference")
      .run();

    let seenSchema: Record<string, unknown> | undefined;
    const spy = {
      extract: async (_p: string, _i: { bytes: Uint8Array; contentType: string }, schema: Record<string, unknown>) => {
        seenSchema = schema;
        return JSON.stringify({ invoiceNumber: "X", transport_reference: "TR-88431", _confidence: 0.9 });
      },
    };
    const result = await handleCaptureImage(env.DB, "ch-custom", jpeg, spy);
    expect(result.status).toBe(201);
    expect((seenSchema as { properties: Record<string, unknown> }).properties["transport_reference"]).toBeTruthy();

    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?")
      .bind(result.body.id as string)
      .first<{ facts_json: string }>();
    expect(JSON.parse(row!.facts_json)["custom.transport_reference"]).toBe("TR-88431");
  });
});
