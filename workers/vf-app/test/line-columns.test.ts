import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { learnColumns, supplierColumns, supplierLayouts, type ColumnEvidence } from "../src/supplier-layouts.js";
import { handleRecordRegion, listRegions, regionTimeline } from "../src/field-regions.js";
import { buildLinesPrompt, buildLinesSchema, readLineRows, buildExtractionSchema } from "../src/extraction.js";
import { DEFAULT_EXTRACTION_SETTINGS } from "../src/extraction-settings.js";
import { columnAsks, hintBeforeReading } from "../src/layout-hints.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import { SCANNED_FLATE_JPEG_PDF_B64 } from "./fixtures/pdf-read-fixtures.js";

/**
 * **A supplier's line table — decision 0705.** Step 4 of
 * docs/design/supplier-layout-learning.md.
 */

function col(invoiceId: string, field: string, x: number, heading: string | null, source: ColumnEvidence["source"] = "found"): ColumnEvidence {
  return { invoiceId, field, x: x - 0.02, w: 0.04, heading, source };
}

describe("learnColumns", () => {
  it("learns a column from three invoices, each counted once however many lines it has", () => {
    const evidence = [
      ...[0, 1, 2, 3, 4, 5].map(() => col("i1", "BT-129", 0.6, "menge")),
      col("i2", "BT-129", 0.61, "menge"),
    ];
    expect(learnColumns(evidence)).toEqual([]);
    const [quantity] = learnColumns([...evidence, col("i3", "BT-129", 0.59, "menge")]);
    expect(quantity).toMatchObject({ field: "BT-129", heading: "menge", evidence: 3, disagreements: 0 });
    expect(quantity.x).toBeCloseTo(0.6, 2);
  });

  it("learns from one correction alone, and orders columns across the page", () => {
    const columns = learnColumns([col("i1", "BT-146", 0.75, "einzelpreis", "lassoed_corrected"), col("i1", "BT-129", 0.6, "menge", "lassoed_corrected")]);
    expect(columns.map((c) => c.field)).toEqual(["BT-129", "BT-146"]);
  });

  it("does not take two headings for one column", () => {
    expect(learnColumns([col("i1", "BT-129", 0.6, "menge"), col("i2", "BT-129", 0.6, "anzahl"), col("i3", "BT-129", 0.6, "menge")])).toEqual([]);
  });

  it("leaves out a column the evidence disagrees on", () => {
    const evidence = [col("i1", "BT-152", 0.5, "mwst"), col("i2", "BT-152", 0.5, "mwst"), col("i3", "BT-152", 0.5, "mwst"), col("i4", "BT-152", 0.8, "mwst"), col("i5", "BT-152", 0.8, "mwst"), col("i6", "BT-152", 0.3, "mwst"), col("i7", "BT-152", 0.3, "mwst")];
    expect(learnColumns(evidence)).toEqual([]);
  });
});

describe("the lines reading asks for known columns only", () => {
  const asks = [
    { field: "BT-129" as const, heading: "menge" },
    { field: "BT-146" as const, heading: "einzelpreis" },
  ];

  it("adds the columns to the schema, required like the others", () => {
    const schema = buildLinesSchema(DEFAULT_EXTRACTION_SETTINGS, asks) as { properties: { lines: { items: { properties: Record<string, unknown>; required: string[] } } } };
    expect(schema.properties.lines.items.required).toEqual(["description", "amount", "quantity", "unitPrice"]);
    const plain = buildLinesSchema(DEFAULT_EXTRACTION_SETTINGS) as typeof schema;
    expect(plain.properties.lines.items.required).toEqual(["description", "amount"]);
  });

  it("says which heading each is under", () => {
    const prompt = buildLinesPrompt(1, undefined, asks);
    expect(prompt).toContain('- quantity: the quantity invoiced, a plain number, in the column headed "menge"');
    expect(prompt).toContain('- unitPrice: the price of one unit, excluding VAT');
    expect(buildLinesPrompt(1)).not.toContain("also has these columns");
  });

  it("the text reading's schema carries them too", () => {
    const schema = buildExtractionSchema("invoice", DEFAULT_EXTRACTION_SETTINGS, { columns: asks }) as { properties: { lines: { items: { required: string[] } } } };
    expect(schema.properties.lines.items.required).toContain("quantity");
  });

  it("puts each column read in its field, and a column it cannot read does not lose the row", () => {
    const read = readLineRows([
      { description: "Kopierpapier A4", amount: 1234.5, quantity: 10, unitPrice: 123.45, vatRate: 19 },
      { description: "Toner", amount: 180, quantity: "zwei", unitPrice: null },
    ]);
    expect(read.lines).toEqual([
      { lineNumber: 1, "BT-131": 1234.5, "BT-153": "Kopierpapier A4", "BT-129": 10, "BT-146": 123.45, "BT-152": 19 },
      { lineNumber: 2, "BT-131": 180, "BT-153": "Toner" },
    ]);
  });

  it("asks only for quantity, unit price and VAT rate, never the columns always read", () => {
    expect(
      columnAsks([
        { field: "BT-153", x: 0.2, w: 0.3, heading: "beschreibung", evidence: 3, disagreements: 0 },
        { field: "BT-129", x: 0.6, w: 0.05, heading: "menge", evidence: 3, disagreements: 0 },
        { field: "BT-131", x: 0.9, w: 0.08, heading: "betrag", evidence: 3, disagreements: 0 },
      ])
    ).toEqual([{ field: "BT-129", heading: "menge" }]);
  });
});

