import { describe, expect, it } from "vitest";
import {
  buildExtractionPrompt,
  buildExtractionSchema,
  parseExtractionResponse,
  extractInvoiceFromImage,
  sniffImageType,
  toDataUrl,
  ExtractionRefusal,
  type ExtractionModel,
} from "../src/extraction.js";
import { resolveVocabulary } from "@vibefinance/shared";
import { VISION_SHAPES, extractResponseText } from "../src/extraction-model.js";

/** A model that returns exactly what it's told to. The real model's
 *  accuracy cannot be tested here — env.AI has no local simulation —
 *  but everything AROUND it can be, and that is where the refusal and
 *  coercion logic lives. */
function fakeModel(response: string): ExtractionModel {
  return { extract: async () => response };
}

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const GOOD = JSON.stringify({
  "invoiceNumber": "INV-2026-0042",
  "issueDate": "2026-09-02",
  "currencyCode": "EUR",
  "supplierVatNumber": "DE900800700",
  "totalWithVat": 1190.0,
  _confidence: 0.94,
});

describe("sniffImageType — trusts the bytes, not the header", () => {
  it("recognises JPEG and PNG from magic bytes", () => {
    expect(sniffImageType(JPEG)).toBe("image/jpeg");
    expect(sniffImageType(PNG)).toBe("image/png");
  });

  it("returns null for a PDF — which must never reach the image path", () => {
    expect(sniffImageType(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
  });

  it("returns null for something that is not an image at all", () => {
    expect(sniffImageType(new TextEncoder().encode("<Invoice/>"))).toBeNull();
  });
});

describe("toDataUrl", () => {
  it("produces a data URL the model can consume", () => {
    expect(toDataUrl(JPEG, "image/jpeg")).toMatch(/^data:image\/jpeg;base64,/);
  });
});

describe("buildExtractionSchema", () => {
  it("makes every extractable field nullable — a field that cannot be read must come back null, never invented", () => {
    const schema = buildExtractionSchema() as { properties: Record<string, { type: string[] }> };
    expect(schema.properties["invoiceNumber"].type).toEqual(["string", "null"]);
    expect(schema.properties["totalWithVat"].type).toEqual(["number", "null"]);
  });

  it("requires EVERY property, not just the confidence score", () => {
    // Measured, not stylistic: with only _confidence required, the
    // model silently omitted six of fourteen properties from a real
    // response, including the invoice total.
    const schema = buildExtractionSchema() as { required: string[]; properties: Record<string, unknown> };
    expect(schema.required.sort()).toEqual(Object.keys(schema.properties).sort());
    expect(schema.required).toContain("totalWithVat");
    expect(schema.required).toContain("_confidence");
  });

  it("asks the model in human terms, never in Business Term ids", () => {
    // The measured failure this prevents: with BT-* keys the model
    // returned the buyer's name for BT-1 and a postal address for
    // BT-2. "BT-31" carries no information to a vision model;
    // "supplierVatNumber" carries all of it.
    const schema = buildExtractionSchema() as { properties: Record<string, unknown> };
    for (const key of Object.keys(schema.properties)) {
      expect(key).not.toMatch(/^B[TG]-\d+$/);
    }
    expect(schema.properties.invoiceNumber).toBeTruthy();
    expect(schema.properties.supplierVatNumber).toBeTruthy();
  });

  it("includes a customer's own declared fields, using their own descriptions", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.transport_reference", label: "Transport Reference", type: "text", description: "The carrier consignment reference" },
    ]);
    const schema = buildExtractionSchema(v) as { properties: Record<string, { description: string }> };
    expect(schema.properties["transport_reference"].description).toBe("The carrier consignment reference");
  });

  it("types a custom number field as a number, so coercion can be enforced", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.pallet_count", label: "Pallets", type: "number", description: "how many pallets" },
    ]);
    const schema = buildExtractionSchema(v) as { properties: Record<string, { type: string[] }> };
    expect(schema.properties["pallet_count"].type).toEqual(["number", "null"]);
  });
});

