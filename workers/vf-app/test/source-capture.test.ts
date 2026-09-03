import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { FACTURX_PLAIN_B64, PLAIN_NO_ATTACHMENT_B64 } from "./fixtures/pdf-fixtures.js";

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const UBL = new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>INV-SRC-1</cbc:ID>
  <cbc:IssueDate>2026-08-01</cbc:IssueDate>
  <cbc:DocumentCurrencyCode>EUR</cbc:DocumentCurrencyCode>
  <cac:LegalMonetaryTotal><cbc:TaxInclusiveAmount currencyID="EUR">100.00</cbc:TaxInclusiveAmount></cac:LegalMonetaryTotal>
</Invoice>`);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const GIBBERISH = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05]);

const fakeModel = (response: string) => ({ extract: async () => response });
const IMAGE_RESULT = JSON.stringify({
  invoiceNumber: "IMG-1",
  totalWithVat: 250,
  lines: null,
  _confidence: 0.9,
});

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateProcess(env.DB, { id: "p-ap", name: "AP" });
  await handleCreateStage(env.DB, "p-ap", { id: "s-received", name: "Received", sequence: 1 });
  await handleCreateSource(env.DB, "p-ap", { id: "src-mail", name: "AP mailbox", mechanism: "email" });
  for (const [id, name, structure] of [
    ["ch-xml", "Structured XML", "structured_xml"],
    ["ch-pdfa", "Structured PDF/A", "structured_pdfa"],
    ["ch-image", "Image", "image"],
  ]) {
    await handleCreateIntakeChannel(env.DB, "p-ap", { id, name, structure });
  }
});

describe("capture addressed to a source", () => {
  it("routes UBL to the structured_xml channel without the caller saying so", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"));
    expect(result.status).toBe(201);
    expect((result.body as { intake: { structure: string } }).intake.structure).toBe("structured_xml");

    const row = await env.DB.prepare("SELECT invoice_number FROM invoice_headers WHERE id = ?")
      .bind((result.body as { id: string }).id)
      .first<{ invoice_number: string }>();
    expect(row?.invoice_number).toBe("INV-SRC-1");
  });

  it("routes a real Factur-X to structured_pdfa, parsing its embedded invoice", async () => {
    // The ordering guarantee, end to end: a hybrid PDF must not fall to
    // inference just because it is also a PDF.
    const result = await handleCaptureFromSource(env.DB, "src-mail", fromBase64(FACTURX_PLAIN_B64), fakeModel("{}"));
    expect(result.status).toBe(201);
    expect((result.body as { intake: { structure: string } }).intake.structure).toBe("structured_pdfa");
  });

  it("routes an image to the image channel", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", JPEG, fakeModel(IMAGE_RESULT));
    expect(result.status).toBe(201);
    expect((result.body as { intake: { structure: string } }).intake.structure).toBe("image");
  });

  it("404s a source that does not exist", async () => {
    const result = await handleCaptureFromSource(env.DB, "no-such-source", UBL, fakeModel("{}"));
    expect(result.status).toBe(404);
  });

  it("refuses an empty body", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", new Uint8Array([]), fakeModel("{}"));
    expect(result.status).toBe(400);
  });
});

describe("a document with no detectable structure", () => {
  it("is captured rather than rejected, so it can reach a person", async () => {
    // Not an error. An undetectable document is an invoice with no
    // facts, which reaches Validation and waits for somebody.
    const result = await handleCaptureFromSource(env.DB, "src-mail", GIBBERISH, fakeModel("{}"));
    expect(result.status).toBe(201);
    expect((result.body as { intake: { structure: null } }).intake.structure).toBeNull();
  });

  it("carries an empty intake.structure fact, which a rule can test for", async () => {
    // Empty rather than absent: an absent field cannot be tested for,
    // and testing for it is how the document reaches somebody.
    const result = await handleCaptureFromSource(env.DB, "src-mail", GIBBERISH, fakeModel("{}"));
    const row = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?")
      .bind((result.body as { id: string }).id)
      .first<{ facts_json: string }>();
    const facts = JSON.parse(row!.facts_json);
    expect(facts["intake.structure"]).toBe("");
    expect(facts["intake.attempted"]).toContain("pdf_header");
  });

  it("creates a process instance, without which no rule could fire on it", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", GIBBERISH, fakeModel("{}"));
    expect((result.body as { instanceId?: string }).instanceId).toBeTruthy();
  });

  it("reports what was attempted, so the refusal is diagnosable", async () => {
    // 'A PDF with no embedded invoice' and 'a PDF declaring one that
    // could not be read' are opposite conversations.
    const result = await handleCaptureFromSource(
      env.DB,
      "src-mail",
      fromBase64(PLAIN_NO_ATTACHMENT_B64),
      fakeModel("{}")
    );
    const detail = (result.body as { intake: { detail: { test: string; outcome: string }[] } }).intake.detail;
    const embedded = detail.find((d) => d.test === "embedded_invoice_xml");
    expect(embedded?.outcome).toBe("none present");
  });
});

describe("a recognised structure with no channel configured", () => {
  it("says so plainly rather than falling back to another channel", async () => {
    // Silently using a different channel would read the document under
    // rules nobody configured for it.
    await env.DB.prepare("DELETE FROM intake_channels WHERE id = 'ch-xml'").run();
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"));
    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("no structured_xml intake channel");
  });
});
