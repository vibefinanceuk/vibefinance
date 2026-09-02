import type { AiRunnable } from "./compiler-model.js";
import type { ExtractionModel } from "./extraction.js";

/**
 * The vision model behind invoice extraction — decision 0043.
 *
 * Chosen over the alternatives for three real reasons:
 *
 * 1. Natively multimodal. Cloudflare's own writeup draws the
 *    distinction explicitly: Llama 3.2 used SEPARATE parameters for
 *    vision and text, so an image request engaged only the vision
 *    half. Llama 4's parameters understand both together — which is
 *    what invoice extraction actually needs, since reading an invoice
 *    is reasoning about text within a layout, not recognising a
 *    picture.
 * 2. Function calling and structured outputs, so it can be
 *    constrained to a JSON shape rather than asked politely for one.
 * 3. The same `messages` shape gpt-oss-120b already uses, so this
 *    adapter mirrors compiler-model.ts almost exactly.
 *
 * Moondream was the obvious OCR candidate and is the wrong choice
 * here: its fixed task enum (query, caption, point, detect) takes a
 * single `question` string, so extracting a dozen invoice fields
 * would mean a dozen calls.
 *
 * Overridable by config (EXTRACTION_MODEL_ID) rather than code, so
 * testing an alternative against real invoices costs a redeploy
 * rather than a change here.
 */
export const DEFAULT_EXTRACTION_MODEL_ID = "@cf/meta/llama-4-scout-17b-16e-instruct";

/**
 * How an image is attached to the request.
 *
 * Stated plainly because it matters: this shape is NOT documented on
 * the model's own Workers AI parameter page, which lists only
 * `prompt` and shows text-only examples. It comes from Cloudflare's
 * own workers-ai-provider changelog, which describes the fix as
 * "Send images as OpenAI-compatible image_url content parts inline in
 * messages, enabling vision for models like Llama 4 Scout" — the same
 * shape the OpenAI-compatible endpoint uses.
 *
 * So this is a well-supported inference, not a documented certainty,
 * and it is the first thing a live test against the real binding will
 * confirm or correct. It is isolated in this one function precisely
 * so that correction is a small, local edit rather than a change
 * rippling through extraction.ts.
 */
function buildVisionMessages(prompt: string, imageDataUrl: string): unknown[] {
  return [
    {
      role: "user",
      content: [
        { type: "text", text: prompt },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ],
    },
  ];
}

export function createWorkersAiExtractionModel(ai: AiRunnable, modelId?: string): ExtractionModel {
  const model = modelId || DEFAULT_EXTRACTION_MODEL_ID;
  return {
    async extract(prompt: string, imageDataUrl: string, schema: Record<string, unknown>): Promise<string> {
      const raw = await ai.run(model, {
        messages: buildVisionMessages(prompt, imageDataUrl),
        // Constrains the response to the schema rather than asking for
        // it in prose. The compiler needed its own extractJson()
        // recovery precisely because this option did not exist there;
        // here it does, so the response should not need rescuing.
        guided_json: schema,
        // The same trap decision 0002's addendum already recorded:
        // max_tokens defaults to 256, which a dozen extracted fields
        // plus a confidence score would exceed. Set explicitly rather
        // than rediscovered as a truncated response.
        max_tokens: 4096,
        // Extraction should be as close to deterministic as the model
        // allows: the same invoice photographed twice should not
        // produce different totals. Lower than the model's own 0.15
        // default, deliberately.
        temperature: 0,
      });
      return extractResponseText(raw);
    },
  };
}

/**
 * Deliberately duplicated from compiler-model.ts rather than shared.
 *
 * The two look identical today, but they are answering different
 * questions — one unwraps a text completion, the other a
 * schema-constrained JSON response — and Workers AI has already
 * changed response shapes per model family once. A shared helper
 * would couple two things that only currently resemble each other,
 * and the cost of them diverging later is higher than the cost of
 * this duplication now.
 */
function extractResponseText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (typeof obj.response === "string") return obj.response;
    // guided_json may surface an already-parsed object rather than a
    // JSON string, depending on the response shape — re-serialised
    // here so parseExtractionResponse has one thing to handle.
    if (obj.response && typeof obj.response === "object") return JSON.stringify(obj.response);
    const choices = obj.choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const message = (choices[0] as Record<string, unknown> | undefined)?.message as
        | Record<string, unknown>
        | undefined;
      if (message && typeof message.content === "string") return message.content;
    }
    const result = obj.result;
    if (result && typeof result === "object") {
      const nested = (result as Record<string, unknown>).response;
      if (typeof nested === "string") return nested;
      if (nested && typeof nested === "object") return JSON.stringify(nested);
    }
  }
  // Last resort: hand parseExtractionResponse something real to fail
  // on, so the raw shape is visible in the refusal reason rather than
  // this function throwing on an unrecognised response.
  return JSON.stringify(raw);
}