describe("buildExtractionPrompt", () => {
  it("tells the model to return null rather than guess", () => {
    expect(buildExtractionPrompt()).toMatch(/Never guess/);
  });

  it("tells the model to refuse an ambiguous date rather than choose", () => {
    expect(buildExtractionPrompt()).toMatch(/ambiguous/);
  });

  it("names customer-defined fields as the customer's own, not part of any standard", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.x", label: "X", type: "text", description: "a custom one" },
    ]);
    expect(buildExtractionPrompt(v)).toContain("not part of any standard");
  });
});

describe("parseExtractionResponse — the refusal boundary", () => {
  it("extracts a well-formed response into real facts", () => {
    const result = parseExtractionResponse(GOOD);
    expect(result.facts["BT-1"]).toBe("INV-2026-0042");
    expect(result.facts["BT-112"]).toBe(1190);
    expect(result.confidence).toBe(0.94);
  });

  it("exposes confidence as a real derived fact, so customers can write rules against it", () => {
    const result = parseExtractionResponse(GOOD);
    expect(result.facts["extraction.confidence"]).toBe(0.94);
  });

  it("reports which fields could not be read, rather than silently omitting them", () => {
    const result = parseExtractionResponse(GOOD);
    // BT-9 and BT-110 were never in the response at all.
    expect(result.missingFields).toContain("BT-9");
    expect(result.missingFields).toContain("BT-110");
    expect(result.missingFields).not.toContain("BT-1");
  });

  it("refuses a response that is not valid JSON", () => {
    expect(() => parseExtractionResponse("I could not read this invoice, sorry")).toThrow(ExtractionRefusal);
  });

  it("refuses a response with no confidence score — an unmeasured extraction is not a usable one", () => {
    expect(() => parseExtractionResponse(JSON.stringify({ "invoiceNumber": "INV-1" }))).toThrow(/confidence/);
  });

  it("refuses when nothing at all could be read, rather than storing an empty invoice", () => {
    // An empty invoice stored successfully would be indistinguishable
    // from a real but sparse one.
    expect(() => parseExtractionResponse(JSON.stringify({ _confidence: 0.2 }))).toThrow(/no fields/);
  });

  it("clamps a confidence score outside 0..1 rather than trusting it", () => {
    const high = parseExtractionResponse(JSON.stringify({ "invoiceNumber": "X", _confidence: 5 }));
    expect(high.confidence).toBe(1);
    const low = parseExtractionResponse(JSON.stringify({ "invoiceNumber": "X", _confidence: -3 }));
    expect(low.confidence).toBe(0);
  });
});

describe("parseExtractionResponse — type coercion (decision 0041's types doing real work)", () => {
  it("accepts a numeric amount returned as a clean string", () => {
    const r = parseExtractionResponse(JSON.stringify({ "totalWithVat": "1190.00", _confidence: 0.9 }));
    expect(r.facts["BT-112"]).toBe(1190);
  });

  it("tolerates a stray currency symbol", () => {
    const r = parseExtractionResponse(JSON.stringify({ "totalWithVat": "€1190.00", _confidence: 0.9 }));
    expect(r.facts["BT-112"]).toBe(1190);
  });

  it("REFUSES a number expressed as prose, rather than silently reading a value out of it", () => {
    // "approximately 500" must not become 500. This is the exact
    // failure decision 0041 designed the type system to prevent.
    const r = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "totalWithVat": "approximately 500", _confidence: 0.5 })
    );
    expect(r.facts["BT-112"]).toBeUndefined();
    expect(r.missingFields).toContain("BT-112");
  });

  it("refuses a date that is not YYYY-MM-DD, rather than guessing day-versus-month", () => {
    const r = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "issueDate": "03/04/2026", _confidence: 0.5 })
    );
    expect(r.facts["BT-2"]).toBeUndefined();
    expect(r.missingFields).toContain("BT-2");
  });

  it("refuses a date that is well-formed but impossible", () => {
    const r = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "issueDate": "2026-13-45", _confidence: 0.5 })
    );
    expect(r.missingFields).toContain("BT-2");
  });

  it("treats an empty string as unreadable, not as a real value", () => {
    const r = parseExtractionResponse(JSON.stringify({ "invoiceNumber": "INV-1", "currencyCode": "   ", _confidence: 0.5 }));
    expect(r.facts["BT-5"]).toBeUndefined();
    expect(r.missingFields).toContain("BT-5");
  });

  it("coerces a customer's own number field with the same strictness", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.pallet_count", label: "Pallets", type: "number", description: "x" },
    ]);
    const good = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "pallet_count": 12, _confidence: 0.9 }),
      v
    );
    expect(good.facts["custom.pallet_count"]).toBe(12);

    const bad = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "pallet_count": "a dozen", _confidence: 0.9 }),
      v
    );
    expect(bad.missingFields).toContain("custom.pallet_count");
  });
});

