import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { senderAddress, supplierForSender, layoutHint, hintBeforeReading } from "../src/layout-hints.js";
import { buildExtractionPrompt } from "../src/extraction.js";
import { handleRecordRegion } from "../src/field-regions.js";
import { handleCaptureFromSource } from "../src/source-capture-route.js";
import { handleCreateSource } from "../src/source-route.js";
import { handleCreateIntakeChannel } from "../src/intake-channel-route.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";
import type { Layout } from "../src/supplier-layouts.js";
import { SCANNED_FLATE_JPEG_PDF_B64 } from "./fixtures/pdf-read-fixtures.js";

/**
 * **Telling the reader what to expect — decision 0703.** Step 3b of
 * docs/design/supplier-layout-learning.md.
 */

const TOTAL = { x: 0.82, y: 0.85, w: 0.08, h: 0.015 };
const NUMBER = { x: 0.7, y: 0.1, w: 0.12, h: 0.015 };

describe("senderAddress", () => {
  it.each([
    ["Lager Nord <Billing@Lager-Nord.de>", "billing@lager-nord.de"],
    ["billing@lager-nord.de", "billing@lager-nord.de"],
    ["  ACCOUNTS@munch.de ", "accounts@munch.de"],
    ["not an address", null],
    ["", null],
  ])("%s → %s", (raw, address) => {
    expect(senderAddress(raw)).toBe(address);
  });
});

describe("layoutHint", () => {
  const one: Layout = {
    id: "L1",
    invoices: 5,
    fields: [
      { field: "BT-1", pageNumber: 1, box: NUMBER, label: "rechnungsnr", evidence: 5, disagreements: 0 },
      { field: "BT-112", pageNumber: 1, box: TOTAL, label: "gesamtbetrag", evidence: 9, disagreements: 1 },
      { field: "BT-999", pageNumber: 1, box: TOTAL, label: "x", evidence: 9, disagreements: 0 },
    ],
  };

  it("says each known field's label and where it is", () => {
    const hint = layoutHint([one], "Lager Nord GmbH")!;
    expect(hint.fields).toEqual(["BT-1", "BT-112"]);
    expect(hint.text).toContain("very likely from Lager Nord GmbH");
    expect(hint.text).toContain('- the invoice number follows the label "rechnungsnr", near the top right.');
    expect(hint.text).toContain('- the total with VAT follows the label "gesamtbetrag", near the bottom right.');
    expect(hint.text).toContain("where it differs, the document is right");
  });

  it("gives labels only when the supplier has several layouts and none is usual", () => {
    const other: Layout = { id: "L2", invoices: 4, fields: [{ field: "BT-112", pageNumber: 1, box: { ...TOTAL, y: 0.4 }, label: "summe", evidence: 4, disagreements: 0 }] };
    const hint = layoutHint([one, other], "Lager Nord GmbH")!;
    expect(hint.text).toContain('- the total with VAT follows the label "gesamtbetrag" or "summe".');
    expect(hint.text).not.toContain("near");
  });

  it("is nothing without a layout", () => {
    expect(layoutHint([], "Lager Nord GmbH")).toBeNull();
  });
});

describe("buildExtractionPrompt", () => {
  it("carries the hint before its last instruction, and nothing without one", () => {
    const withHint = buildExtractionPrompt("invoice", 1, undefined, "HINT PARAGRAPH");
    expect(withHint).toContain("HINT PARAGRAPH\n\nReturn only the JSON object described by the schema.");
    expect(buildExtractionPrompt("invoice")).not.toContain("HINT");
  });
});

