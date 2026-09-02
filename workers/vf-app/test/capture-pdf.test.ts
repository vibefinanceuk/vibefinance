import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCapturePdf } from "../src/intake-capture-route.js";
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
