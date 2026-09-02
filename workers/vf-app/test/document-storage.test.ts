import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { computeDocumentKey, storeInvoiceDocument, retrieveInvoiceDocument } from "../src/document-storage.js";

beforeEach(async () => {
  await applyTestSchema();
});

async function seedInvoice(id: string) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, '{}')").bind(id).run();
}

describe("computeDocumentKey", () => {
  it("builds the real {customer}/{year}/{invoice_id}.{ext} structure decision 0013 specified", () => {
    expect(computeDocumentKey("acme", "inv-1", "pdf", "2026-03-15")).toBe("acme/2026/inv-1.pdf");
  });

  it("derives the year from the issue date, not necessarily the current date", () => {
    expect(computeDocumentKey("acme", "inv-1", "xml", "2019-11-01")).toBe("acme/2019/inv-1.xml");
  });

  it("falls back to the current year only when no issue date is given", () => {
    const key = computeDocumentKey("acme", "inv-1", "pdf");
    const currentYear = new Date().getUTCFullYear().toString();
    expect(key).toBe(`acme/${currentYear}/inv-1.pdf`);
  });

  it("never keys by anything resembling a run id — the same invoice always gets the same key", () => {
    const key1 = computeDocumentKey("acme", "inv-1", "pdf", "2026-01-01");
    const key2 = computeDocumentKey("acme", "inv-1", "pdf", "2026-01-01");
    expect(key1).toBe(key2); // deterministic — no timestamp, no random run id
  });
});

describe("storeInvoiceDocument — real R2, real D1, both genuinely exercised", () => {
  it("stores real bytes in R2 and a real reference row in D1", async () => {
    await seedInvoice("inv-1");
    const bytes = new TextEncoder().encode("real pdf bytes").buffer;
    const result = await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "original",
      contentType: "application/pdf",
      key: "acme/2026/inv-1.pdf",
      bytes,
    });
    expect(result.r2Key).toBe("acme/2026/inv-1.pdf");

    const stored = await env.DOCUMENTS.get("acme/2026/inv-1.pdf");
    expect(stored).not.toBeNull();
    expect(await stored?.text()).toBe("real pdf bytes");

    const row = await env.DB.prepare("SELECT invoice_id, document_type, r2_key, content_type FROM invoice_documents WHERE id = ?")
      .bind(result.id)
      .first();
    expect(row).toEqual({
      invoice_id: "inv-1",
      document_type: "original",
      r2_key: "acme/2026/inv-1.pdf",
      content_type: "application/pdf",
    });
  });

  it("stores the real content type as R2 httpMetadata, not just in D1", async () => {
    await seedInvoice("inv-1");
    const bytes = new TextEncoder().encode("<xml/>").buffer;
    await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "original",
      contentType: "application/xml",
      key: "acme/2026/inv-1.xml",
      bytes,
    });
    const object = await env.DOCUMENTS.get("acme/2026/inv-1.xml");
    expect(object?.httpMetadata?.contentType).toBe("application/xml");
  });

  it("allows two real document types for the same invoice — the genuine pure-XML case", async () => {
    await seedInvoice("inv-1");
    await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "original",
      contentType: "application/xml",
      key: "acme/2026/inv-1.xml",
      bytes: new TextEncoder().encode("<xml/>").buffer,
    });
    const result = await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "generated_rendering",
      contentType: "application/pdf",
      key: "acme/2026/inv-1.pdf",
      bytes: new TextEncoder().encode("rendered pdf").buffer,
    });
    expect(result.documentType).toBe("generated_rendering");

    const count = await env.DB.prepare("SELECT count(*) AS n FROM invoice_documents WHERE invoice_id = ?").bind("inv-1").first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it("refuses a second document of the same type for the same invoice — the real UNIQUE constraint, not silently overwritten", async () => {
    await seedInvoice("inv-1");
    await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "original",
      contentType: "application/pdf",
      key: "acme/2026/inv-1.pdf",
      bytes: new TextEncoder().encode("first").buffer,
    });
    await expect(
      storeInvoiceDocument(env.DOCUMENTS, env.DB, {
        invoiceId: "inv-1",
        documentType: "original",
        contentType: "application/pdf",
        key: "acme/2026/inv-1-v2.pdf",
        bytes: new TextEncoder().encode("second").buffer,
      })
    ).rejects.toThrow();
  });

  it("never writes a D1 reference when the R2 upload itself fails — proves the stated ordering safety property directly, not just by reading the comment", async () => {
    await seedInvoice("inv-1");
    const failingBucket = {
      put: async () => {
        throw new Error("simulated R2 outage");
      },
    } as unknown as R2Bucket;

    await expect(
      storeInvoiceDocument(failingBucket, env.DB, {
        invoiceId: "inv-1",
        documentType: "original",
        contentType: "application/pdf",
        key: "acme/2026/inv-1.pdf",
        bytes: new TextEncoder().encode("never actually stored").buffer,
      })
    ).rejects.toThrow("simulated R2 outage");

    const row = await env.DB.prepare("SELECT id FROM invoice_documents WHERE invoice_id = ?").bind("inv-1").first();
    expect(row).toBeNull(); // no dangling reference to an object that was never stored
  });
});

describe("retrieveInvoiceDocument — real round trip", () => {
  it("retrieves exactly the bytes and content type that were stored", async () => {
    await seedInvoice("inv-1");
    await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "original",
      contentType: "application/pdf",
      key: "acme/2026/inv-1.pdf",
      bytes: new TextEncoder().encode("genuine retrieved content").buffer,
    });

    const retrieved = await retrieveInvoiceDocument(env.DOCUMENTS, env.DB, "inv-1", "original");
    expect(retrieved).not.toBeNull();
    expect(new TextDecoder().decode(retrieved!.bytes)).toBe("genuine retrieved content");
    expect(retrieved!.contentType).toBe("application/pdf");
    expect(retrieved!.r2Key).toBe("acme/2026/inv-1.pdf");
  });

  it("returns null, not a thrown error, when no reference was ever recorded", async () => {
    const retrieved = await retrieveInvoiceDocument(env.DOCUMENTS, env.DB, "no-such-invoice", "original");
    expect(retrieved).toBeNull();
  });

  it("returns null when a reference exists but requesting the other document type that was never stored", async () => {
    await seedInvoice("inv-1");
    await storeInvoiceDocument(env.DOCUMENTS, env.DB, {
      invoiceId: "inv-1",
      documentType: "original",
      contentType: "application/xml",
      key: "acme/2026/inv-1.xml",
      bytes: new TextEncoder().encode("<xml/>").buffer,
    });
    const retrieved = await retrieveInvoiceDocument(env.DOCUMENTS, env.DB, "inv-1", "generated_rendering");
    expect(retrieved).toBeNull();
  });

  it("returns null, not a crash, when the D1 reference exists but the R2 object is genuinely missing", async () => {
    await seedInvoice("inv-1");
    // Insert a reference directly, bypassing storeInvoiceDocument, to
    // simulate a real orphaned-reference edge case without ever
    // actually writing the object to R2.
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES (?, ?, ?, ?, ?)"
    )
      .bind("orphan-doc", "inv-1", "acme/2026/never-uploaded.pdf", "original", "application/pdf")
      .run();
    const retrieved = await retrieveInvoiceDocument(env.DOCUMENTS, env.DB, "inv-1", "original");
    expect(retrieved).toBeNull();
  });
});
