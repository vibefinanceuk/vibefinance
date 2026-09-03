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

describe("retaining the original document (decision 0068)", () => {
  // A fake bucket rather than the test environment's real one, so the
  // stored key and bytes can be asserted directly.
  function recordingBucket() {
    const puts: { key: string; contentType: string; size: number }[] = [];
    return {
      puts,
      bucket: {
        put: async (key: string, body: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) => {
          puts.push({
            key,
            contentType: opts?.httpMetadata?.contentType ?? "",
            size: body.byteLength,
          });
        },
      } as unknown as R2Bucket,
    };
  }

  it("stores a UBL document as application/xml under the customer's key", async () => {
    const { puts, bucket } = recordingBucket();
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"), undefined, bucket, "acme");

    expect((result.body as { document: { retained: boolean } }).document.retained).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].contentType).toBe("application/xml");
    // {customer}/{year}/{invoice}.{ext} — the year from the invoice's own
    // issue date, not from when this happened to run.
    expect(puts[0].key).toMatch(/^acme\/\d{4}\/[0-9a-f-]+\.xml$/);
  });

  it("stores a hybrid PDF as application/pdf, not as its embedded XML", async () => {
    // What is retained is what arrived. The embedded invoice is derived.
    const { puts, bucket } = recordingBucket();
    await handleCaptureFromSource(
      env.DB,
      "src-mail",
      fromBase64(FACTURX_PLAIN_B64),
      fakeModel("{}"),
      undefined,
      bucket,
      "acme"
    );
    expect(puts[0].contentType).toBe("application/pdf");
    expect(puts[0].key).toMatch(/\.pdf$/);
  });

  it("retains a document nothing could read — where it matters most", async () => {
    // There are no facts standing in for it, so the original is the only
    // record of what arrived.
    const { puts, bucket } = recordingBucket();
    const result = await handleCaptureFromSource(env.DB, "src-mail", GIBBERISH, fakeModel("{}"), undefined, bucket, "acme");

    expect((result.body as { document: { retained: boolean } }).document.retained).toBe(true);
    expect(puts[0].contentType).toBe("application/octet-stream");
    expect(puts[0].size).toBe(GIBBERISH.length);
  });

  it("types a PDF carrying no embedded invoice as a PDF, not as octet-stream", async () => {
    // The bug this decision fixes (0069). The document has no structure
    // this system can extract from, and detection knows perfectly well
    // it is a PDF — pdf_header came back found. Deriving the type from
    // the structure alone stored it as .bin, retained correctly and
    // typed wrongly, so nothing downstream could know to render it.
    const { puts, bucket } = recordingBucket();
    const result = await handleCaptureFromSource(
      env.DB,
      "src-mail",
      fromBase64(PLAIN_NO_ATTACHMENT_B64),
      fakeModel("{}"),
      undefined,
      bucket,
      "acme"
    );

    expect((result.body as { intake: { structure: null } }).intake.structure).toBeNull();
    expect(puts[0].contentType).toBe("application/pdf");
    expect(puts[0].key).toMatch(/\.pdf$/);
  });

  it("still uses octet-stream for bytes detection genuinely could not place", async () => {
    // The fallback must stay honest rather than guessing PDF for
    // everything unrecognised.
    const { puts, bucket } = recordingBucket();
    await handleCaptureFromSource(env.DB, "src-mail", GIBBERISH, fakeModel("{}"), undefined, bucket, "acme");
    expect(puts[0].key).toMatch(/\.bin$/);
  });

  it("records a D1 reference alongside the R2 object", async () => {
    const { bucket } = recordingBucket();
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"), undefined, bucket, "acme");
    const row = await env.DB.prepare(
      "SELECT document_type, content_type FROM invoice_documents WHERE invoice_id = ?"
    )
      .bind((result.body as { id: string }).id)
      .first<{ document_type: string; content_type: string }>();
    expect(row?.document_type).toBe("original");
    expect(row?.content_type).toBe("application/xml");
  });

  it("captures successfully when no bucket is bound, and says the original was not retained", async () => {
    // Refusing would discard facts that were successfully extracted, in
    // exchange for bytes that are already lost — the request body cannot
    // be replayed.
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"));
    expect(result.status).toBe(201);
    const doc = (result.body as { document: { retained: boolean; reason: string } }).document;
    expect(doc.retained).toBe(false);
    expect(doc.reason).toContain("no R2 bucket");
  });

  it("captures successfully when the R2 write fails, and reports why", async () => {
    const failing = {
      put: async () => {
        throw new Error("simulated R2 outage");
      },
    } as unknown as R2Bucket;

    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"), undefined, failing, "acme");
    expect(result.status).toBe(201);
    const doc = (result.body as { document: { retained: boolean; reason: string } }).document;
    expect(doc.retained).toBe(false);
    expect(doc.reason).toContain("simulated R2 outage");
  });

  it("says so when CUSTOMER_ID is not configured, rather than inventing a key", async () => {
    const { puts, bucket } = recordingBucket();
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"), undefined, bucket);
    expect((result.body as { document: { reason: string } }).document.reason).toContain("CUSTOMER_ID");
    expect(puts).toHaveLength(0);
  });
});

describe("the response says what was stored, not just that it was (decision 0070)", () => {
  function recordingBucketB() {
    return { put: async () => {} } as unknown as R2Bucket;
  }

  it("reports the content type, so a mis-typed document is visible without a database query", async () => {
    // Decision 0069 was exactly that bug: retained: true was accurate,
    // the stored type was wrong, and nothing in the response would have
    // given it away.
    const result = await handleCaptureFromSource(
      env.DB,
      "src-mail",
      fromBase64(PLAIN_NO_ATTACHMENT_B64),
      fakeModel("{}"),
      undefined,
      recordingBucketB(),
      "acme"
    );
    const doc = (result.body as { document: { retained: boolean; contentType: string } }).document;
    expect(doc.retained).toBe(true);
    expect(doc.contentType).toBe("application/pdf");
  });

  it("reports the key, so the stored object can be fetched without looking it up", async () => {
    const result = await handleCaptureFromSource(
      env.DB,
      "src-mail",
      UBL,
      fakeModel("{}"),
      undefined,
      recordingBucketB(),
      "acme"
    );
    const doc = (result.body as { document: { key: string } }).document;
    expect(doc.key).toMatch(/^acme\/\d{4}\/[0-9a-f-]+\.xml$/);
  });

  it("carries no content type or key when nothing was stored", async () => {
    // A key for an object that does not exist would be worse than none.
    const result = await handleCaptureFromSource(env.DB, "src-mail", UBL, fakeModel("{}"));
    const doc = (result.body as { document: Record<string, unknown> }).document;
    expect(doc.retained).toBe(false);
    expect(doc.contentType).toBeUndefined();
    expect(doc.key).toBeUndefined();
  });
});
