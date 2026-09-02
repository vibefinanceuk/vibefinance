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
export interface VisionImage {
  bytes: Uint8Array;
  contentType: string;
}

export interface VisionRequestShape {
  label: string;
  /** Takes an ORDERED list of images. A multi-page invoice is a
   *  single document, and its pages must reach the model in document
   *  order — page two's totals mean nothing to a model that reads
   *  them first. One image is the common case, not a special one. */
  build(prompt: string, images: readonly VisionImage[], schema: Record<string, unknown>): Record<string, unknown>;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * The image request shape — CONFIRMED against the real binding.
 *
 * An `image_url` content part inside `messages`, carrying a proper
 * `data:` URL. Verified live against a real invoice: the model
 * returned the correct invoice number and the correct total,
 * including a currency symbol and a thousands separator.
 *
 * The evidence, from a diagnostic that ran four candidate shapes at
 * once against the same image:
 *
 *   image_url-data-url        prompt_tokens 1063   correct answers
 *   image_url-bare-base64     threw: "The URL must be either a
 *                             HTTP, data or file URL"
 *   top-level-image-base64    prompt_tokens 46     "NO IMAGE RECEIVED"
 *   top-level-image-bytes     prompt_tokens 46     "NO IMAGE RECEIVED"
 *
 * Two things worth carrying forward from how long this took.
 *
 * First, the top-level `image` parameter fails SILENTLY. It is the
 * documented shape for @cf/meta/llama-3.2-11b-vision-instruct — a
 * different model with a different input schema — and sending it to
 * Llama 4 Scout produces no error and no warning, just a confident
 * answer from a model that received nothing at all. Reading Llama
 * 3.2's tutorial and assuming it applied here cost two deploy cycles.
 *
 * Second, `usage.prompt_tokens` is the only honest signal about
 * whether an image arrived. The model's ANSWER cannot tell you: given
 * no image, it still answers, and still sounds sure. 46 tokens is a
 * short prompt alone; 1063 is a prompt plus a real 82KB image.
 */
export const VISION_SHAPES: VisionRequestShape[] = [
  {
    label: "image_url-data-url",
    build: (prompt, images, schema) => ({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            // Every page, in order, in ONE call. The model sees the
            // whole document the way a person would — which is what
            // lets a table continuing across a page break, or totals
            // printed on the last page, be read correctly. Merging
            // per-page results in code would mean inventing an answer
            // for what to do when two pages disagree.
            //
            // A full data: URL, not bare base64 — the binding rejects
            // the latter outright with "The URL must be either a
            // HTTP, data or file URL", which is at least an honest
            // failure rather than a silent one.
            ...images.map((image) => ({
              type: "image_url",
              image_url: { url: `data:${image.contentType};base64,${toBase64(image.bytes)}` },
            })),
          ],
        },
      ],
      guided_json: schema,
      // Raised from 4096 for multi-page documents. A single page of
      // header fields fits comfortably; a document whose line table
      // runs to dozens of rows, plus fourteen header fields and a
      // confidence score, does not — and a response truncated
      // mid-JSON becomes an unparseable refusal rather than an
      // honest one. The same max_tokens trap decision 0002's
      // addendum recorded for the compiler, in a new place.
      max_tokens: 16384,
      temperature: 0,
    }),
  },
];

export function createWorkersAiExtractionModel(ai: AiRunnable, modelId?: string): ExtractionModel {
  const model = modelId || DEFAULT_EXTRACTION_MODEL_ID;
  return {
    async extract(prompt, images, schema): Promise<string> {
      // No fallback loop any more. It existed while the working shape
      // was unknown; now that it is confirmed, trying alternatives on
      // failure would only paper over a real regression — and a
      // silent fallback is precisely what made this take three
      // attempts to diagnose.
      const raw = await ai.run(model, VISION_SHAPES[0].build(prompt, images, schema));
      const text = extractResponseText(raw);
      // Truncation is the likeliest way a multi-page response fails to
      // parse, and it is INVISIBLE in the text itself — a JSON
      // document cut off mid-string looks like malformed JSON, not
      // like a length problem. finish_reason says which it is, so the
      // refusal can name the real cause instead of guessing.
      const obj = (raw ?? {}) as Record<string, unknown>;
      const finishReason = (obj.choices as { finish_reason?: string }[] | undefined)?.[0]?.finish_reason;
      if (finishReason === "length") {
        throw new Error(
          `the model's response was cut off at the token limit (finish_reason: length). The document may have more line items than one response can carry.`
        );
      }
      return text;
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
export function extractResponseText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return JSON.stringify(raw);
  const obj = raw as Record<string, unknown>;

  // Order matters, and getting it wrong is what made a working
  // extraction look like a total failure.
  //
  // Workers AI returns BOTH a top-level `response` string and the
  // real content at choices[0].message.content. Checking `response`
  // first looked harmless and was not: with guided_json the schema-
  // conformant JSON lands in message.content, while `response` can
  // carry an unrelated plain-text summary. parseExtractionResponse
  // then failed to parse that prose, refused the whole extraction,
  // and reported "no fields could be read" — from a model that had
  // in fact read the invoice correctly.
  //
  // So candidates are gathered in order of specificity and the first
  // one that actually looks like JSON wins, with a plain-string
  // fallback only if none do.
  const candidates: unknown[] = [];

  const choices = obj.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown> | undefined)?.message as
      | Record<string, unknown>
      | undefined;
    if (message) candidates.push(message.content);
  }
  candidates.push(obj.response);
  const result = obj.result;
  if (result && typeof result === "object") {
    candidates.push((result as Record<string, unknown>).response);
  }

  // guided_json sometimes surfaces an already-parsed object rather
  // than a JSON string; re-serialised so parseExtractionResponse has
  // exactly one thing to handle.
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") return JSON.stringify(candidate);
    if (typeof candidate === "string" && candidate.trimStart().startsWith("{")) return candidate;
  }
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.length > 0) return candidate;
  }

  // Last resort: hand parseExtractionResponse something real to fail
  // on, so the raw shape is visible in the refusal reason rather than
  // this function throwing on an unrecognised response.
  return JSON.stringify(raw);
}
