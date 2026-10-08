import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleSetSourceEmailLimit, fillRejectMessage, BUILTIN_TOO_LARGE_MESSAGE } from "../src/source-route.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { embeddedJpegs } from "../src/pdf-read.js";
import { imageSize, jpegSize, shrinkPages } from "../src/page-shrink.js";
import { listRetainedPages, retainedPage } from "../src/pending-document-route.js";
import { SCANNED_FLATE_JPEG_PDF_B64 } from "./fixtures/pdf-read-fixtures.js";
import { SMALL_GREY_JPEG_B64 } from "./fixtures/small-jpeg-fixture.js";

const fromBase64 = (b64: string) => Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
const SCANNED_FLATE = () => fromBase64(SCANNED_FLATE_JPEG_PDF_B64);
const SMALL = () => fromBase64(SMALL_GREY_JPEG_B64);

const READ = JSON.stringify({ invoiceNumber: "INV-1", totalWithVat: 100, _confidence: 0.9, lines: [{ description: "Toner", amount: 100 }] });

/**
 * **Decision 0691: the largest email an Email source accepts, and what the
 * sender is told.**
 */
describe("an email larger than its source accepts is refused politely (decision 0691)", () => {
  const ADDRESS = "ap.acme@vibefinance-ai.com";

  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism, email_address, status) VALUES ('s-ap', 'ap', 'AP mailbox', 'email', ?, 'active')").bind(ADDRESS).run();
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism, status) VALUES ('s-sftp', 'ap', 'SFTP', 'sftp', 'active')").run();
  });

  function email(bytes: number, messageId = "<big@munch.de>"): EmailMessage & { rejected: string | null } {
    const padding = "A".repeat(bytes);
    const raw = `Message-ID: ${messageId}\r\nFrom: accounts@munch.de\r\nTo: ${ADDRESS}\r\nSubject: invoices\r\nContent-Type: text/plain\r\n\r\n${padding}`;
    const m = {
      from: "accounts@munch.de",
      to: ADDRESS,
      raw: new Response(raw).body as ReadableStream,
      rawSize: raw.length,
      rejected: null as string | null,
      setReject(reason: string) {
        m.rejected = reason;
      },
      async forward() {},
    };
    return m;
  }
  const receive = (m: EmailMessage, tooLargeMessage?: () => Promise<string | null>) =>
    handleInboundEmail(m, env.DB, { extract: async () => READ } as never, env.DOCUMENTS, "acme", undefined, { readLater: true, tooLargeMessage });
  const lastMessage = async () =>
    (await env.DB.prepare("SELECT id, status, failed_part, error_code, error_text FROM route_messages ORDER BY received_at DESC LIMIT 1").first<{
      id: string;
      status: string;
      failed_part: string;
      error_code: string;
      error_text: string;
    }>())!;

  it("refuses with the source's own message, stores nothing, and says so in the monitor", async () => {
    await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 1, rejectMessage: "Too big ({size} MB). We take {limit} MB at most." });
    const m = email(1.2 * 1024 * 1024);
    await receive(m, async () => "the default, which the source overrides");
    expect(m.rejected).toBe("Too big (1.2 MB). We take 1 MB at most.");
    const row = await lastMessage();
    expect(row).toMatchObject({ status: "failed", failed_part: "gateway", error_code: "too_large" });
    expect(row.error_text).toContain("accepts up to 1 MB");
    const parts = await env.DB.prepare("SELECT count(*) AS n FROM route_message_parts WHERE message_id = ?").bind(row.id).first<{ n: number }>();
    expect(parts!.n).toBe(0);
    const arrival = await env.DB.prepare("SELECT outcome, reason FROM inbound_email_events").first();
    expect(arrival).toEqual({ outcome: "rejected", reason: "too_large" });
  });

  it("uses Interface wording's default when the source has no message of its own", async () => {
    await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 1 });
    const m = email(1.5 * 1024 * 1024);
    await receive(m, async () => "Please keep emails under {limit} MB; yours was {size} MB.");
    expect(m.rejected).toBe("Please keep emails under 1 MB; yours was 1.5 MB.");
  });

  it("falls back to the built-in English when Interface wording cannot be reached", async () => {
    await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 1 });
    const m = email(1.5 * 1024 * 1024);
    await receive(m, async () => {
      throw new Error("vf-licence unreachable");
    });
    expect(m.rejected).toBe(fillRejectMessage(BUILTIN_TOO_LARGE_MESSAGE, 1.5, 1));
    expect(m.rejected).toContain("larger than the 1 MB this address accepts");
  });

  it("accepts an email within the limit, and applies 10 MB when none is set", async () => {
    const small = email(2 * 1024 * 1024, "<small@munch.de>");
    await receive(small);
    expect(small.rejected).not.toContain("MB");
    // No attachment, so refused for that, not for its size.
    expect((await lastMessage()).error_code).toBe("no_attachment");
    const big = email(10.5 * 1024 * 1024, "<ten@munch.de>");
    await receive(big);
    expect(big.rejected).toContain("10 MB");
    expect((await lastMessage()).error_code).toBe("too_large");
  });

  it("reads a refused email sent again, rather than taking it for a repeat", async () => {
    await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 1 });
    await receive(email(1.5 * 1024 * 1024, "<again@munch.de>"));
    await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 2 });
    const again = email(1.5 * 1024 * 1024, "<again@munch.de>");
    await receive(again);
    const n = await env.DB.prepare("SELECT count(*) AS n FROM route_messages").first<{ n: number }>();
    expect(n!.n).toBe(2);
    expect((await lastMessage()).error_code).toBe("no_attachment");
  });

  it("checks what can be set, and only on an Email source", async () => {
    expect((await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 26 })).status).toBe(400);
    expect((await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 0 })).status).toBe(400);
    expect((await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 2.5 })).status).toBe(400);
    expect((await handleSetSourceEmailLimit(env.DB, "s-ap", { rejectMessage: "x".repeat(501) })).status).toBe(400);
    expect((await handleSetSourceEmailLimit(env.DB, "s-sftp", { maxEmailMb: 5 })).status).toBe(409);
    expect((await handleSetSourceEmailLimit(env.DB, "nope", { maxEmailMb: 5 })).status).toBe(404);
    const set = await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 5, rejectMessage: "  Too\n big  " });
    expect(set.body).toEqual({ sourceId: "s-ap", maxEmailMb: 5, effectiveMb: 5, rejectMessage: "Too big" });
    // Left out: kept. Blank or null: back to the default.
    expect((await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: 6 })).body).toMatchObject({ maxEmailMb: 6, rejectMessage: "Too big" });
    expect((await handleSetSourceEmailLimit(env.DB, "s-ap", { maxEmailMb: null, rejectMessage: " " })).body).toEqual({
      sourceId: "s-ap",
      maxEmailMb: null,
      effectiveMb: 10,
      rejectMessage: null,
    });
  });
});