describe("line regions and the supplier's table, from the database", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan')").run();
    await env.DB.prepare("INSERT INTO suppliers (id, name, email) VALUES ('sup-ln', 'Lager Nord GmbH', 'billing@lager-nord.de')").run();
  });

  async function invoiceWithLine(id: string, quantity = 10) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, '{}', 'sup-ln')").bind(id).run();
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, facts_json) VALUES (?, ?, 1, ?)")
      .bind(`${id}-l1`, id, JSON.stringify({ "BT-129": quantity, "BT-131": 100 }))
      .run();
    const r = await handleRecordRegion(env.DB, id, "line.1.BT-129", "u-dan", { pageNumber: 1, box: { x: 0.58, y: 0.3, w: 0.04, h: 0.015 }, label: "Menge", value: String(quantity), source: "found" });
    expect(r.status).toBe(200);
  }

  it("records a line value's place, current while it is still the line's", async () => {
    await invoiceWithLine("i1");
    const [region] = (await listRegions(env.DB, "i1"))!;
    expect(region).toMatchObject({ field: "line.1.BT-129", label: "menge", current: true });
    await env.DB.prepare(`UPDATE invoice_lines SET facts_json = '{"BT-129": 11, "BT-131": 100}' WHERE id = 'i1-l1'`).run();
    expect((await listRegions(env.DB, "i1"))![0].current).toBe(false);
  });

  it("refuses a line field that is not one of the table's columns", async () => {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES ('i1', '{}')").run();
    const r = await handleRecordRegion(env.DB, "i1", "line.1.BT-133", "u-dan", { pageNumber: 1, box: { x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, value: "x", source: "found" });
    expect(r.status).toBe(400);
  });

  it("learns the supplier's columns, apart from its header layout, and tells the reading", async () => {
    await invoiceWithLine("i1");
    await invoiceWithLine("i2", 3);
    await invoiceWithLine("i3", 7);
    expect(await supplierColumns(env.DB, "sup-ln")).toEqual([expect.objectContaining({ field: "BT-129", heading: "menge", evidence: 3 })]);
    // A line's place is not a header field's.
    expect((await supplierLayouts(env.DB, "sup-ln")).layouts).toEqual([]);
    expect(await regionTimeline(env.DB, "i1")).toEqual([]);

    const hint = (await hintBeforeReading(env.DB, "billing@lager-nord.de"))!;
    expect(hint.text).toBeNull();
    expect(hint.columns).toEqual([{ field: "BT-129", heading: "menge" }]);

    await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
    await handleCreateStage(env.DB, "ap", { id: "received", name: "Received", sequence: 1 });
    await handleCreateIntakeChannel(env.DB, "ap", { id: "ch-image", name: "Image", structure: "image" });
    await handleCreateSource(env.DB, "ap", { id: "s-ap", name: "AP mailbox", mechanism: "email" });
    const prompts: string[] = [];
    const model = {
      extract: async (prompt: string) => {
        prompts.push(prompt);
        return prompt.includes("Return only its line items")
          ? JSON.stringify({ lines: [{ description: "Kopierpapier A4", amount: 100, quantity: 10 }] })
          : JSON.stringify({ invoiceNumber: "RE-1", totalWithVat: 100, _confidence: 0.9 });
      },
    };
    const scan = Uint8Array.from(atob(SCANNED_FLATE_JPEG_PDF_B64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    const result = await handleCaptureFromSource(env.DB, "s-ap", scan, model, undefined, undefined, undefined, undefined, "billing@lager-nord.de");
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    expect(prompts.find((p) => p.includes("Return only its line items"))).toContain('in the column headed "menge"');
    const id = (result.body as { id: string }).id;
    const line = await env.DB.prepare("SELECT facts_json FROM invoice_lines WHERE invoice_id = ?").bind(id).first<{ facts_json: string }>();
    expect(JSON.parse(line!.facts_json)["BT-129"]).toBe(10);
    const facts = JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(id).first<{ facts_json: string }>())!.facts_json);
    expect(facts["intake.layoutHint"]).toBe("Lager Nord GmbH (supplier's email address): no header fields; line columns BT-129");
  });
});
