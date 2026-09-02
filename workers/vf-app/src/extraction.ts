import type { InvoiceFacts } from "@vibefinance/shared";
import {
  asResolved,
  isKnownFieldType,
  type FieldType,
  type ResolvedVocabulary,
  type VocabularyInput,
} from "@vibefinance/shared";

/**
 * Vision-model invoice extraction — decision 0043.
 *
 * The last of the three intake paths. UBL/XML parses directly; a
 * hybrid PDF (Factur-X / ZUGFeRD) has its embedded XML pulled out and
 * parsed the same way (decision 0042); and an image — a photograph or
 * a scan — has nothing structured in it at all, so a model is the
 * only option.
 *
 * The ordering matters and is deliberate: this path is reached ONLY
 * when the other two cannot apply. Extraction is best-effort and
 * inferred, where the other two are exact. Nothing should ever arrive
 * here that could have been parsed.
 *
 * A fact-producing agent in decision 0015's own sense: it runs before
 * rule evaluation, contributes facts, and finishes before any rule
 * sees them. Non-determinism enters what facts are available, never
 * evaluation itself.
 */

/** Refusals, never guesses. Mirrors the compiler's own discipline:
 *  a document the model cannot read produces a reported failure, not
 *  a half-populated invoice nobody knows to distrust. */
export class ExtractionRefusal extends Error {
  readonly rawModelOutput?: string;
  constructor(message: string, rawModelOutput?: string) {
    super(message);
    this.name = "ExtractionRefusal";
    this.rawModelOutput = rawModelOutput;
  }
}

/** Injected rather than a hardcoded env.AI call, exactly like
 *  CompilerModel — testable without a live binding, and swappable
 *  without touching any of the logic here. */
export interface ExtractionModel {
  extract(prompt: string, imageDataUrl: string, schema: Record<string, unknown>): Promise<string>;
}

export const SUPPORTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function isSupportedImageType(contentType: string | null): boolean {
  if (!contentType) return false;
  const base = contentType.split(";")[0].trim().toLowerCase();
  return (SUPPORTED_IMAGE_TYPES as readonly string[]).includes(base);
}

/** Detects the real image type from magic bytes rather than trusting
 *  a client-supplied content-type header. A mislabelled upload should
 *  fail on what it actually is, not on what it claimed. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]) === "RIFF" &&
    String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function toDataUrl(bytes: Uint8Array, contentType: string): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${contentType};base64,${btoa(binary)}`;
}

/**
 * The fields worth asking a model for, and what to call them when
 * asking. Deliberately a curated subset of the closed vocabulary
 * rather than all of it: BT-129 and BT-131 are line-level, and
 * per-line extraction from an image is its own harder problem
 * (decision 0043's open items). Asking for fields the model cannot
 * sensibly answer at document level would degrade the ones it can.
 *
 * The description is what the model actually sees. It carries the
 * human name a real invoice uses, not the Business Term id, because
 * "BT-31" means nothing on a printed page while "supplier VAT
 * number" is what is literally written there.
 */
const STANDARD_EXTRACTION_FIELDS: { key: string; type: FieldType; description: string }[] = [
  { key: "BT-1", type: "text", description: "the supplier's own invoice number or reference" },
  { key: "BT-2", type: "date", description: "the invoice issue date, as YYYY-MM-DD" },
  { key: "BT-9", type: "date", description: "the payment due date, as YYYY-MM-DD" },
  { key: "BT-5", type: "text", description: "the currency, as a 3-letter ISO code such as EUR or GBP" },
  { key: "BT-13", type: "text", description: "the purchase order reference, if the invoice quotes one" },
  { key: "BT-31", type: "text", description: "the supplier's VAT registration number" },
  { key: "BT-40", type: "text", description: "the supplier's country, as a 2-letter ISO code" },
  { key: "BT-48", type: "text", description: "the buyer's VAT registration number" },
  { key: "BT-106", type: "number", description: "the total of all line amounts before VAT" },
  { key: "BT-110", type: "number", description: "the total VAT amount" },
  { key: "BT-112", type: "number", description: "the total payable including VAT" },
  { key: "BT-115", type: "number", description: "the amount actually due for payment" },
];

