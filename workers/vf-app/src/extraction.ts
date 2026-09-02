import type { InvoiceFacts } from "@vibefinance/shared";
import {
  asResolved,
  CUSTOM_FIELD_PREFIX,
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
  /**
   * Takes the raw image bytes and its detected content type, NOT a
   * pre-built data URL.
   *
   * Corrected after a live test (decision 0043 addendum): the shape
   * an image takes varies by model and by binding, so building a data
   * URL here would bake one guess into the interface. Handing over
   * bytes lets each adapter shape them however its own model
   * actually wants them.
   */
  extract(
    prompt: string,
    image: { bytes: Uint8Array; contentType: string },
    schema: Record<string, unknown>
  ): Promise<string>;
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
/**
 * The fields worth asking a model for.
 *
 * `promptKey` is what the model sees; `key` is where the value lands.
 *
 * That separation exists because of a real, measured failure. The
 * schema originally used Business Term ids (BT-1, BT-2, BT-31)
 * directly as its property names, and the model — which reads the
 * invoice perfectly well — could not map them to anything. It
 * returned the buyer's name for BT-1 and a postal address for BT-2,
 * and silently omitted six of the fourteen properties entirely.
 *
 * The diagnostic that proved it: given the same schema and a short
 * question, the model poured the same sentence into BT-1, BT-2,
 * BT-31, BT-5 and BT-9 alike. It was not mapping values to meanings;
 * it was filling opaque slots. "BT-31" carries no information to a
 * vision model, while "supplierVatNumber" carries all of it.
 *
 * So the model is asked in its own terms, and the answer is mapped
 * back to the closed vocabulary here — where the mapping is explicit,
 * reviewable, and cannot drift.
 */
const STANDARD_EXTRACTION_FIELDS: { key: string; promptKey: string; type: FieldType; description: string }[] = [
  { key: "BT-1", promptKey: "invoiceNumber", type: "text", description: "The invoice number, usually labelled 'Invoice Number', 'Invoice No' or 'Reference'. A document reference code such as 'INV-2026-0042' — never a company name." },
  { key: "BT-2", promptKey: "issueDate", type: "date", description: "The date the invoice was issued, as YYYY-MM-DD." },
  { key: "BT-9", promptKey: "paymentDueDate", type: "date", description: "The date payment is due, as YYYY-MM-DD. Null if the invoice does not state one." },
  { key: "BT-5", promptKey: "currencyCode", type: "text", description: "The currency as a 3-letter ISO code: GBP for pounds, EUR for euros, USD for dollars. Infer it from the currency symbol if no code is printed." },
  { key: "BT-13", promptKey: "purchaseOrderNumber", type: "text", description: "The purchase order or P.O. number, if the invoice quotes one. Null otherwise." },
  { key: "BT-31", promptKey: "supplierVatNumber", type: "text", description: "The VAT registration number of the SUPPLIER — the company issuing this invoice and receiving payment, shown in the letterhead at the top. Not the customer's." },
  { key: "BT-40", promptKey: "supplierCountryCode", type: "text", description: "The SUPPLIER's country as a 2-letter ISO code: GB for the United Kingdom, DE for Germany, FR for France." },
  { key: "BT-48", promptKey: "buyerVatNumber", type: "text", description: "The VAT registration number of the BUYER — the company being billed, usually under 'Bill To' or 'Invoice To'. Not the supplier's." },
  { key: "BT-106", promptKey: "netTotalBeforeVat", type: "number", description: "The subtotal before VAT, often labelled 'Subtotal' or 'Net'." },
  { key: "BT-110", promptKey: "vatAmount", type: "number", description: "The VAT or tax amount, often labelled 'VAT' or 'Tax'." },
  { key: "BT-112", promptKey: "totalWithVat", type: "number", description: "The grand total including VAT — usually the largest figure and the last line of the totals block, labelled 'Total with VAT', 'Total Due' or 'Total'." },
  { key: "BT-115", promptKey: "amountDue", type: "number", description: "The amount actually payable, if stated separately from the total. Null otherwise." },
];

/** A customer's own field keys are already human-readable labels
 *  turned into keys (decision 0041), so the prompt key is simply the
 *  label — 'custom.transport_reference' is as opaque to a model as
 *  'BT-31' is. */
function customPromptKey(key: string): string {
  return key.startsWith(CUSTOM_FIELD_PREFIX) ? key.slice(CUSTOM_FIELD_PREFIX.length) : key;
}

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
    properties[field.promptKey] = { type: jsonType(field.type), description: field.description };
  }
  // A customer's own declared fields (decision 0041) are asked for
  // using their own descriptions — which is exactly what that
  // description exists for.
  for (const field of v.customFields) {
    properties[customPromptKey(field.key)] = { type: jsonType(field.type), description: field.description };
  }

  properties._confidence = {
    type: "number",
    description:
      "your own confidence that the values above are correct, from 0.0 to 1.0. Be honest: a blurry or partial image should score low.",
  };

  // Every property is required, not just _confidence — and this is a
  // measured fix, not a stylistic one. With only _confidence
  // required, the model silently omitted six of fourteen properties
  // from its response, including the invoice total. Requiring all of
  // them forces it to consider each field and answer null rather than
  // quietly skipping it.
  //
  // Safe precisely because every property is nullable: "required"
  // here means "give me a key", never "invent a value".
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
  };
}

