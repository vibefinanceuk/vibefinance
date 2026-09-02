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
  "BT-1": "INV-2026-0042",
  "BT-2": "2026-09-02",
  "BT-5": "EUR",
  "BT-31": "DE900800700",
  "BT-112": 1190.0,
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
    expect(schema.properties["BT-1"].type).toEqual(["string", "null"]);
    expect(schema.properties["BT-112"].type).toEqual(["number", "null"]);
  });

  it("requires only the confidence score", () => {
    const schema = buildExtractionSchema() as { required: string[] };
    expect(schema.required).toEqual(["_confidence"]);
  });

  it("includes a customer's own declared fields, using their own descriptions", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.transport_reference", label: "Transport Reference", type: "text", description: "The carrier consignment reference" },
    ]);
    const schema = buildExtractionSchema(v) as { properties: Record<string, { description: string }> };
    expect(schema.properties["custom.transport_reference"].description).toBe("The carrier consignment reference");
  });

  it("types a custom number field as a number, so coercion can be enforced", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.pallet_count", label: "Pallets", type: "number", description: "how many pallets" },
    ]);
    const schema = buildExtractionSchema(v) as { properties: Record<string, { type: string[] }> };
    expect(schema.properties["custom.pallet_count"].type).toEqual(["number", "null"]);
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
    expect(() => parseExtractionResponse(JSON.stringify({ "BT-1": "INV-1" }))).toThrow(/confidence/);
  });

  it("refuses when nothing at all could be read, rather than storing an empty invoice", () => {
    // An empty invoice stored successfully would be indistinguishable
    // from a real but sparse one.
    expect(() => parseExtractionResponse(JSON.stringify({ _confidence: 0.2 }))).toThrow(/no fields/);
  });

  it("clamps a confidence score outside 0..1 rather than trusting it", () => {
    const high = parseExtractionResponse(JSON.stringify({ "BT-1": "X", _confidence: 5 }));
    expect(high.confidence).toBe(1);
    const low = parseExtractionResponse(JSON.stringify({ "BT-1": "X", _confidence: -3 }));
    expect(low.confidence).toBe(0);
  });
});

describe("parseExtractionResponse — type coercion (decision 0041's types doing real work)", () => {
  it("accepts a numeric amount returned as a clean string", () => {
    const r = parseExtractionResponse(JSON.stringify({ "BT-112": "1190.00", _confidence: 0.9 }));
    expect(r.facts["BT-112"]).toBe(1190);
  });

  it("tolerates a stray currency symbol", () => {
    const r = parseExtractionResponse(JSON.stringify({ "BT-112": "€1190.00", _confidence: 0.9 }));
    expect(r.facts["BT-112"]).toBe(1190);
  });

  it("REFUSES a number expressed as prose, rather than silently reading a value out of it", () => {
    // "approximately 500" must not become 500. This is the exact
    // failure decision 0041 designed the type system to prevent.
    const r = parseExtractionResponse(
      JSON.stringify({ "BT-1": "INV-1", "BT-112": "approximately 500", _confidence: 0.5 })
    );
    expect(r.facts["BT-112"]).toBeUndefined();
    expect(r.missingFields).toContain("BT-112");
  });

  it("refuses a date that is not YYYY-MM-DD, rather than guessing day-versus-month", () => {
    const r = parseExtractionResponse(
      JSON.stringify({ "BT-1": "INV-1", "BT-2": "03/04/2026", _confidence: 0.5 })
    );
    expect(r.facts["BT-2"]).toBeUndefined();
    expect(r.missingFields).toContain("BT-2");
  });

  it("refuses a date that is well-formed but impossible", () => {
    const r = parseExtractionResponse(
      JSON.stringify({ "BT-1": "INV-1", "BT-2": "2026-13-45", _confidence: 0.5 })
    );
    expect(r.missingFields).toContain("BT-2");
  });

  it("treats an empty string as unreadable, not as a real value", () => {
    const r = parseExtractionResponse(JSON.stringify({ "BT-1": "INV-1", "BT-5": "   ", _confidence: 0.5 }));
    expect(r.facts["BT-5"]).toBeUndefined();
    expect(r.missingFields).toContain("BT-5");
  });

  it("coerces a customer's own number field with the same strictness", () => {
    const v = resolveVocabulary("invoice", [
      { key: "custom.pallet_count", label: "Pallets", type: "number", description: "x" },
    ]);
    const good = parseExtractionResponse(
      JSON.stringify({ "BT-1": "INV-1", "custom.pallet_count": 12, _confidence: 0.9 }),
      v
    );
    expect(good.facts["custom.pallet_count"]).toBe(12);

    const bad = parseExtractionResponse(
      JSON.stringify({ "BT-1": "INV-1", "custom.pallet_count": "a dozen", _confidence: 0.9 }),
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
        return JSON.stringify({ "BT-1": "X", "custom.transport_reference": "TR-88431", _confidence: 0.9 });
      },
    };
    const result = await extractInvoiceFromImage(spy, JPEG, v);
    expect((seenSchema as { properties: Record<string, unknown> }).properties["custom.transport_reference"]).toBeTruthy();
    expect(result.facts["custom.transport_reference"]).toBe("TR-88431");
  });

  it("sends the image as a data URL, not raw bytes", async () => {
    let seenImage = "";
    const spy: ExtractionModel = {
      extract: async (_p, image) => {
        seenImage = image;
        return GOOD;
      },
    };
    await extractInvoiceFromImage(spy, PNG);
    expect(seenImage).toMatch(/^data:image\/png;base64,/);
  });
});