/**
 * **Decision 0690: a scanned PDF's pages made smaller before they are read
 * and shown; the original kept.**
 */
describe("a scanned PDF is read and shown from a smaller copy (decision 0690)", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await handleCreateProcess(env.DB, { id: "p-ap", name: "AP" });
    await handleCreateStage(env.DB, "p-ap", { id: "s-received", name: "Received", sequence: 1 });
    await handleCreateSource(env.DB, "p-ap", { id: "src-mail", name: "AP mailbox", mechanism: "email" });
    await handleCreateIntakeChannel(env.DB, "p-ap", { id: "ch-image", name: "Image", structure: "image" });
  });

  it("reads the smaller pages, keeps the original, and keeps one working page per page with its size", async () => {
    const seen: Uint8Array[] = [];
    const model = {
      extract: async (_p: string, images: { bytes: Uint8Array }[]) => {
        seen.push(images[0].bytes);
        return READ;
      },
    };
    const original = SCANNED_FLATE();
    const [scanPage] = await embeddedJpegs(original);
    const result = await handleCaptureFromSource(env.DB, "src-mail", original, model, undefined, env.DOCUMENTS, "acme", undefined, undefined, undefined, async () => SMALL());
    expect(result.status).toBe(201);
    const id = (result.body as { id: string }).id;
    // The model saw the smaller page, both times (header, then lines).
    expect(seen.map((b) => b.length)).toEqual([SMALL().length, SMALL().length]);

    // The original is the only document, kept exactly as it arrived.
    const docs = await env.DB.prepare("SELECT document_type, content_type, r2_key FROM invoice_documents WHERE invoice_id = ?").bind(id).all<{
      document_type: string;
      content_type: string;
      r2_key: string;
    }>();
    expect(docs.results.map((d) => [d.document_type, d.content_type])).toEqual([["original", "application/pdf"]]);
    const kept = await env.DOCUMENTS.get(docs.results[0].r2_key);
    expect(new Uint8Array(await kept!.arrayBuffer())).toEqual(original);

    // One working page, with its size and the scan's, for a lasso to crop.
    const pages = await env.DB.prepare("SELECT page_number, r2_key, content_type, width, height, original_width, original_height FROM invoice_pages WHERE invoice_id = ?").bind(id).all();
    const scanSize = imageSize(scanPage)!;
    expect(pages.results).toEqual([
      {
        page_number: 1,
        r2_key: expect.stringMatching(new RegExp(`^acme/\\d{4}/${id}/pages/1\\.jpg$`)),
        content_type: "image/jpeg",
        width: 120,
        height: 170,
        original_width: scanSize.width,
        original_height: scanSize.height,
      },
    ]);

    // The viewer finds it as a retained page, and is served the smaller JPEG.
    expect(await listRetainedPages(env.DB, id)).toEqual([{ pageNumber: 1, contentType: "image/jpeg" }]);
    const storage = { put: async () => {}, get: async (key: string) => { const o = await env.DOCUMENTS.get(key); return o ? new Uint8Array(await o.arrayBuffer()) : null; } };
    expect((await retainedPage(env.DB, storage, id, 1))?.bytes).toEqual(SMALL());

    const facts = JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(id).first<{ facts_json: string }>())!.facts_json);
    expect(facts["intake.reduced"]).toMatch(/^1 page, \d+ KB to 1 KB$/);
  });

  it("reads the original pages, and makes no copy, when shrinking fails", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", SCANNED_FLATE(), { extract: async () => READ }, undefined, env.DOCUMENTS, "acme", undefined, undefined, undefined, async () => {
      throw new Error("9422: transformation limit");
    });
    const id = (result.body as { id: string }).id;
    const types = await env.DB.prepare("SELECT document_type FROM invoice_documents WHERE invoice_id = ?").bind(id).all<{ document_type: string }>();
    expect(types.results.map((r) => r.document_type)).toEqual(["original"]);
    expect(await listRetainedPages(env.DB, id)).toEqual([]);
    const facts = JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(id).first<{ facts_json: string }>())!.facts_json);
    expect(facts["intake.reduced"]).toBe("not reduced: Error: 9422: transformation limit");
  });

  it("is untouched where Images is not bound", async () => {
    const result = await handleCaptureFromSource(env.DB, "src-mail", SCANNED_FLATE(), { extract: async () => READ }, undefined, env.DOCUMENTS, "acme");
    const id = (result.body as { id: string }).id;
    const facts = JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(id).first<{ facts_json: string }>())!.facts_json);
    expect(facts["intake.reduced"]).toBeUndefined();
  });
});

