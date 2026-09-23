import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { suggestCodingValues, handleCodingSuggestions } from "../src/coding-suggestions.js";

beforeEach(async () => {
  await applyTestSchema();
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES (?, ?, ?)")
    .bind("u-coder", "coder@acme.com", "Coder")
    .run();
});

async function seedInvoice(id: string, supplierVatId: string | null) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, supplier_vat_id, facts_json) VALUES (?, ?, '{}')")
    .bind(id, supplierVatId)
    .run();
}

/** A person keying `field` to `value` on `invoiceId`'s line `lineNumber` — the exact shape key-fields-route.ts writes. */
async function keyLine(invoiceId: string, lineNumber: number, field: string, value: string) {
  await env.DB.prepare(
    "INSERT INTO keyed_fields (id, invoice_id, field, previous_value, new_value, keyed_by, line_number) VALUES (?, ?, ?, NULL, ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), invoiceId, field, JSON.stringify(value), "u-coder", lineNumber)
    .run();
}

describe("suggestCodingValues", () => {
  it("suggests nothing at all for a supplier with no keying history", async () => {
    const result = await suggestCodingValues(env.DB, "DE-nohistory");
    expect(result).toEqual({});
  });

  it("suggests nothing below the minimum sample size, even if every example agrees", async () => {
    await seedInvoice("inv-a", "DE-thin");
    await keyLine("inv-a", 1, "BT-133", "cc1");
    await seedInvoice("inv-b", "DE-thin");
    await keyLine("inv-b", 1, "BT-133", "cc1");
    // Only 2 examples — below MIN_SAMPLE_SIZE (3).
    const result = await suggestCodingValues(env.DB, "DE-thin");
    expect(result["BT-133"]).toBeUndefined();
  });

  it("suggests the majority value once there's enough agreeing history", async () => {
    for (const invoiceId of ["inv-c1", "inv-c2", "inv-c3"]) {
      await seedInvoice(invoiceId, "DE-strong");
      await keyLine(invoiceId, 1, "BT-133", "cc-eng");
    }
    const result = await suggestCodingValues(env.DB, "DE-strong");
    expect(result["BT-133"]).toEqual({ value: "cc-eng", confidence: 1, sampleSize: 3 });
  });

  it("suggests nothing when the history is too split to call a pattern", async () => {
    await seedInvoice("inv-d1", "DE-split");
    await keyLine("inv-d1", 1, "BT-133", "cc-a");
    await seedInvoice("inv-d2", "DE-split");
    await keyLine("inv-d2", 1, "BT-133", "cc-b");
    await seedInvoice("inv-d3", "DE-split");
    await keyLine("inv-d3", 1, "BT-133", "cc-c");
    // Three distinct values, one each — top confidence 1/3, below MIN_CONFIDENCE (0.5).
    const result = await suggestCodingValues(env.DB, "DE-split");
    expect(result["BT-133"]).toBeUndefined();
  });

  it("scopes strictly by supplier — one supplier's history never leaks into another's suggestion", async () => {
    for (const invoiceId of ["inv-e1", "inv-e2", "inv-e3"]) {
      await seedInvoice(invoiceId, "DE-e");
      await keyLine(invoiceId, 1, "BT-133", "cc-e");
    }
    const result = await suggestCodingValues(env.DB, "DE-other");
    expect(result["BT-133"]).toBeUndefined();
  });

  it("computes independent suggestions for each of the four fields", async () => {
    for (const invoiceId of ["inv-f1", "inv-f2", "inv-f3"]) {
      await seedInvoice(invoiceId, "DE-multi");
      await keyLine(invoiceId, 1, "BT-133", "cc-x");
      await keyLine(invoiceId, 1, "coding.gl_code", "gl-9");
    }
    const result = await suggestCodingValues(env.DB, "DE-multi");
    expect(result["BT-133"]?.value).toBe("cc-x");
    expect(result["coding.gl_code"]?.value).toBe("gl-9");
    expect(result["coding.project"]).toBeUndefined();
    expect(result["coding.commodity_code"]).toBeUndefined();
  });
});

describe("handleCodingSuggestions", () => {
  it("404s for an invoice that does not exist", async () => {
    const result = await handleCodingSuggestions(env.DB, "no-such-invoice");
    expect(result.status).toBe(404);
  });

  it("returns an empty object, not an error, for an invoice with no identified supplier", async () => {
    await seedInvoice("inv-g", null);
    const result = await handleCodingSuggestions(env.DB, "inv-g");
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ suggestions: {} });
  });

  it("returns real suggestions for an invoice whose supplier has strong keying history", async () => {
    for (const invoiceId of ["inv-h1", "inv-h2", "inv-h3"]) {
      await seedInvoice(invoiceId, "DE-h");
      await keyLine(invoiceId, 1, "coding.commodity_code", "comm-7");
    }
    await seedInvoice("inv-h-target", "DE-h");
    const result = await handleCodingSuggestions(env.DB, "inv-h-target");
    expect(result.status).toBe(200);
    const body = result.body as { suggestions: Record<string, { value: string }> };
    expect(body.suggestions["coding.commodity_code"].value).toBe("comm-7");
  });
});