/**
 * Builds the JSON schema the model's response is constrained to.
 *
 * This is genuinely better than asking for JSON in a prompt and
 * parsing defensively afterwards — Workers AI's `guided_json`
 * constrains the model to the shape rather than requesting it
 * politely. The compiler needed extractJson() precisely because that
 * option did not exist there.
 *
 * Every field is nullable, deliberately. A field the model cannot
 * find must come back null, never invented — and a schema that made
 * fields required would pressure it to fabricate one.
 */
export function buildExtractionSchema(vocabulary: VocabularyInput = "invoice"): Record<string, unknown> {
  const v = asResolved(vocabulary);
  const properties: Record<string, unknown> = {};

  const jsonType = (t: FieldType) => (t === "number" ? ["number", "null"] : ["string", "null"]);

  for (const field of STANDARD_EXTRACTION_FIELDS) {
    properties[field.key] = { type: jsonType(field.type), description: field.description };
  }
  // A customer's own declared fields (decision 0041) are asked for
  // using their own descriptions — which is exactly what that
  // description exists for.
  for (const field of v.customFields) {
    properties[field.key] = { type: jsonType(field.type), description: field.description };
  }

  properties._confidence = {
    type: "number",
    description:
      "your own confidence that the values above are correct, from 0.0 to 1.0. Be honest: a blurry or partial image should score low.",
  };

  return {
    type: "object",
    properties,
    required: ["_confidence"],
  };
}

export function buildExtractionPrompt(vocabulary: VocabularyInput = "invoice"): string {
  const v = asResolved(vocabulary);
  const customSection =
    v.customFields.length === 0
      ? ""
      : `

This customer has also defined fields of their own. These are not part of any standard — the descriptions below are the customer's own:
${v.customFields.map((f) => `  ${f.key} (${f.type}) — ${f.description}`).join("\n")}`;

  return `You are reading a photograph or scan of a supplier invoice and extracting specific fields from it.

Rules that matter more than completeness:
- Report only what you can actually read on the document. If a field is not present, or you cannot read it confidently, return null for it. Never guess, never infer a plausible value, and never carry a value over from a different field.
- Dates must be YYYY-MM-DD. If the document's date format is ambiguous (for example 03/04/2026), and you cannot tell from context which is the day and which is the month, return null rather than choosing.
- Amounts must be plain numbers with no currency symbol, no thousands separator, and a dot for the decimal point.
- A total that is printed on the document is always preferable to one you calculate yourself.
- Set _confidence honestly. A clear, sharp, complete invoice justifies a high score; a blurry photo, a cropped image, or a document you are partly guessing at does not.${customSection}

Return only the JSON object described by the schema.`;
}

export interface ExtractionResult {
  facts: InvoiceFacts;
  confidence: number;
  /** Which fields the model reported it could not read. Genuinely
   *  useful downstream: "the supplier VAT was unreadable" is a far
   *  better basis for a review task than a bare confidence score. */
  missingFields: string[];
  rawModelOutput: string;
}

/**
 * Coerces and validates one extracted value against its declared
 * type — decision 0041's type system doing real work here.
 *
 * A `number` field returned as "approximately 500" fails to coerce,
 * and that failure is a refusal of the field, not a silent zero. This
 * is the coercion half decision 0041 designed and deferred.
 */
