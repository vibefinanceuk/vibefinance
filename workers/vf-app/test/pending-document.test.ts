import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreatePendingDocument,
  handleUploadPage,
  handleListPendingDocument,
  type PendingDocumentStorage,
} from "../src/pending-document-route.js";
import { handleFinalisePendingDocument } from "../src/intake-capture-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";

/** An in-memory stand-in for R2. Deliberately real enough to catch a
 *  page written under the wrong key or read back in the wrong order,
 *  which is what these tests are actually about. */
function memoryStorage(): PendingDocumentStorage & { keys(): string[] } {
  const store = new Map<string, Uint8Array>();
  return {
    async put(key, bytes) {
      store.set(key, bytes);
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    keys: () => [...store.keys()].sort(),
  };
}

const PAGE_ONE = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x01]);
const PAGE_TWO = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x02]);
const PNG_PAGE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const MORRISON = JSON.stringify({
  invoiceNumber: "SKELS26003894",
  issueDate: "2026-07-22",
  paymentDueDate: "2026-08-21",
  currencyCode: "EUR",
  netTotalBeforeVat: 3137.47,
  vatAmount: 0,
  totalWithVat: 3137.47,
  lines: [
    { description: "International Freight", amount: 1797.47 },
    { description: "Destination Terminal Handling", amount: 275.0 },
    { description: "ISPS / Port Security", amount: 35.0 },
    { description: "Destination Documentation Fee", amount: 75.0 },
    { description: "Equipment Fee", amount: 25.0 },
    { description: "Delivery Cartage", amount: 585.0 },
    { description: "Destination Customs Clearance", amount: 85.0 },
    { description: "Drop off", amount: 260.0 },
  ],
  _confidence: 0.9,
});

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateProcess(env.DB, { id: "p-mp", name: "Multi-page" });
  await env.DB.prepare(
    "INSERT INTO rule_sets (id, name, mode, status) VALUES ('rs-mp', 'mp', 'first_match', 'active')"
  ).run();
  await handleCreateStage(env.DB, "p-mp", { id: "s-mp", name: "Check", sequence: 1, ruleSetId: "rs-mp" });
  await env.DB.prepare("INSERT INTO intake_channels (id, process_id, name) VALUES ('ch-mp', 'p-mp', 'Multi-page')").run();
});

async function newDocument(): Promise<string> {
  const created = await handleCreatePendingDocument(env.DB, "ch-mp");
  return (created.body as { id: string }).id;
}

describe("accumulating pages", () => {
  it("404s an unknown channel", async () => {
    const result = await handleCreatePendingDocument(env.DB, "no-such-channel");
    expect(result.status).toBe(404);
  });

  it("opens a document with no pages and no invoice", async () => {
    const id = await newDocument();
    const row = await env.DB.prepare("SELECT status, invoice_id FROM pending_documents WHERE id = ?")
      .bind(id)
      .first();
    // The whole reason this table exists: a document that is not yet
    // an invoice.
    expect(row).toEqual({ status: "open", invoice_id: null });
  });

  it("accepts pages and reports the running count", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const first = await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    expect((first.body as { pageCount: number }).pageCount).toBe(1);
    const second = await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    expect((second.body as { pageCount: number }).pageCount).toBe(2);
  });

  it("replaces a re-uploaded page rather than duplicating it", async () => {
    // A retry after a network failure must not make the model read
    // the same page twice.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    const again = await handleUploadPage(env.DB, storage, id, 1, PAGE_TWO);
    expect((again.body as { pageCount: number }).pageCount).toBe(1);
  });

  it("rejects a page number below one", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const result = await handleUploadPage(env.DB, storage, id, 0, PAGE_ONE);
    expect(result.status).toBe(400);
  });

  it("rejects a PDF, pointing at the path that checks for embedded XML first", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const result = await handleUploadPage(env.DB, storage, id, 1, new TextEncoder().encode("%PDF-1.7"));
    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("capture-pdf");
  });

  it("rejects an unsupported format", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const result = await handleUploadPage(env.DB, storage, id, 1, new TextEncoder().encode("<Invoice/>"));
    expect(result.status).toBe(422);
  });

  it("lists pages in order, whatever order they arrived in", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    const listed = await handleListPendingDocument(env.DB, id);
    const pages = (listed.body as { pages: { pageNumber: number }[] }).pages;
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
  });

  it("accepts mixed formats across pages", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    const result = await handleUploadPage(env.DB, storage, id, 2, PNG_PAGE);
    expect(result.status).toBe(200);
  });
});

