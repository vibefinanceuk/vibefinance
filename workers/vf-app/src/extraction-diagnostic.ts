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

  const attempts: Record<string, unknown>[] = [];
  for (const shape of VISION_SHAPES) {
    const built = shape.build(prompt, bytes, contentType, { type: "object" });
    // The schema is dropped here on purpose — guided_json would force
    // a shape onto the answer and hide whether the model saw the
    // image, which is the one thing this endpoint exists to reveal.
    delete built.guided_json;
    try {
      const raw = await ai.run(model, built);
      attempts.push({
        shape: shape.label,
        threw: false,
        // Truncated: a model that echoes its input could otherwise
        // return the whole base64 payload.
        raw: JSON.stringify(raw).slice(0, 2000),
      });
    } catch (err) {
      attempts.push({ shape: shape.label, threw: true, error: String(err).slice(0, 500) });
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