describe("from the database", () => {
  beforeEach(async () => {
    await applyTestSchema();
    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@acme.com', 'Dan')").run();
    await env.DB.prepare(
      "INSERT INTO suppliers (id, name, email) VALUES ('sup-ln', 'Lager Nord GmbH', 'billing@lager-nord.de'), ('sup-kw', 'Kingsway', NULL), ('sup-dup1', 'Twin A', 'shared@twins.de'), ('sup-dup2', 'Twin B', 'shared@twins.de')"
    ).run();
  });

  /** An invoice from a supplier, arrived from `sender` by email, with its total found beside its label. */
  async function arrived(id: string, supplierId: string, sender: string) {
    await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json, supplier_id) VALUES (?, ?, ?)").bind(id, JSON.stringify({ "BT-112": 100 }), supplierId).run();
    await env.DB.prepare(
      "INSERT INTO route_messages (id, direction, status, counterparty, received_at) VALUES (?, 'in', 'delivered', ?, datetime('now'))"
    ).bind(`m-${id}`, sender).run();
    await env.DB.prepare(
      "INSERT INTO invoice_documents (id, invoice_id, document_type, r2_key, content_type, route_message_id) VALUES (?, ?, 'original', ?, 'application/pdf', ?)"
    ).bind(`d-${id}`, id, `k-${id}`, `m-${id}`).run();
    await handleRecordRegion(env.DB, id, "BT-112", "u-dan", { pageNumber: 1, box: TOTAL, label: "Gesamtbetrag", value: "100", source: "found" });
  }

  it("knows a supplier by its own email address", async () => {
    expect(await supplierForSender(env.DB, "Lager Nord <BILLING@lager-nord.de>")).toEqual({ supplierId: "sup-ln", name: "Lager Nord GmbH", how: "supplier_email" });
  });

  it("does not guess between two suppliers with the same address", async () => {
    expect(await supplierForSender(env.DB, "shared@twins.de")).toBeNull();
  });

  it("knows a supplier from what earlier invoices from the sender turned out to be", async () => {
    await arrived("i1", "sup-kw", "ap@kingsway.co.uk");
    expect(await supplierForSender(env.DB, "ap@kingsway.co.uk")).toBeNull();
    await arrived("i2", "sup-kw", "AP@Kingsway.co.uk");
    expect(await supplierForSender(env.DB, "ap@kingsway.co.uk")).toEqual({ supplierId: "sup-kw", name: "Kingsway", how: "sender_history" });
  });

  it("does not take a sender for a supplier when its invoices are from several", async () => {
    await arrived("i1", "sup-kw", "scanner@office.example");
    await arrived("i2", "sup-kw", "scanner@office.example");
    await arrived("i3", "sup-ln", "scanner@office.example");
    expect(await supplierForSender(env.DB, "scanner@office.example")).toBeNull();
  });

  it("tells the reading what the sender's supplier's invoices look like, and records that it did", async () => {
    await arrived("i1", "sup-ln", "billing@lager-nord.de");
    await arrived("i2", "sup-ln", "billing@lager-nord.de");
    await arrived("i3", "sup-ln", "billing@lager-nord.de");
    expect((await hintBeforeReading(env.DB, "billing@lager-nord.de"))!.fields).toEqual(["BT-112"]);

    await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
    await handleCreateStage(env.DB, "ap", { id: "received", name: "Received", sequence: 1 });
    await handleCreateIntakeChannel(env.DB, "ap", { id: "ch-image", name: "Image", structure: "image" });
    await handleCreateSource(env.DB, "ap", { id: "s-ap", name: "AP mailbox", mechanism: "email" });

    const prompts: string[] = [];
    const model = {
      extract: async (prompt: string) => {
        prompts.push(prompt);
        return prompt.includes("Return only its line items")
          ? JSON.stringify({ lines: [] })
          : JSON.stringify({ invoiceNumber: "RE-1", totalWithVat: 100, _confidence: 0.9 });
      },
    };
    const scan = Uint8Array.from(atob(SCANNED_FLATE_JPEG_PDF_B64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    const result = await handleCaptureFromSource(env.DB, "s-ap", scan, model, undefined, undefined, undefined, undefined, "Lager Nord <billing@lager-nord.de>");
    expect(result.status, JSON.stringify(result.body)).toBe(201);
    const header = prompts.find((p) => !p.includes("Return only its line items"))!;
    expect(header).toContain('the total with VAT follows the label "gesamtbetrag", near the bottom right');
    // The lines call is not told about header labels.
    expect(prompts.filter((p) => p.includes("Return only its line items")).every((p) => !p.includes("gesamtbetrag"))).toBe(true);
    const facts = JSON.parse((await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind((result.body as { id: string }).id).first<{ facts_json: string }>())!.facts_json);
    expect(facts["intake.layoutHint"]).toBe("Lager Nord GmbH (supplier's email address): BT-112");
  });

  it("reads as before when the sender is not known", async () => {
    await handleCreateProcess(env.DB, { id: "ap", name: "AP" });
    await handleCreateStage(env.DB, "ap", { id: "received", name: "Received", sequence: 1 });
    await handleCreateSource(env.DB, "ap", { id: "s-ap", name: "AP mailbox", mechanism: "email" });
    const prompts: string[] = [];
    const model = {
      extract: async (prompt: string) => {
        prompts.push(prompt);
        return prompt.includes("Return only its line items") ? JSON.stringify({ lines: [] }) : JSON.stringify({ invoiceNumber: "RE-1", _confidence: 0.9 });
      },
    };
    const scan = Uint8Array.from(atob(SCANNED_FLATE_JPEG_PDF_B64.replace(/\s/g, "")), (c) => c.charCodeAt(0));
    const result = await handleCaptureFromSource(env.DB, "s-ap", scan, model, undefined, undefined, undefined, undefined, "someone@new.example");
    expect(result.status).toBe(201);
    expect(prompts.some((p) => p.includes("very likely from"))).toBe(false);
  });
});
