import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { ExtractionRefusal } from "../src/extraction.js";
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

  it("sends ONE call per page, in document order", async () => {
    // Changed from a single multi-image call (decision 0046): two
    // real 1.5MB and 2.8MB scans together exceeded the model's time
    // budget, while either alone extracted comfortably.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);

    const callPages: number[] = [];
    const spy = {
      extract: async (_p: string, images: readonly { bytes: Uint8Array; contentType: string }[]) => {
        // Each call carries exactly one image — that is the whole
        // point of the change.
        expect(images).toHaveLength(1);
        callPages.push(images[0].bytes[4]);
        return MORRISON;
      },
    };
    await handleFinalisePendingDocument(env.DB, storage, id, spy);

    // Page 1 first, despite page 2 being uploaded first.
    expect(callPages).toEqual([0x01, 0x02]);
  });

  it("tells each call which page it is looking at, and not to infer the others", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);

    const prompts: string[] = [];
    const spy = {
      extract: async (p: string) => {
        prompts.push(p);
        return MORRISON;
      },
    };
    await handleFinalisePendingDocument(env.DB, storage, id, spy);

    expect(prompts[0]).toMatch(/page 1 of a 2-page invoice/);
    expect(prompts[1]).toMatch(/page 2 of a 2-page invoice/);
    // Leads with what to EXTRACT, not what to omit. The first
    // version of this note gave three instructions about not
    // reporting things and one brief aside about line tables — and
    // live, the model returned zero lines from a page that has eight,
    // where the single-page prompt read all eight from the same
    // image minutes later.
    expect(prompts[0]).toMatch(/Extract everything this page shows/);
    expect(prompts[0]).toMatch(/every row of any line-item table/);
    // The restriction survives, but as one clause at the end rather
    // than the bulk of the message.
    expect(prompts[0]).toMatch(/returned as null rather than guessed at/);
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

  it("the line-sum check finally passes, with the lines and the total from DIFFERENT pages", async () => {
    // The original failure, closed. Page one carries the eight charge
    // lines and no total; page two carries the total and no lines.
    // Only merged do they validate — which is the whole argument for
    // per-page calls being complementary rather than competing.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO);

    const pageOne = JSON.stringify({
      invoiceNumber: "SKELS26003894",
      currencyCode: "EUR",
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
    const pageTwo = JSON.stringify({
      invoiceNumber: "SKELS26003894",
      netTotalBeforeVat: 3137.47,
      vatAmount: 0,
      totalWithVat: 3137.47,
      lines: null,
      _confidence: 0.9,
    });

    let call = 0;
    const perPageModel = {
      extract: async () => (call++ === 0 ? pageOne : pageTwo),
    };
    const result = await handleFinalisePendingDocument(env.DB, storage, id, perPageModel);

    const visit = await env.DB.prepare(
      "SELECT validation_passed, validation_checked, validation_failures FROM stage_visits WHERE process_instance_id = ? AND validation_checked IS NOT NULL"
    )
      .bind((result.body as { instanceId: string }).instanceId)
      .first<{ validation_passed: number; validation_checked: string; validation_failures: string }>();
    expect(visit?.validation_checked).toContain("line_sum");
    expect(visit?.validation_failures).toBe("");
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

describe("pages are extracted at upload time (decision 0047)", () => {
  const fakeModel = (response: string) => ({ extract: async () => response });

  const PAGE_ONE_RESULT = JSON.stringify({
    invoiceNumber: "SKELS26003894",
    currencyCode: "EUR",
    lines: [
      { description: "International Freight", amount: 1797.47 },
      { description: "Delivery Cartage", amount: 585.0 },
    ],
    _confidence: 0.9,
  });
  const PAGE_TWO_RESULT = JSON.stringify({
    invoiceNumber: "SKELS26003894",
    netTotalBeforeVat: 2382.47,
    vatAmount: 0,
    totalWithVat: 2382.47,
    lines: null,
    _confidence: 0.9,
  });

  it("extracts on upload, and reports it on that upload's own response", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const result = await handleUploadPage(
      env.DB,
      storage,
      id,
      1,
      PAGE_ONE,
      fakeModel(PAGE_ONE_RESULT)
    );
    expect(result.body).toMatchObject({ extracted: true, lineCount: 2 });

    const row = await env.DB.prepare(
      "SELECT extraction_json, extraction_error FROM pending_document_pages WHERE pending_document_id = ? AND page_number = 1"
    )
      .bind(id)
      .first<{ extraction_json: string; extraction_error: string | null }>();
    expect(row?.extraction_error).toBeNull();
    expect(JSON.parse(row!.extraction_json).facts["BT-1"]).toBe("SKELS26003894");
  });

  it("finalise makes NO model call when every page is already extracted", async () => {
    // The whole point of decision 0047: a single Worker request
    // cannot reliably make two large inference calls, so finalise
    // makes none at all.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE, fakeModel(PAGE_ONE_RESULT));
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO, fakeModel(PAGE_TWO_RESULT));

    let called = 0;
    const shouldNotBeCalled = {
      extract: async () => {
        called += 1;
        return PAGE_ONE_RESULT;
      },
    };
    const result = await handleFinalisePendingDocument(env.DB, storage, id, shouldNotBeCalled);
    expect(result.status).toBe(201);
    expect(called).toBe(0);
  });

  it("merges what each page contributed — lines from one, totals from the other", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE, fakeModel(PAGE_ONE_RESULT));
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO, fakeModel(PAGE_TWO_RESULT));

    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel("{}"));
    expect((result.body as { lineCount: number }).lineCount).toBe(2);

    const row = await env.DB.prepare("SELECT total_with_vat FROM invoice_headers WHERE id = ?")
      .bind((result.body as { id: string }).id)
      .first<{ total_with_vat: number }>();
    expect(row?.total_with_vat).toBe(2382.47);
  });

  it("a failed page does not fail its upload — the bytes arrived intact", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const failing = {
      extract: async () => {
        throw new ExtractionRefusal("the model did not respond in time");
      },
    };
    const result = await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE, failing);
    // 200, not an error: a page that could not be extracted is a gap
    // to explain, not a reason to reject bytes that stored fine.
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ extracted: false });
    expect(String((result.body as { extractionError: string }).extractionError)).toContain("did not respond");
  });

  it("carries a page's failure through to finalise, where it explains a gap", async () => {
    const storage = memoryStorage();
    const id = await newDocument();
    const failing = {
      extract: async () => {
        throw new ExtractionRefusal("the model did not respond in time");
      },
    };
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE, failing);
    await handleUploadPage(env.DB, storage, id, 2, PAGE_TWO, fakeModel(PAGE_TWO_RESULT));

    const result = await handleFinalisePendingDocument(env.DB, storage, id, fakeModel("{}"));
    const body = result.body as { failedPages?: { page: number }[]; confidence: number };
    expect(body.failedPages).toEqual([{ page: 1, reason: "the model did not respond in time" }]);
    // A document half of which was never read claims no confidence.
    expect(body.confidence).toBe(0);
  });

  it("falls back to extracting at finalise for pages uploaded without a model", async () => {
    // Documents uploaded before this behaviour existed must still
    // finalise rather than becoming permanently stuck.
    const storage = memoryStorage();
    const id = await newDocument();
    await handleUploadPage(env.DB, storage, id, 1, PAGE_ONE);

    let called = 0;
    const model = {
      extract: async () => {
        called += 1;
        return PAGE_ONE_RESULT;
      },
    };
    const result = await handleFinalisePendingDocument(env.DB, storage, id, model);
    expect(result.status).toBe(201);
    expect(called).toBe(1);
  });
});