describe("the pieces (decision 0690)", () => {
  it("reads a JPEG's size, and refuses what is not one", () => {
    expect(jpegSize(SMALL())).toEqual({ width: 120, height: 170, components: 1 });
    expect(jpegSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });

  it("keeps a page whose copy is not smaller, or not a JPEG", async () => {
    const page = SMALL();
    const bigger = await shrinkPages([page], async () => new Uint8Array([...page, ...page]));
    expect(bigger).toMatchObject({ shrunk: false, working: [], reason: "the copy was not smaller" });
    expect(bigger.pages[0]).toBe(page);
    const notJpeg = await shrinkPages([page], async () => new Uint8Array([1, 2, 3]));
    expect(notJpeg.shrunk).toBe(false);
    expect((await shrinkPages([page], undefined)).reason).toBe("no Images binding");
  });

  it("keeps working pages only when every page was made smaller, but reads whatever was", async () => {
    const big = new Uint8Array([...SMALL(), ...new Uint8Array(5000)]);
    let n = 0;
    const half = await shrinkPages([big, big], async () => {
      n++;
      if (n === 2) throw new Error("9422");
      return SMALL();
    });
    expect(half.shrunk).toBe(false);
    expect(half.working).toEqual([]);
    expect(half.pages.map((p) => p.length)).toEqual([SMALL().length, big.length]);
    const all = await shrinkPages([big, big], async () => SMALL());
    expect(all.shrunk).toBe(true);
    expect(all.working.map((w) => [w.width, w.height, w.originalWidth])).toEqual([
      [120, 170, 120],
      [120, 170, 120],
    ]);
  });
});