describe("extractInvoiceFromImage", () => {
  it("extracts from a real JPEG byte signature", async () => {
    const result = await extractInvoiceFromImage(fakeModel(GOOD), JPEG);
    expect(result.facts["BT-1"]).toBe("INV-2026-0042");
  });

  it("refuses a PDF outright — it must never reach a model this way", async () => {
    const pdf = new TextEncoder().encode("%PDF-1.7 ...");
    await expect(extractInvoiceFromImage(fakeModel(GOOD), pdf)).rejects.toThrow(/unsupported image format/);
  });

  it("passes the customer's resolved vocabulary through to the schema", async () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.transport_reference", label: "TR", type: "text", description: "the carrier ref" },
    ]);
    let seenSchema: Record<string, unknown> | undefined;
    const spy: ExtractionModel = {
      extract: async (_p, _i, schema) => {
        seenSchema = schema;
        return JSON.stringify({ "invoiceNumber": "X", "transport_reference": "TR-88431", _confidence: 0.9 });
      },
    };
    const result = await extractInvoiceFromImage(spy, JPEG, v);
    expect((seenSchema as { properties: Record<string, unknown> }).properties["transport_reference"]).toBeTruthy();
    expect(result.facts["custom.transport_reference"]).toBe("TR-88431");
  });

  it("hands the adapter raw bytes and a sniffed content type, not a pre-built data URL", async () => {
    let seenImage: { bytes: Uint8Array; contentType: string } | undefined;
    const spy: ExtractionModel = {
      extract: async (_p, image) => {
        seenImage = image;
        return GOOD;
      },
    };
    await extractInvoiceFromImage(spy, PNG);
    // Raw bytes and a detected content type, NOT a pre-built data
    // URL — corrected after the live test showed the binding wants
    // the image as its own top-level parameter, and each adapter
    // must be free to encode it accordingly.
    expect(seenImage?.contentType).toBe("image/png");
    expect(seenImage?.bytes).toEqual(PNG);
  });
});

describe("VISION_SHAPES — the confirmed shape", () => {
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const SCHEMA = { type: "object" };

  it("is a single confirmed shape, not a list of guesses", () => {
    // Verified live: prompt_tokens 1063 and correct answers, against
    // 46 and "NO IMAGE RECEIVED" for every alternative.
    expect(VISION_SHAPES).toHaveLength(1);
    expect(VISION_SHAPES[0].label).toBe("image_url-data-url");
  });

  it("sends an image_url content part inside messages", () => {
    const built = VISION_SHAPES[0].build("read this", JPEG_BYTES, "image/jpeg", SCHEMA);
    expect(JSON.stringify(built.messages)).toContain("image_url");
  });

  it("sends a full data: URL — bare base64 is rejected by the binding", () => {
    // The binding's own error: "The URL must be either a HTTP, data
    // or file URL."
    const built = VISION_SHAPES[0].build("read this", JPEG_BYTES, "image/jpeg", SCHEMA);
    expect(JSON.stringify(built.messages)).toContain("data:image/jpeg;base64,");
  });

  it("never uses a top-level image parameter — that shape is silently ignored by this model", () => {
    // The failure that cost two deploy cycles: it belongs to
    // llama-3.2-11b-vision-instruct, and Llama 4 Scout drops it with
    // no error at all.
    const built = VISION_SHAPES[0].build("read this", JPEG_BYTES, "image/jpeg", SCHEMA);
    expect(built.image).toBeUndefined();
  });

  it("carries the schema, token budget and zero temperature", () => {
    const built = VISION_SHAPES[0].build("x", JPEG_BYTES, "image/jpeg", SCHEMA);
    expect(built.guided_json).toBe(SCHEMA);
    expect(built.max_tokens).toBe(4096);
    expect(built.temperature).toBe(0);
  });

  it("carries the actual image bytes", () => {
    const distinctive = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x12, 0x34, 0x56]);
    const expected = btoa(String.fromCharCode(...distinctive));
    const serialised = JSON.stringify(VISION_SHAPES[0].build("x", distinctive, "image/jpeg", SCHEMA));
    expect(serialised).toContain(expected);
  });
});