export function buildExtractionPrompt(vocabulary: VocabularyInput = "invoice"): string {
  const v = asResolved(vocabulary);
  const customSection =
    v.customFields.length === 0
      ? ""
      : `

This customer has also defined fields of their own. These are not part of any standard — the descriptions below are the customer's own:
${v.customFields.map((f) => `  ${customPromptKey(f.key)} (${f.type}) — ${f.description}`).join("\n")}`;

  return `You are reading a photograph or scan of a supplier invoice and extracting specific fields from it.

Rules that matter more than completeness:
- Report only what you can actually read on the document. If a field is not present, or you cannot read it confidently, return null for it. Never guess, never infer a plausible value, and never carry a value over from a different field.
- An invoice has two parties, and confusing them is the most common mistake. The SUPPLIER issues the invoice and is being paid — usually the letterhead at the top. The BUYER is being billed — usually under "Bill To" or "Invoice To". Read the field descriptions carefully and take each value from the correct party.
- An invoice number is a reference code such as "INV-2026-0042" or "MCD2001321-003". It is never a company name.
- Dates must be YYYY-MM-DD. If the document's date format is ambiguous (for example 03/04/2026), and you cannot tell from context which is the day and which is the month, return null rather than choosing.
- Amounts must be plain numbers with no currency symbol, no thousands separator, and a dot for the decimal point.
- A total that is printed on the document is always preferable to one you calculate yourself.
- Set _confidence honestly. A clear, sharp, complete invoice justifies a high score; a blurry photo, a cropped image, or a document you are partly guessing at does not.${customSection}

- Include every field named in the schema, even when the answer is null. Do not omit a key because you could not find its value.

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
        .replace(/[\s\u00a0]/g, "")
        // Thousands separators, which every real invoice uses:
        // "2,518.80" must parse. Only stripped when they sit in
        // genuine grouping positions, so "1,2,3" still fails rather
        // than silently becoming 123.
        .replace(/^(-?\d{1,3}(?:,\d{3})+)(\.\d+)?$/, (_m, intPart: string, frac = "") =>
          intPart.replace(/,/g, "") + frac
        );
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

  // promptKey -> [vocabulary key, type]. The model answers in its own
  // terms; the answer is mapped back to the closed vocabulary here.
  const expected = new Map<string, { key: string; type: FieldType }>();
  for (const f of STANDARD_EXTRACTION_FIELDS) expected.set(f.promptKey, { key: f.key, type: f.type });
  for (const f of v.customFields) expected.set(customPromptKey(f.key), { key: f.key, type: f.type });

  const facts: InvoiceFacts = {};
  const missingFields: string[] = [];

  for (const [promptKey, { key, type }] of expected) {
    const result = coerce(obj[promptKey], type);
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
    { bytes, contentType: sniffed },
    buildExtractionSchema(vocabulary)
  );
  return parseExtractionResponse(raw, vocabulary);
}

export type { ResolvedVocabulary };
export { isKnownFieldType };
