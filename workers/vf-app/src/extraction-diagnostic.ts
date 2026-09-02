import type { AiRunnable } from "./compiler-model.js";
import type { RouteResult } from "./org-route.js";
import { sniffImageType, buildExtractionPrompt, buildExtractionSchema, parseExtractionResponse } from "./extraction.js";
import { VISION_SHAPES, DEFAULT_EXTRACTION_MODEL_ID, extractResponseText } from "./extraction-model.js";
import { resolveVocabulary } from "@vibefinance/shared";
import { loadCustomFields } from "./custom-field-route.js";

/**
 * A diagnostic endpoint, not a product feature — decision 0043.
 *
 * Rebuilt after five failed fixes. Every earlier version tested a
 * SIMPLIFIED request — a short question, a two-field schema — while
 * the real extraction path sends a long prompt and a fifteen-field
 * schema. Those are not the same request, and reasoning across that
 * gap is what made five consecutive theories look plausible and turn
 * out wrong.
 *
 * This now sends exactly what the real path sends, and returns the
 * raw model response alongside what the parser made of it. Nothing is
 * simplified, nothing is inferred.
 */
export async function handleExtractionDiagnostic(
  ai: AiRunnable,
  db: D1Database,
  bytes: Uint8Array,
  modelId?: string
): Promise<RouteResult> {
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return { status: 422, body: { error: "unsupported image format — expected JPEG, PNG or WebP" } };
  }

  const model = modelId || DEFAULT_EXTRACTION_MODEL_ID;
  const customFields = await loadCustomFields(db);
  const vocabulary = resolveVocabulary("invoice", customFields);

  // The REAL prompt and the REAL schema, exactly as extraction sends
  // them. This is the whole point of this rebuild.
  const realPrompt = buildExtractionPrompt(vocabulary);
  const realSchema = buildExtractionSchema(vocabulary);
  const built = VISION_SHAPES[0].build(realPrompt, bytes, contentType, realSchema);

  const attempts: Record<string, unknown>[] = [];

  // 1. Exactly the production request.
  try {
    const raw = await ai.run(model, built);
    const obj = (raw ?? {}) as Record<string, unknown>;
    const usage = obj.usage as Record<string, unknown> | undefined;
    const text = extractResponseText(raw);
    let parsed: unknown = null;
    let parseError: string | null = null;
    try {
      parsed = parseExtractionResponse(text, vocabulary).facts;
    } catch (err) {
      parseError = String(err).slice(0, 300);
    }
    attempts.push({
      variant: "production-request",
      promptTokens: usage?.prompt_tokens ?? null,
      completionTokens: usage?.completion_tokens ?? null,
      finishReason: (obj.choices as { finish_reason?: string }[] | undefined)?.[0]?.finish_reason ?? null,
      // What extractResponseText picked out, and the whole raw body
      // it picked from — the two things every earlier diagnostic hid.
      extractedText: text.slice(0, 1500),
      rawBody: JSON.stringify(raw).slice(0, 2500),
      parsedFacts: parsed,
      parseError,
    });
  } catch (err) {
    attempts.push({ variant: "production-request", threw: String(err).slice(0, 500) });
  }

  // 2. The same image and schema, but the short question that is
  //    already known to work — isolating the PROMPT as the variable.
  try {
    const shortBuilt = VISION_SHAPES[0].build(
      "What is the invoice number, and the total including VAT?",
      bytes,
      contentType,
      realSchema
    );
    const raw = await ai.run(model, shortBuilt);
    const obj = (raw ?? {}) as Record<string, unknown>;
    const usage = obj.usage as Record<string, unknown> | undefined;
    attempts.push({
      variant: "short-prompt-real-schema",
      promptTokens: usage?.prompt_tokens ?? null,
      extractedText: extractResponseText(raw).slice(0, 800),
    });
  } catch (err) {
    attempts.push({ variant: "short-prompt-real-schema", threw: String(err).slice(0, 500) });
  }

  // 3. The real prompt with a tiny schema — isolating the SCHEMA.
  try {
    const smallSchemaBuilt = VISION_SHAPES[0].build(realPrompt, bytes, contentType, {
      type: "object",
      properties: { "BT-1": { type: ["string", "null"] }, "BT-112": { type: ["number", "null"] } },
    });
    const raw = await ai.run(model, smallSchemaBuilt);
    const obj = (raw ?? {}) as Record<string, unknown>;
    const usage = obj.usage as Record<string, unknown> | undefined;
    attempts.push({
      variant: "real-prompt-small-schema",
      promptTokens: usage?.prompt_tokens ?? null,
      extractedText: extractResponseText(raw).slice(0, 800),
    });
  } catch (err) {
    attempts.push({ variant: "real-prompt-small-schema", threw: String(err).slice(0, 500) });
  }

  return {
    status: 200,
    body: {
      model,
      contentType,
      imageBytes: bytes.length,
      promptChars: realPrompt.length,
      schemaFieldCount: Object.keys((realSchema as { properties: Record<string, unknown> }).properties).length,
      attempts,
      note: "diagnostic only — remove once extraction is confirmed working",
    },
  };
}
