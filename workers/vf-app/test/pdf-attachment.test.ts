import { describe, expect, it } from "vitest";
import {
  extractEmbeddedInvoiceXml,
  looksLikePdf,
  PdfExtractionError,
} from "../src/pdf-attachment.js";
// Real PDF files, byte-accurate rather than mocked: the whole point of
// this module is parsing genuine PDF structure, and a hand-stubbed
// "PDF" would prove nothing about whether it works. Base64-encoded
// into a .ts module so the bytes survive bundling — the same reason
// migrations are imported via ?raw elsewhere in this project.
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

describe("looksLikePdf", () => {
  it("recognises a real PDF by its header", () => {
    expect(looksLikePdf(facturxPlain)).toBe(true);
  });

  it("rejects something that is not a PDF at all", () => {
    expect(looksLikePdf(new TextEncoder().encode("<?xml version=\"1.0\"?><Invoice/>"))).toBe(false);
  });

  it("rejects an empty or truncated input rather than reading past the end", () => {
    expect(looksLikePdf(new Uint8Array(0))).toBe(false);
    expect(looksLikePdf(new Uint8Array([0x25, 0x50]))).toBe(false);
  });
});

describe("extractEmbeddedInvoiceXml — the hybrid (Factur-X / ZUGFeRD) path", () => {
  it("extracts the embedded invoice from an uncompressed attachment", async () => {
    const result = await extractEmbeddedInvoiceXml(facturxPlain);
    expect(result).not.toBeNull();
    expect(result!.filename).toBe("factur-x.xml");
    expect(result!.xml).toContain("ZUGFERD-2026-001");
    expect(result!.xml).toContain("DE900800700");
  });

  it("extracts the embedded invoice from a FlateDecode-compressed attachment", async () => {
    // The common real-world case, and the one that surfaced a genuine
    // off-by-one while prototyping: searching for "endstream" includes
    // the EOL the spec requires before it, which corrupts the
    // compressed data. /Length is used instead.
    const result = await extractEmbeddedInvoiceXml(facturxCompressed);
    expect(result).not.toBeNull();
    expect(result!.xml).toContain("ZUGFERD-2026-001");
  });

  it("produces byte-identical XML whether the attachment was compressed or not", async () => {
    const plain = await extractEmbeddedInvoiceXml(facturxPlain);
    const compressed = await extractEmbeddedInvoiceXml(facturxCompressed);
    expect(compressed!.xml).toBe(plain!.xml);
  });

  it("resolves PDF name escapes — the filename never appears literally in the file", async () => {
    // Real producers write (factur\055x\056xml), so a reader looking
    // for the literal string "factur-x.xml" would find nothing.
    const asText = new TextDecoder("latin1").decode(facturxPlain);
    expect(asText).not.toContain("factur-x.xml");
    const result = await extractEmbeddedInvoiceXml(facturxPlain);
    expect(result!.filename).toBe("factur-x.xml");
  });

  it("returns null for an ordinary PDF with no attachment — not an error", async () => {
    // The distinction matters to the caller: null means "treat this as
    // an image", an error means "this looks like a hybrid and
    // something is wrong with it".
    expect(await extractEmbeddedInvoiceXml(plainNoAttachment)).toBeNull();
  });

  it("throws for a PDF whose attachment is not XML at all", async () => {
    // Declares an embedded file, but it decompresses to plain text.
    // Passing that to the UBL parser as if it were an invoice would be
    // worse than refusing.
    await expect(extractEmbeddedInvoiceXml(attachmentNotXml)).rejects.toThrow(PdfExtractionError);
  });

  it("throws for something that is not a PDF at all, with a clear reason", async () => {
    const notPdf = new TextEncoder().encode("<?xml version=\"1.0\"?><Invoice/>");
    await expect(extractEmbeddedInvoiceXml(notPdf)).rejects.toThrow(/not a PDF/);
  });

  it("never invents an invoice — the extracted XML is exactly what was embedded", async () => {
    const result = await extractEmbeddedInvoiceXml(facturxPlain);
    // Deterministic container parsing, not inference: every value in
    // the output must be present verbatim in the source.
    expect(result!.xml).toContain("<cbc:ID>ZUGFERD-2026-001</cbc:ID>");
    expect(result!.xml).toContain("1190.00");
    expect(result!.xml.startsWith("<?xml")).toBe(true);
  });
});
