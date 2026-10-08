import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { readPdf, toGreyPng } from "../src/pdf-read.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleGetInvoice, handleUpsertInvoice } from "../src/invoice-facts-route.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { DIGITAL_INVOICE_PDF_B64, SCANNED_INVOICE_PDF_B64 } from "./fixtures/pdf-read-fixtures.js";
import { PLAIN_NO_ATTACHMENT_B64 } from "./fixtures/pdf-fixtures.js";

/** Decision 0683: an ordinary PDF read from its text, or from the picture of each page. */
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
const DIGITAL = () => fromBase64(DIGITAL_INVOICE_PDF_B64);
const SCANNED = () => fromBase64(SCANNED_INVOICE_PDF_B64);

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const pngSize = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20), colourType: png[25] };
};

const READ = JSON.stringify({
  invoiceNumber: "INV-7781",
  issueDate: "2026-10-01",
  currencyCode: "GBP",
  supplierVatNumber: "GB123456789",
  totalWithVat: 120,
  lines: [{ description: "Courier service, same-day", amount: 75 }, { description: "Pallet wrap", amount: 25 }],
  _confidence: 0.9,
});

/** A model that records what it was given. */
function recordingModel(response = READ) {
  const calls: { prompt: string; images: { bytes: Uint8Array; contentType: string }[] }[] = [];
  return {
    calls,
    model: {
      extract: async (prompt: string, images: { bytes: Uint8Array; contentType: string }[]) => {
        calls.push({ prompt, images });
        return response;
      },
    },
  };
}

describe("readPdf", () => {
  it("reads a digital PDF's text, page by page", async () => {
    const read = await readPdf(DIGITAL());
    expect(read.kind).toBe("text");
    if (read.kind !== "text") return;
    expect(read.pages).toHaveLength(1);
    expect(read.pages[0]).toContain("INVOICE INV-7781");
    expect(read.pages[0]).toContain("Total GBP 120.00");
  });

  it("turns a scanned PDF's page picture into a grey PNG", async () => {
    const read = await readPdf(SCANNED());
    expect(read.kind).toBe("images");
    if (read.kind !== "images") return;
    expect(read.images).toHaveLength(1);
    const png = read.images[0];
    expect([...png.slice(0, 8)]).toEqual(PNG_SIGNATURE);
    expect(pngSize(png)).toEqual({ width: 620, height: 420, colourType: 0 });
  });

  it("says when a PDF has neither text nor a page picture", async () => {
    const read = await readPdf(fromBase64(PLAIN_NO_ATTACHMENT_B64));
    expect(read.kind).toBe("none");
  });

  it("shrinks a large page to at most 1600 on its longer side, and its rows decompress to the right size", async () => {
    const width = 3300, height = 2000;
    const png = await toGreyPng(new Uint8Array(width * height * 3).fill(200), width, height, 3);
    const { width: w, height: h } = pngSize(png);
    expect(w).toBeLessThanOrEqual(1600);
    expect(h).toBe(Math.floor(height / Math.ceil(width / 1600)));
    // IDAT starts after the signature (8) and IHDR (25): length, type, data.
    const idatLength = new DataView(png.buffer, png.byteOffset).getUint32(33);
    const idat = png.slice(41, 41 + idatLength);
    const raw = new Uint8Array(await new Response(new Blob([idat]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer());
    expect(raw.length).toBe(h * (w + 1));
    expect(raw[1]).toBe(200);
  });
});

describe("an emailed ordinary PDF becomes an invoice with its fields", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await handleCreateProcess(env.DB, { id: "p-ap", name: "AP" });
    await handleCreateStage(env.DB, "p-ap", { id: "s-received", name: "Received", sequence: 1 });
    await handleCreateSource(env.DB, "p-ap", { id: "src-mail", name: "AP mailbox", mechanism: "email" });
    await handleCreateIntakeChannel(env.DB, "p-ap", { id: "ch-image", name: "Image", structure: "image" });
  });

  const headerOf = (id: string) =>
    env.DB.prepare("SELECT invoice_number, currency, supplier_vat_id, total_with_vat, facts_json FROM invoice_headers WHERE id = ?").bind(id).first<{
      invoice_number: string;
      currency: string;
      supplier_vat_id: string;
      total_with_vat: number;
      facts_json: string;
    }>();

  it("reads a digital PDF from its text, with no picture sent", async () => {
    const { model, calls } = recordingModel();
    const result = await handleCaptureFromSource(env.DB, "src-mail", DIGITAL(), model);
    expect(result.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(0);
    expect(calls[0].prompt).toContain("the text of a supplier invoice, taken from its PDF");
    expect(calls[0].prompt).toContain("INVOICE INV-7781");

    const id = (result.body as { id: string }).id;
    const header = await headerOf(id);
    expect(header).toMatchObject({ invoice_number: "INV-7781", currency: "GBP", supplier_vat_id: "GB123456789", total_with_vat: 120 });
    const facts = JSON.parse(header!.facts_json);
    expect(facts["intake.structure"]).toBe("ordinary_pdf");
    expect(facts["intake.read"]).toBe("pdf_text");
    const lines = await env.DB.prepare("SELECT description, amount FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number").bind(id).all();
    expect(lines.results).toEqual([{ description: "Courier service, same-day", amount: 75 }, { description: "Pallet wrap", amount: 25 }]);
  });

  it("reads a scanned PDF from its page picture, as a photograph", async () => {
    const { model, calls } = recordingModel();
    const result = await handleCaptureFromSource(env.DB, "src-mail", SCANNED(), model);
    expect(result.status).toBe(201);
    expect(calls).toHaveLength(1);
    expect(calls[0].images).toHaveLength(1);
    expect(calls[0].images[0].contentType).toBe("image/png");
    const facts = JSON.parse((await headerOf((result.body as { id: string }).id))!.facts_json);
    expect(facts["intake.read"]).toBe("pdf_images");
    expect(facts["BT-1"]).toBe("INV-7781");
  });

  it("keeps a PDF with nothing to read as an invoice for a person to key, as before", async () => {
    const { model, calls } = recordingModel();
    const result = await handleCaptureFromSource(env.DB, "src-mail", fromBase64(PLAIN_NO_ATTACHMENT_B64), model);
    expect(result.status).toBe(201);
    expect(calls).toHaveLength(0);
    const facts = JSON.parse((await headerOf((result.body as { id: string }).id))!.facts_json);
    expect(facts["intake.structure"]).toBe("");
  });
});

describe("the viewer's 'could not be read' note (decision 0683)", () => {
  beforeEach(async () => {
    await applyTestSchema();
  });

  const readable = async (facts: Record<string, unknown>) => {
    await handleUpsertInvoice(env.DB, { id: "inv-r", facts });
    return ((await handleGetInvoice(env.DB, "inv-r")).body as { intake: { readable: boolean } }).intake.readable;
  };

  it("is shown only for a document capture said nothing could read", async () => {
    expect(await readable({ "intake.structure": "" })).toBe(false);
  });

  it("is not shown for a photograph or an XML upload, which never record a structure", async () => {
    expect(await readable({ "BT-1": "X-1" })).toBe(true);
  });

  it("is not shown for an ordinary PDF that was read", async () => {
    expect(await readable({ "intake.structure": "ordinary_pdf", "intake.read": "pdf_text" })).toBe(true);
  });
});
