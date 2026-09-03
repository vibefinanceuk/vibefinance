import { describe, expect, it } from "vitest";
import { detectStructure, looksLikeXml, summariseAttempts } from "../src/detect-structure.js";
import {
  FACTURX_PLAIN_B64,
  FACTURX_COMPRESSED_B64,
  PLAIN_NO_ATTACHMENT_B64,
  ATTACHMENT_NOT_XML_B64,
} from "./fixtures/pdf-fixtures.js";

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const UBL = new TextEncoder().encode(
  `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">
  <cbc:ID>INV-1</cbc:ID>
</Invoice>`
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

describe("detectStructure — the ordering that matters", () => {
  it("sends a real Factur-X to structured_pdfa, not to image", async () => {
    // The whole reason the cascade is ordered. A Factur-X IS a PDF; if
    // the coarse question were asked first, every hybrid document would
    // fall to inference and its embedded invoice would never be opened.
    const result = await detectStructure(fromBase64(FACTURX_PLAIN_B64));
    expect(result.structure).toBe("structured_pdfa");
    expect(result.embeddedXml).toBeTruthy();
  });

  it("handles a Factur-X whose attachment is compressed", async () => {
    const result = await detectStructure(fromBase64(FACTURX_COMPRESSED_B64));
    expect(result.structure).toBe("structured_pdfa");
    expect(result.embeddedXml).toContain("<");
  });

  it("returns the embedded XML so the caller need not extract it twice", async () => {
    const result = await detectStructure(fromBase64(FACTURX_PLAIN_B64));
    expect(result.embeddedXml).toContain("Invoice");
  });
});

describe("detectStructure — the cases with no structure", () => {
  it("does not claim a structure for a PDF carrying no invoice", async () => {
    // A scan or an export. It genuinely needs a vision model, and a PDF
    // cannot be rasterised inside a Worker, so no handler can read it.
    const result = await detectStructure(fromBase64(PLAIN_NO_ATTACHMENT_B64));
    expect(result.structure).toBeNull();
  });

  it("distinguishes 'no invoice present' from 'declared but unreadable'", async () => {
    // One is a supplier who has not adopted e-invoicing; the other is a
    // supplier whose implementation is broken. Opposite conversations.
    const none = await detectStructure(fromBase64(PLAIN_NO_ATTACHMENT_B64));
    const broken = await detectStructure(fromBase64(ATTACHMENT_NOT_XML_B64));

    const noneOutcome = none.attempted.find((a) => a.test === "embedded_invoice_xml")?.outcome;
    const brokenOutcome = broken.attempted.find((a) => a.test === "embedded_invoice_xml")?.outcome;
    expect(noneOutcome).toBe("none present");
    expect(brokenOutcome).not.toBe("none present");
    expect(broken.structure).toBeNull();
  });

  it("returns no structure for an empty document rather than guessing", async () => {
    const result = await detectStructure(new Uint8Array([]));
    expect(result.structure).toBeNull();
    expect(result.attempted[0].test).toBe("empty");
  });

  it("returns no structure for bytes that are nothing in particular", async () => {
    const result = await detectStructure(new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04]));
    expect(result.structure).toBeNull();
    // Every test was tried and recorded, so a refusal can say what was
    // attempted rather than only that nothing matched.
    expect(result.attempted.map((a) => a.test)).toEqual([
      "pdf_header",
      "xml_declaration",
      "image_magic_bytes",
    ]);
  });
});

describe("detectStructure — XML and images", () => {
  it("detects a UBL document as structured_xml", async () => {
    expect((await detectStructure(UBL)).structure).toBe("structured_xml");
  });

  it("detects JPEG and PNG by magic bytes, not by a declared content type", async () => {
    // A filename or a caller's content type can both be wrong.
    expect((await detectStructure(JPEG)).structure).toBe("image");
    expect((await detectStructure(PNG)).structure).toBe("image");
  });

  it("does not mistake an image for XML", async () => {
    const result = await detectStructure(PNG);
    expect(result.attempted.find((a) => a.test === "xml_declaration")?.outcome).toBe("not XML");
  });
});

describe("looksLikeXml", () => {
  it("accepts a declaration and a bare opening element", () => {
    expect(looksLikeXml(new TextEncoder().encode('<?xml version="1.0"?><a/>'))).toBe(true);
    expect(looksLikeXml(new TextEncoder().encode("<Invoice></Invoice>"))).toBe(true);
  });

  it("tolerates leading whitespace", () => {
    expect(looksLikeXml(new TextEncoder().encode("\n\n  <Invoice/>"))).toBe(true);
  });

  it("sees past a UTF-8 byte order mark", () => {
    // The BOM survives decoding as U+FEFF and would otherwise make an
    // ordinary XML document look like it starts with something else.
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("<Invoice/>")]);
    expect(looksLikeXml(withBom)).toBe(true);
  });

  it("rejects prose and binary", () => {
    expect(looksLikeXml(new TextEncoder().encode("Dear Sir, please find attached"))).toBe(false);
    expect(looksLikeXml(PNG)).toBe(false);
  });

  it("is deliberately shallow — malformed XML still looks like XML", () => {
    // Detection picks a handler; the handler is where real parsing and
    // real refusal live. parseUblInvoice already rejects a document
    // that is not well-formed, and judging it twice would mean two
    // places deciding what counts as XML.
    expect(looksLikeXml(new TextEncoder().encode("<Invoice><unclosed>"))).toBe(true);
  });
});

describe("summariseAttempts", () => {
  it("renders the tests as a comma-separated string a rule can test", () => {
    // Matching validation.failures and extraction.conflicts, so the
    // existing contains operator applies and no new operator is needed.
    const summary = summariseAttempts([
      { test: "pdf_header", outcome: "not a PDF" },
      { test: "xml_declaration", outcome: "not XML" },
    ]);
    expect(summary).toBe("pdf_header,xml_declaration");
  });
});
