import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { handleReadRegion, regionPrompt, MAX_REGION_BYTES, REGION_MAX_TOKENS } from "../src/region-read.js";
import { ExtractionRefusal, allowanceMessage } from "../src/extraction.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";
import { PERMISSIONS } from "../src/permissions.js";

/**
 * **Reading a lassoed part of a page — decision 0699.** The viewer sends a
 * small cut-out where Tesseract was unsure, or to ask which field it is.
 */

const JPEG = btoa(String.fromCharCode(0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4));

function recording(answer: string | Error) {
  const calls: { prompt: string; images: { bytes: Uint8Array; contentType: string }[]; schema: Record<string, unknown>; opts?: { maxTokens?: number } }[] = [];
  return {
    calls,
    model: {
      extract: async (prompt: string, images: readonly { bytes: Uint8Array; contentType: string }[], schema: Record<string, unknown>, opts?: { maxTokens?: number }) => {
        calls.push({ prompt, images: [...images], schema, opts });
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}

describe("handleReadRegion", () => {
  it("reads the cut-out for the focused field, telling the model what it should be and what Tesseract saw", async () => {
    const { model, calls } = recording(JSON.stringify({ text: "1.683,26 €" }));
    const answer = await handleReadRegion(model, { image: `data:image/jpeg;base64,${JPEG}`, kind: "amount", label: "Invoice total", ocrText: "1.6B3,2G", context: "Gesamtbetrag" });
    expect(answer).toEqual({ status: 200, body: { text: "1.683,26 €" } });
    expect(calls[0].images[0].contentType).toBe("image/jpeg");
    expect(calls[0].images[0].bytes[0]).toBe(0xff);
    expect(calls[0].prompt).toContain('"Invoice total", which is an amount of money');
    expect(calls[0].prompt).toContain('A text reader saw "1.6B3,2G"');
    expect(calls[0].prompt).toContain('Printed beside it on the page: "Gesamtbetrag"');
    expect(calls[0].opts?.maxTokens).toBe(REGION_MAX_TOKENS);
    expect(calls[0].schema).toEqual({ type: "object", properties: { text: { type: "string" } }, required: ["text"] });
  });

  it("asks which field it is, from the fields offered, when none had focus", async () => {
    const { model, calls } = recording(JSON.stringify({ text: "30.10.2026", field: "BT-9" }));
    const fields = [
      { field: "BT-2", label: "Invoice date", kind: "date" },
      { field: "BT-9", label: "Due date", kind: "date" },
    ];
    const answer = await handleReadRegion(model, { image: JPEG, fields, context: "Zahlbar bis" });
    expect(answer).toEqual({ status: 200, body: { text: "30.10.2026", field: "BT-9" } });
    expect((calls[0].schema.properties as Record<string, { enum?: string[] }>).field.enum).toEqual(["BT-2", "BT-9", "none"]);
    expect(calls[0].prompt).toContain("- BT-9: Due date (a date)");
  });

  it("gives no field when the model names none, or one it was not offered", async () => {
    const fields = [{ field: "BT-2", label: "Invoice date", kind: "date" }];
    expect((await handleReadRegion(recording(JSON.stringify({ text: "x", field: "none" })).model, { image: JPEG, fields })).body.field).toBeNull();
    expect((await handleReadRegion(recording(JSON.stringify({ text: "x", field: "BT-99" })).model, { image: JPEG, fields })).body.field).toBeNull();
  });

  it("answers 503 ai_allowance when the day's allowance is used up", async () => {
    const { model } = recording(new ExtractionRefusal(allowanceMessage("4006"), undefined, true, true));
    const answer = await handleReadRegion(model, { image: JPEG });
    expect(answer.status).toBe(503);
    expect(answer.body.reason).toBe("ai_allowance");
  });

  it("answers 502 when the model fails or does not answer JSON", async () => {
    expect((await handleReadRegion(recording(new Error("boom")).model, { image: JPEG })).status).toBe(502);
    expect((await handleReadRegion(recording("not json").model, { image: JPEG })).status).toBe(502);
  });

  it("refuses a missing or oversized cut-out without calling the model", async () => {
    const { model, calls } = recording("{}");
    expect((await handleReadRegion(model, {})).status).toBe(400);
    expect((await handleReadRegion(model, { image: "%%%not base64" })).status).toBe(400);
    const big = btoa("x".repeat(MAX_REGION_BYTES + 1));
    expect((await handleReadRegion(model, { image: big })).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  it("answers 503 when no AI is bound", async () => {
    expect((await handleReadRegion(null, { image: JPEG })).status).toBe(503);
  });

  it("asks for the text alone when it has no field to read for", () => {
    const prompt = regionPrompt({ label: "", kind: "text", ocrText: "", context: "", fields: [] });
    expect(prompt).toContain("Read the text in it exactly as printed.");
    expect(prompt).not.toContain("which one of these invoice fields");
  });
});

describe("POST /invoices/:id/read-region", () => {
  beforeEach(async () => {
    await applyTestSchema();
  });

  async function signedIn(permissions: string[]) {
    const apiKey = generateApiKey();
    await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES ('u-r', 'r@acme.com', 'R', ?)").bind(await hashApiKey(apiKey)).run();
    await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('role-x', 'X', ?)").bind(JSON.stringify(permissions)).run();
    await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES ('u-r', 'role-x')").run();
    const claims = { customerId: "test-customer", plan: "standard", features: [], volumeEntitlement: 10000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
    await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
    return apiKey;
  }

  function call(apiKey: string | null, ai: unknown) {
    return worker.fetch(
      new Request("https://example.com/invoices/inv-1/read-region", {
        method: "POST",
        headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}), "Content-Type": "application/json" },
        body: JSON.stringify({ image: JPEG, kind: "amount", label: "Invoice total" }),
      }),
      { ...env, AI: ai } as unknown as Env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext
    );
  }

  it("reads the cut-out for someone who may see invoices", async () => {
    const apiKey = await signedIn(PERMISSIONS as unknown as string[]);
    const res = await call(apiKey, { run: async () => ({ response: JSON.stringify({ text: "740,70" }) }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "740,70" });
  });

  it("refuses someone signed out, and someone who may not see invoices", async () => {
    expect((await call(null, { run: async () => ({}) })).status).toBe(401);
    const apiKey = await signedIn([]);
    expect((await call(apiKey, { run: async () => ({}) })).status).toBe(403);
  });
});
