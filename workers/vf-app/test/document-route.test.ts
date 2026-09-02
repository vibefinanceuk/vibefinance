import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUploadDocument, handleRetrieveDocument } from "../src/document-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedInvoice(id: string, issueDate?: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, issue_date) VALUES (?, '{}', ?)").bind(id, issueDate ?? null).run();
}

describe("handleUploadDocument", () => {
  it("uploads a real document, deriving the key from the invoice's own issue date", async () => {
    await seedInvoice("inv-1", "2026-03-15");
    const bytes = new TextEncoder().encode("real pdf bytes").buffer;
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", null, "application/pdf", bytes);
    expect(result.status).toBe(201);
    const body = result.body as { r2Key: string; documentType: string };
    expect(body.r2Key).toBe("acme/2026/inv-1.pdf");
    expect(body.documentType).toBe("original");

    const stored = await env.DOCUMENTS.get("acme/2026/inv-1.pdf");
    expect(await stored?.text()).toBe("real pdf bytes");
  });

  it("defaults documentType to 'original' when not given", async () => {
    await seedInvoice("inv-1");
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", null, "application/pdf", new ArrayBuffer(0));
    const body = result.body as { documentType: string };
    expect(body.documentType).toBe("original");
  });

  it("accepts a real generated_rendering upload explicitly", async () => {
    await seedInvoice("inv-1");
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", "generated_rendering", "application/pdf", new ArrayBuffer(0));
    expect(result.status).toBe(201);
  });

  it("500s cleanly when no bucket is configured, not a crash", async () => {
    await seedInvoice("inv-1");
    const result = await handleUploadDocument(env.DB, undefined, "acme", "inv-1", null, "application/pdf", new ArrayBuffer(0));
    expect(result.status).toBe(500);
  });

  it("500s cleanly when no customerId is configured, not a crash", async () => {
    await seedInvoice("inv-1");
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, undefined, "inv-1", null, "application/pdf", new ArrayBuffer(0));
    expect(result.status).toBe(500);
  });

  it("400s an invalid documentType", async () => {
    await seedInvoice("inv-1");
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", "scanned_pdf", "application/pdf", new ArrayBuffer(0));
    expect(result.status).toBe(400);
  });

  it("400s a missing content-type", async () => {
    await seedInvoice("inv-1");
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", null, null, new ArrayBuffer(0));
    expect(result.status).toBe(400);
  });

  it("404s an invoice that was never captured — the real foreign key's own precondition, checked before touching R2", async () => {
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "no-such-invoice", null, "application/pdf", new ArrayBuffer(0));
    expect(result.status).toBe(404);
    // Checks the specific key this upload would have used, not the
    // whole bucket's contents — R2 state in this test environment
    // isn't reset between tests within the same file the way D1 is
    // via applyTestSchema, so a whole-bucket assertion would be
    // fragile against unrelated earlier tests' own uploads.
    const currentYear = new Date().getUTCFullYear().toString();
    const stored = await env.DOCUMENTS.get(`acme/${currentYear}/no-such-invoice.pdf`);
    expect(stored).toBeNull(); // never even attempted the R2 write for this specific invoice
  });

  it("409s a second upload of the same document type — the real UNIQUE constraint, reported cleanly, not a 500", async () => {
    await seedInvoice("inv-1");
    await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", null, "application/pdf", new TextEncoder().encode("first").buffer);
    const result = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", null, "application/pdf", new TextEncoder().encode("second").buffer);
    expect(result.status).toBe(409);
  });

  it("supports two real document types for the same invoice — the genuine pure-XML case", async () => {
    await seedInvoice("inv-1");
    const xmlResult = await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", "original", "application/xml", new TextEncoder().encode("<xml/>").buffer);
    expect(xmlResult.status).toBe(201);
    const pdfResult = await handleUploadDocument(
      env.DB,
      env.DOCUMENTS,
      "acme",
      "inv-1",
      "generated_rendering",
      "application/pdf",
      new TextEncoder().encode("rendered").buffer
    );
    expect(pdfResult.status).toBe(201);
  });
});

describe("handleRetrieveDocument", () => {
  it("retrieves exactly what was uploaded, byte-for-byte", async () => {
    await seedInvoice("inv-1");
    await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", null, "application/pdf", new TextEncoder().encode("genuine content").buffer);
    const result = await handleRetrieveDocument(env.DB, env.DOCUMENTS, "inv-1", null);
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.bytes)).toBe("genuine content");
    expect(result.contentType).toBe("application/pdf");
  });

  it("404s a document that was never uploaded", async () => {
    await seedInvoice("inv-1");
    const result = await handleRetrieveDocument(env.DB, env.DOCUMENTS, "inv-1", null);
    expect(result.status).toBe(404);
  });

  it("404s requesting the other document type that was never stored", async () => {
    await seedInvoice("inv-1");
    await handleUploadDocument(env.DB, env.DOCUMENTS, "acme", "inv-1", "original", "application/xml", new ArrayBuffer(0));
    const result = await handleRetrieveDocument(env.DB, env.DOCUMENTS, "inv-1", "generated_rendering");
    expect(result.status).toBe(404);
  });

  it("500s cleanly when no bucket is configured", async () => {
    const result = await handleRetrieveDocument(env.DB, undefined, "inv-1", null);
    expect(result.status).toBe(500);
  });

  it("400s an invalid documentType", async () => {
    const result = await handleRetrieveDocument(env.DB, env.DOCUMENTS, "inv-1", "scanned_pdf");
    expect(result.status).toBe(400);
  });
});