describe("finalising", () => {
  const fakeModel = (response: string) => ({ extract: async () => response });

  it("refuses a document with no pages", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));
    expect(result.status).toBe(422);
  });

  it("refuses a gap in the page numbers rather than extracting an incomplete document", async () => {
    // Extracting pages 1 and 3 would silently produce an invoice from
    // a document missing its middle — the exact failure multi-page
    // support exists to fix, in a form harder to notice.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleUploadPage(env.DB, storage, id, 3, PAGE_TWO);
    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));
    expect(result.status).toBe(422);
    expect(String((result.body as { error: string }).error)).toContain("no gaps");
  });

  it("sends every page to the model, in document order, in ONE call", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);

    let calls = 0;
    let seenPages: readonly { bytes: Uint8Array }[] = [];
    const spy = {
      extract: async (_p: string, images: readonly { bytes: Uint8Array; contentType: string }[]) => {
        calls += 1;
        seenPages = images;
        return MORRISON;
      },
    };
    await handleFinalisePendingDocument(env.DB, storage, id, spy);

    expect(calls).toBe(1);
    expect(seenPages).toHaveLength(2);
    // Page 1 first, despite page 2 being uploaded first.
    expect(seenPages[0].bytes[4]).toBe(0x01);
    expect(seenPages[1].bytes[4]).toBe(0x02);
  });

  it("tells the model it is looking at one invoice across several pages", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);

    let prompt = "";
    const spy = {
      extract: async (p: string) => {
        prompt = p;
        return MORRISON;
      },
    };
    await handleFinalisePendingDocument(env.DB, storage, id, spy);
    expect(prompt).toMatch(/2 images/);
    expect(prompt).toMatch(/pages of ONE invoice/);
    expect(prompt).toMatch(/never one per page/);
  });

  it("produces a real invoice with the totals that only page two carries", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));
    expect(result.status).toBe(201);
    expect((result.body as { pageCount: number }).pageCount).toBe(2);

    const row = await env.DB.prepare("SELECT invoice_number, total_with_vat FROM invoice_headers WHERE id = ?")
      .bind((result.body as { id: string }).id)
      .first();
    expect(row).toEqual({ invoice_number: "SKELS26003894", total_with_vat: 3137.47 });
  });

  it("the line-sum check finally passes, with both the lines and the total present", async () => {
    // The original failure, closed: page one has the lines, page two
    // has the total, and only together do they validate.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));

    const visit = await env.DB.prepare(
      "SELECT validation_passed, validation_checked FROM stage_visits WHERE process_instance_id = ? AND validation_checked IS NOT NULL"
    )
      .bind((result.body as { instanceId: string }).instanceId)
      .first<{ validation_passed: number; validation_checked: string }>();
    expect(visit?.validation_checked).toContain("line_sum");
    expect(visit?.validation_passed).toBe(1);
  });

  it("marks the document finalised and links it to the invoice it produced", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));

    const row = await env.DB.prepare("SELECT status, invoice_id, finalised_at FROM pending_documents WHERE id = ?")
      .bind(id)
      .first<{ status: string; invoice_id: string; finalised_at: string }>();
    expect(row?.status).toBe("finalised");
    expect(row?.invoice_id).toBe((result.body as { id: string }).id);
    expect(row?.finalised_at).toBeTruthy();
  });

  it("refuses to finalise twice", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));
    const again = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));
    expect(again.status).toBe(409);
  });

  it("refuses a page added after finalisation", async () => {
    // The stored invoice would otherwise describe a page set that no
    // longer matches.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleFinalisePendingDocument(env.DB, storage, id, fakeModel(MORRISON));
    const late = await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    expect(late.status).toBe(409);
  });

  it("leaves the document open when extraction refuses, so it can be retried", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel("not json at all"));
    expect(result.status).toBe(422);

    const row = await env.DB.prepare("SELECT status FROM pending_documents WHERE id = ?").bind(id).first();
    // Stranding the pages against nothing would be worse than a
    // retryable failure.
    expect(row).toEqual({ status: "open" });
  });

  it("500s honestly when a page cannot be read back from storage", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    const broken: PendingDocumentStorage = { put: storage.put, get: async () => null };
    const result = await handleFinalisePendingDocument(env.DB, broken, id, fakeModel(MORRISON));
    expect(result.status).toBe(500);
  });
});
