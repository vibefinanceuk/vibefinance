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
 * CORRECTED after a live test against the real binding. The first
 * implementation sent an OpenAI-style `image_url` content part inside
 * `messages`, inferred from Cloudflare's workers-ai-provider
 * changelog. That was wrong, and the failure was instructive: the
 * model received the base64 data URL as ordinary TEXT, saw no image
 * at all, and answered from the prompt alone — returning the buyer's
 * name where the invoice number belonged, deterministically, at 0.9
 * confidence. A confidently wrong answer, from a model that could not
 * see anything.
 *
 * The changelog described what that LIBRARY does internally, not what
 * the raw binding accepts. Cloudflare's own Llama Vision tutorial
 * shows the real shape: `image` is a separate top-level parameter
 * alongside `messages`, not a content part inside them.
 *
 * Both documented encodings are still in play across models — the
 * vision tutorial passes a base64 string, while uform-gen2 and
 * resnet-50 take a byte array — so both are attempted, base64 first.
 * Which one a given model wants is exactly the kind of thing that
 * cannot be settled from here.
 */
export interface VisionRequestShape {
  label: string;
  build(prompt: string, bytes: Uint8Array, contentType: string, schema: Record<string, unknown>): Record<string, unknown>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** The shape Cloudflare's own Llama Vision tutorial documents. */
export const VISION_SHAPES: VisionRequestShape[] = [
  {
    label: "image-base64",
    build: (prompt, bytes, _ct, schema) => ({
      messages: [{ role: "user", content: prompt }],
      image: toBase64(bytes),
      guided_json: schema,
      max_tokens: 4096,
      temperature: 0,
    }),
  },
  {
    label: "image-bytes",
    build: (prompt, bytes, _ct, schema) => ({
      messages: [{ role: "user", content: prompt }],
      image: [...bytes],
      guided_json: schema,
      max_tokens: 4096,
      temperature: 0,
    }),
  },
];

export function createWorkersAiExtractionModel(ai: AiRunnable, modelId?: string): ExtractionModel {
  const model = modelId || DEFAULT_EXTRACTION_MODEL_ID;
  return {
    async extract(prompt, image, schema): Promise<string> {
      let lastError: unknown;
      for (const shape of VISION_SHAPES) {
        try {
          const raw = await ai.run(model, shape.build(prompt, image.bytes, image.contentType, schema));
          return extractResponseText(raw);
        } catch (err) {
          // A shape the model rejects outright throws here; try the
          // next documented encoding rather than failing on the first.
          // Deliberately does NOT catch a successful-but-wrong
          // response — nothing here can tell that apart, which is
          // precisely why the live test mattered.
          lastError = err;
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`no supported image request shape was accepted by ${model}`);
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
