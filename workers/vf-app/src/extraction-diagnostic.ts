import type { AiRunnable } from "./compiler-model.js";
import type { RouteResult } from "./org-route.js";
import { sniffImageType } from "./extraction.js";
import { VISION_SHAPES, DEFAULT_EXTRACTION_MODEL_ID } from "./extraction-model.js";

/**
 * A diagnostic endpoint, not a product feature — decision 0043's
 * addendum.
 *
 * Two live tests were spent guessing at why extraction returned
 * nothing, because the real model response was never visible from
 * outside: the adapter tries several request shapes, returns on the
 * first that does not throw, and discards everything else. That is
 * fine in production and useless for diagnosis.
 *
 * This runs EVERY shape against a real image and reports exactly what
 * came back from each — the shape name, whether it threw, and the raw
 * response. It answers, in one call, questions that otherwise cost a
 * deploy each: does this model accept an image at all, which encoding
 * does it want, and what is it actually saying?
 *
 * Deliberately kept out of the capture path. It exists to be deleted
 * once the shape is settled, and says so.
 */
export async function handleExtractionDiagnostic(
  ai: AiRunnable,
  bytes: Uint8Array,
  modelId?: string
): Promise<RouteResult> {
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    return { status: 422, body: { error: "unsupported image format — expected JPEG, PNG or WebP" } };
  }

  const model = modelId || DEFAULT_EXTRACTION_MODEL_ID;
  // Deliberately a plain question, not the extraction prompt: if the
  // model cannot answer "what is the invoice number" from a clear
  // invoice, the problem is upstream of anything the extraction
  // prompt or schema could fix.
  const prompt =
    "Look at this image. What is the invoice number, and what is the total including VAT? If you cannot see an image at all, say exactly: NO IMAGE RECEIVED.";

  // A real schema, not a placeholder: the question this now has to
  // answer is whether guided_json itself suppresses the image, which
  // an empty schema would not exercise.
  const realSchema = {
    type: "object",
    properties: {
      invoiceNumber: { type: ["string", "null"], description: "the invoice number" },
      totalWithVat: { type: ["number", "null"], description: "the total including VAT" },
    },
    required: [],
  };

  const variants: { label: string; withSchema: boolean }[] = [
    { label: "no-guided-json", withSchema: false },
    { label: "with-guided-json", withSchema: true },
  ];

  const attempts: Record<string, unknown>[] = [];
  for (const shape of VISION_SHAPES) {
    for (const variant of variants) {
    const built = shape.build(prompt, bytes, contentType, realSchema);
    // The variable under test. The diagnostic previously dropped
    // guided_json to keep the answer readable — which, it turns out,
    // was the only difference between it working and the real
    // extraction path failing.
    if (!variant.withSchema) delete built.guided_json;
    try {
      const raw = await ai.run(model, built);
      const obj = (raw ?? {}) as Record<string, unknown>;
      const usage = obj.usage as Record<string, unknown> | undefined;
      const answer =
        typeof obj.response === "string"
          ? obj.response
          : JSON.stringify(raw).slice(0, 400);
      attempts.push({
        shape: `${shape.label} / ${variant.label}`,
        threw: false,
        // The signal that actually matters. A dropped image leaves
        // this at roughly the prompt's own length; an image that
        // genuinely arrived pushes it into the thousands. The
        // model's ANSWER cannot be trusted to reveal this — one that
        // received no image still answers confidently.
        promptTokens: usage?.prompt_tokens ?? null,
        imageReceived: typeof usage?.prompt_tokens === "number" && (usage.prompt_tokens as number) > 500,
        answer,
      });
    } catch (err) {
      attempts.push({ shape: `${shape.label} / ${variant.label}`, threw: true, error: String(err).slice(0, 500) });
    }
    }
  }

  return {
    status: 200,
    body: {
      model,
      contentType,
      imageBytes: bytes.length,
      attempts,
      note: "diagnostic only — remove once the working request shape is confirmed",
    },
  };
}