describe("coercion and prompt fixes from the live test", () => {
  it("accepts a thousands separator — every real invoice total has one", () => {
    // £2,518.80 on the real test invoice would have failed the
    // original parser even if the model had read it correctly.
    const r = parseExtractionResponse(JSON.stringify({ "totalWithVat": "£2,518.80", _confidence: 0.9 }));
    expect(r.facts["BT-112"]).toBe(2518.8);
  });

  it("handles larger groupings", () => {
    const r = parseExtractionResponse(JSON.stringify({ "totalWithVat": "1,234,567.89", _confidence: 0.9 }));
    expect(r.facts["BT-112"]).toBe(1234567.89);
  });

  it("still refuses commas in nonsense positions rather than stripping them blindly", () => {
    const r = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "totalWithVat": "1,2,3", _confidence: 0.9 })
    );
    expect(r.facts["BT-112"]).toBeUndefined();
  });

  it("still refuses prose, which the thousands fix must not have loosened", () => {
    const r = parseExtractionResponse(
      JSON.stringify({ "invoiceNumber": "INV-1", "totalWithVat": "approximately 2,518.80", _confidence: 0.9 })
    );
    expect(r.facts["BT-112"]).toBeUndefined();
  });

  it("tells the model an invoice number is never a company name — the exact confusion seen live", () => {
    // The model returned "Mcdonalds UK" (the buyer) as BT-1.
    expect(buildExtractionPrompt()).toMatch(/never a company name/i);
  });

  it("names the supplier-versus-buyer distinction explicitly in the prompt", () => {
    const prompt = buildExtractionPrompt();
    expect(prompt).toMatch(/SUPPLIER/);
    expect(prompt).toMatch(/BUYER/);
    expect(prompt).toMatch(/Bill To/);
  });

  it("describes BT-1 as a reference code, not just 'the invoice number'", () => {
    const schema = buildExtractionSchema() as { properties: Record<string, { description: string }> };
    expect(schema.properties["invoiceNumber"].description).toMatch(/never a company name/i);
  });

  it("distinguishes supplier and buyer VAT numbers in their own descriptions", () => {
    const schema = buildExtractionSchema() as { properties: Record<string, { description: string }> };
    expect(schema.properties["supplierVatNumber"].description).toMatch(/SUPPLIER/);
    expect(schema.properties["buyerVatNumber"].description).toMatch(/BUYER/);
  });
});