function coerce(value: unknown, type: FieldType): { ok: true; value: string | number | boolean } | { ok: false } {
  if (value === null || value === undefined) return { ok: false };
  if (type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return { ok: true, value };
    if (typeof value === "string") {
      // Tolerates a leading currency SYMBOL and whitespace, and
      // nothing else. Deliberately a closed set rather than "strip
      // any leading non-digits" — found by a failing test, which is
      // the whole point: the permissive version turned
      // "approximately 500" into 500, fabricating a value out of
      // prose. That is exactly the silent invention decision 0041's
      // type system exists to prevent.
      const cleaned = value
        .trim()
        .replace(/^[\u00a3\u20ac$\u00a5]\s*/, "")
        .replace(/[\s\u00a0]/g, "");
      if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return { ok: false };
      const n = Number(cleaned);
      return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
    }
    return { ok: false };
  }
  if (type === "date") {
    if (typeof value !== "string") return { ok: false };
    const trimmed = value.trim();
    // Strictly YYYY-MM-DD. Anything else is ambiguous, and an
    // ambiguous date silently mis-parsed is worse than no date.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return { ok: false };
    if (Number.isNaN(Date.parse(trimmed))) return { ok: false };
    return { ok: true, value: trimmed };
  }
  if (type === "boolean") {
    if (typeof value === "boolean") return { ok: true, value };
    return { ok: false };
  }
  if (typeof value !== "string") return { ok: false };
  const trimmed = value.trim();
  return trimmed.length > 0 ? { ok: true, value: trimmed } : { ok: false };
}

export function parseExtractionResponse(
  raw: string,
  vocabulary: VocabularyInput = "invoice"
): ExtractionResult {
  const v = asResolved(vocabulary);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // guided_json should prevent this, but a model that ignored it,
    // or a Workers AI response shape this wasn't written against,
    // must produce a refusal rather than a crash.
    throw new ExtractionRefusal("the model's response was not valid JSON", raw);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ExtractionRefusal("the model's response was not a JSON object", raw);
  }
  const obj = parsed as Record<string, unknown>;

  const expected = new Map<string, FieldType>();
  for (const f of STANDARD_EXTRACTION_FIELDS) expected.set(f.key, f.type);
  for (const f of v.customFields) expected.set(f.key, f.type);

  const facts: InvoiceFacts = {};
  const missingFields: string[] = [];

  for (const [key, type] of expected) {
    const result = coerce(obj[key], type);
    if (result.ok) {
      facts[key] = result.value;
    } else {
      // Covers both "the model returned null" and "the model returned
      // something that could not be coerced to its declared type".
      // Both mean the same thing downstream: this field was not
      // reliably read, and no value is recorded for it.
      missingFields.push(key);
    }
  }

  const rawConfidence = obj._confidence;
  if (typeof rawConfidence !== "number" || !Number.isFinite(rawConfidence)) {
    throw new ExtractionRefusal("the model did not report a usable confidence score", raw);
  }
  const confidence = Math.min(1, Math.max(0, rawConfidence));

  // An extraction that read nothing at all is a refusal, not a
  // successful extraction of an empty invoice. Storing that would
  // create a record indistinguishable from a real but empty document.
  if (Object.keys(facts).length === 0) {
    throw new ExtractionRefusal("no fields could be read from this image at all", raw);
  }

  // Exposed as a real derived fact so customers can write rules
  // against it — "if extraction confidence is below 0.8, assign a
  // task to the AP team" — rather than this module deciding a
  // threshold on their behalf.
  facts["extraction.confidence"] = confidence;

  return { facts, confidence, missingFields, rawModelOutput: raw };
}

export async function extractInvoiceFromImage(
  model: ExtractionModel,
  bytes: Uint8Array,
  vocabulary: VocabularyInput = "invoice"
): Promise<ExtractionResult> {
  const sniffed = sniffImageType(bytes);
  if (!sniffed) {
    throw new ExtractionRefusal(
      `unsupported image format — expected one of ${SUPPORTED_IMAGE_TYPES.join(", ")}`
    );
  }

  const raw = await model.extract(
    buildExtractionPrompt(vocabulary),
    toDataUrl(bytes, sniffed),
    buildExtractionSchema(vocabulary)
  );
  return parseExtractionResponse(raw, vocabulary);
}

export type { ResolvedVocabulary };
export { isKnownFieldType };
