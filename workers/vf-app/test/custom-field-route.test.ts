import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateCustomField,
  handleListCustomFields,
  loadCustomFields,
} from "../src/custom-field-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

const TRANSPORT_REF = {
  label: "Transport Reference",
  type: "text",
  description: "The carrier consignment or waybill reference",
};

describe("handleCreateCustomField", () => {
  it("400s when a required field is missing", async () => {
    const result = await handleCreateCustomField(env.DB, { label: "Transport Reference" });
    expect(result.status).toBe(400);
  });

  it("400s an unknown type rather than storing it", async () => {
    const result = await handleCreateCustomField(env.DB, { ...TRANSPORT_REF, type: "currency" });
    expect(result.status).toBe(400);
    const count = await env.DB.prepare("SELECT count(*) AS n FROM custom_fields").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it("400s a whitespace-only description — it is what the extractor is told to look for", async () => {
    const result = await handleCreateCustomField(env.DB, { ...TRANSPORT_REF, description: "   " });
    expect(result.status).toBe(400);
  });

  it("derives the key from the label rather than accepting one", async () => {
    const result = await handleCreateCustomField(env.DB, TRANSPORT_REF);
    expect(result.status).toBe(201);
    expect(result.body.key).toBe("custom.transport_reference");

    // Measure the rendered result, not the instruction issued (§7).
    const row = await env.DB.prepare("SELECT key, label, type, description FROM custom_fields WHERE key = ?")
      .bind("custom.transport_reference")
      .first();
    expect(row).toEqual({
      key: "custom.transport_reference",
      label: "Transport Reference",
      type: "text",
      description: "The carrier consignment or waybill reference",
    });
  });

  it("ignores any key the caller supplies — the key is never customer-controlled", async () => {
    const result = await handleCreateCustomField(env.DB, {
      ...TRANSPORT_REF,
      key: "whatever_i_like",
    } as Record<string, unknown>);
    expect(result.body.key).toBe("custom.transport_reference");
  });

  it("400s a label with no alphanumerics, since no key can be derived from it", async () => {
    const result = await handleCreateCustomField(env.DB, { ...TRANSPORT_REF, label: "!!! ???" });
    expect(result.status).toBe(400);
  });

  it("409s two labels that collapse to the same key, naming the existing one", async () => {
    await handleCreateCustomField(env.DB, TRANSPORT_REF);
    const second = await handleCreateCustomField(env.DB, { ...TRANSPORT_REF, label: "transport   reference" });
    expect(second.status).toBe(409);
    // The message names the existing LABEL, which is far more useful
    // to someone who just typed a variant of it than the derived key.
    expect(String(second.body.error)).toContain("Transport Reference");
  });

  it("accepts every declared type", async () => {
    for (const type of ["text", "number", "date", "boolean"]) {
      const result = await handleCreateCustomField(env.DB, {
        label: `Field ${type}`,
        type,
        description: `a ${type} field`,
      });
      expect(result.status).toBe(201);
    }
    const count = await env.DB.prepare("SELECT count(*) AS n FROM custom_fields").first<{ n: number }>();
    expect(count?.n).toBe(4);
  });
});

describe("handleListCustomFields", () => {
  it("returns an empty list when none are declared", async () => {
    const result = await handleListCustomFields(env.DB);
    expect(result.body).toEqual({ fields: [] });
  });

  it("returns every declared field, in a stable order", async () => {
    await handleCreateCustomField(env.DB, { label: "Zeta Code", type: "text", description: "z" });
    await handleCreateCustomField(env.DB, TRANSPORT_REF);
    const result = await handleListCustomFields(env.DB);
    const body = result.body as { fields: { key: string }[] };
    expect(body.fields.map((f) => f.key)).toEqual(["custom.transport_reference", "custom.zeta_code"]);
  });
});

describe("loadCustomFields — the single read in the whole custom-field path", () => {
  it("returns definitions in the exact shape resolveVocabulary expects", async () => {
    await handleCreateCustomField(env.DB, TRANSPORT_REF);
    const fields = await loadCustomFields(env.DB);
    expect(fields).toEqual([
      {
        key: "custom.transport_reference",
        label: "Transport Reference",
        type: "text",
        description: "The carrier consignment or waybill reference",
      },
    ]);
  });

  it("returns an empty array, not null, when nothing is declared — resolveVocabulary's own default", async () => {
    expect(await loadCustomFields(env.DB)).toEqual([]);
  });
});