describe("extractResponseText — the real Workers AI response shape", () => {
  // Captured verbatim from the live diagnostic, not invented. The
  // structure matters: Workers AI returns BOTH a top-level `response`
  // AND choices[0].message.content, and reading the wrong one turned
  // a correct extraction into "no fields could be read".
  const REAL_GUIDED_RESPONSE = {
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: {
          content: '{ \n"invoiceNumber": "MCD2001321-003", \n"totalWithVat": 2518.80 \n}',
          role: "assistant",
        },
      },
    ],
    response: "Some unrelated plain-text summary",
    usage: { prompt_tokens: 1063, completion_tokens: 30 },
  };

  it("reads the schema-conformant JSON from message.content, not the top-level response string", () => {
    const text = extractResponseText(REAL_GUIDED_RESPONSE);
    expect(JSON.parse(text)).toEqual({ invoiceNumber: "MCD2001321-003", totalWithVat: 2518.8 });
  });

  it("does NOT return the top-level response when it is prose and real JSON exists elsewhere", () => {
    // The exact bug: "NO IMAGE RECEIVED" (or any prose) was returned
    // in preference to genuine JSON, and then failed to parse.
    expect(extractResponseText(REAL_GUIDED_RESPONSE)).not.toContain("unrelated plain-text");
  });

  it("still handles the classic Workers AI shape, where response IS the JSON", () => {
    const classic = { response: '{"BT-1":"INV-1"}' };
    expect(JSON.parse(extractResponseText(classic))).toEqual({ "BT-1": "INV-1" });
  });

  it("re-serialises an already-parsed object, so the parser has one thing to handle", () => {
    const parsed = { response: { "BT-1": "INV-1" } };
    expect(JSON.parse(extractResponseText(parsed))).toEqual({ "BT-1": "INV-1" });
  });

  it("falls back to prose when there genuinely is no JSON anywhere — so the refusal names what came back", () => {
    const prose = { response: "NO IMAGE RECEIVED", choices: [{ message: { content: "NO IMAGE RECEIVED" } }] };
    expect(extractResponseText(prose)).toBe("NO IMAGE RECEIVED");
  });

  it("never throws on an unrecognised shape", () => {
    expect(() => extractResponseText({ something: "unexpected" })).not.toThrow();
    expect(() => extractResponseText(null)).not.toThrow();
  });
});

describe("the real failure this fix addresses", () => {
  it("the model's actual BT-keyed response was nonsense — captured verbatim from the live diagnostic", () => {
    // What Llama 4 Scout returned when the schema used Business Term
    // ids as property names, against a clear invoice it could read
    // perfectly well. BT-1 got the BUYER's name; BT-2, a date field,
    // got a postal address. Six of fourteen properties were omitted
    // entirely, including the total.
    const actualBadResponse = JSON.stringify({
      "BT-1": "Mcdonalds UK",
      "BT-2": "11-59 High Road, East Finchley, London, N2 8AW, United Kingdom",
      "BT-31": null,
      "BT-40": null,
      "BT-5": null,
      "BT-9": null,
      _confidence: 0.9,
    });
    // Under the corrected schema those keys mean nothing, so NOTHING
    // is readable — and the code refuses outright rather than
    // storing a postal address as an issue date. A refusal is the
    // right outcome here: this response contained no usable data.
    expect(() => parseExtractionResponse(actualBadResponse)).toThrow(ExtractionRefusal);
  });

  it("the same invoice, answered in human terms, extracts correctly", () => {
    // The model reads this invoice perfectly — it just could not map
    // opaque codes to meanings.
    const goodResponse = JSON.stringify({
      invoiceNumber: "MCD2001321-003",
      totalWithVat: "£2,518.80",
      supplierVatNumber: "GB907856452",
      currencyCode: "GBP",
      _confidence: 0.95,
    });
    const result = parseExtractionResponse(goodResponse);
    expect(result.facts["BT-1"]).toBe("MCD2001321-003");
    expect(result.facts["BT-112"]).toBe(2518.8);
    expect(result.facts["BT-31"]).toBe("GB907856452");
    expect(result.facts["BT-5"]).toBe("GBP");
  });

  it("maps every prompt key back to its Business Term, with no key left unmapped", () => {
    const schema = buildExtractionSchema() as { properties: Record<string, unknown> };
    const promptKeys = Object.keys(schema.properties).filter((k) => k !== "_confidence");
    const response: Record<string, unknown> = { _confidence: 0.9 };
    for (const key of promptKeys) response[key] = "X";
    const result = parseExtractionResponse(JSON.stringify(response));
    // Text fields land as facts; numeric and date ones correctly
    // refuse "X". What matters is that nothing is silently dropped.
    const accounted = Object.keys(result.facts).filter((k) => k !== "extraction.confidence").length + result.missingFields.length;
    expect(accounted).toBe(promptKeys.length);
  });
});
