import type { InvoiceFacts } from "@vibefinance/shared";
import { DEFAULT_EXTRACTION_SETTINGS, type ExtractionSettings } from "./extraction-settings.js";
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

  /**
   * Whether the model **never answered**, as against answering badly —
   * decision 0163.
   *
   * A timeout is not a bad reading; it is **no reading**. Decision 0055
   * already says what to do with a document nothing could read: keep it
   * as an invoice with no facts, and let a person key it.
   *
   * Refusing outright is right for a model that read the document and
   * produced nonsense — *"a refusal, never a half-populated invoice"* —
   * and wrong for one that never got to look. The first is evidence the
   * document is not an invoice; the second is evidence about our
   * infrastructure.
   */
  readonly unanswered: boolean;

  /**
   * **The day's AI allowance is used up — decision 0696.** Workers AI
   * refused before looking (`4006`/`3036`, "daily free allocation"). Not a
   * fact about the document, and not even a fault: it passes at 00:00 UTC.
   * So a document is never failed or kept for keying for it; an emailed
   * one waits, and is read after the reset.
   */
  readonly allowance: boolean;

  constructor(message: string, rawModelOutput?: string, unanswered = false, allowance = false) {
    super(message);
    this.name = "ExtractionRefusal";
    this.rawModelOutput = rawModelOutput;
    this.unanswered = unanswered || allowance;
    this.allowance = allowance;
  }
}

/** Decision 0696: Workers AI's "daily free allocation used up" refusal, by its codes or its words. */
export function isAllowanceError(message: string): boolean {
  return /\b(4006|3036)\b/.test(message) || /daily free allocation/i.test(message);
}

/** The words for it, with the model's own message kept (decision 0163's rule: never discard the evidence). */
export function allowanceMessage(detail: string): string {
  return `the AI allowance for today is used up, so this was not read; it will be read after the allowance resets at 00:00 UTC (${detail.slice(0, 200)})`;
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
    images: readonly { bytes: Uint8Array; contentType: string }[],
    schema: Record<string, unknown>,
    /** Decision 0688: the separate lines call caps its answer lower. */
    opts?: { maxTokens?: number }
  ): Promise<string>;
}

/**
 * How many line items to ask for.
 *
 * A cap exists because an invoice with a hundred lines would produce
 * a response long enough to risk truncation — the max_tokens failure
 * decision 0002's addendum already recorded once, and one that
 * returns a partial JSON document rather than an honest refusal.
 *
 * 25, arrived at by lowering twice against real failures rather than
 * chosen up front. A two-page document first truncated its response,
 * then timed out entirely (AiError 3046) — and both are the same
 * underlying problem: the response is proportional to what the schema
 * asks for, so the cap on what is ASKED FOR is what actually bounds
 * it. Raising the token ceiling only moves the wall.
 *
 * Still a judgement, not a measurement. It covers every invoice seen
 * so far (the freight example has eight) with real room to spare. A
 * document genuinely exceeding it gets an honest refusal naming the
 * cause, never a silent truncation.
 *
 * Exceeding it is reported, never silently truncated — see
 * `linesTruncated` on the result.
 */
export const MAX_EXTRACTED_LINES = 25;

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
  { key: "BT-106", promptKey: "netTotalBeforeVat", type: "number", description: "The subtotal before VAT as PRINTED on the document, often labelled 'Subtotal' or 'Net'. Null if no such figure is printed — never add up the lines yourself." },
  { key: "BT-110", promptKey: "vatAmount", type: "number", description: "The VAT or tax amount as PRINTED, often labelled 'VAT' or 'Tax'. Null if not printed — never derive it." },
  { key: "BT-112", promptKey: "totalWithVat", type: "number", description: "The grand total including VAT as PRINTED — usually the largest figure and the last line of the totals block, labelled 'Total with VAT', 'Total Due' or 'Total'. Null if no total is printed on this page — never sum the lines or add VAT to a subtotal yourself." },
  { key: "BT-115", promptKey: "amountDue", type: "number", description: "The amount payable as PRINTED, if stated separately from the total. Null otherwise — never copy the total here, and never calculate it." },
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
export function buildExtractionSchema(
  vocabulary: VocabularyInput = "invoice",
  settings?: ExtractionSettings,
  /** Decision 0688: a scanned page's lines are asked for in a call of their own. */
  options: { lines?: boolean; columns?: readonly LineColumnAsk[] | null } = {}
): Record<string, unknown> {
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

  // Line items, asked for in the same call rather than a second one:
  // the model is already looking at the table, and a separate
  // inference would cost another round trip and risk the two
  // disagreeing about the same document.
  //
  // Deliberately minimal — description and amount only. Quantity and
  // unit price are common on product invoices and absent from freight
  // ones; these two are what the line-sum validation check needs, and
  // more can be added when something needs them.
  if (options.lines !== false) properties.lines = linesProperty(settings, options.columns);

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

/** The `lines` property: what a line item is, and the two keys every row must carry (0686). */
function linesProperty(settings?: ExtractionSettings, columns?: readonly LineColumnAsk[] | null): Record<string, unknown> {
  const extra = columnProperties(columns);
  return {
    type: ["array", "null"],
    description:
      `The invoice's line items, in the order they appear, up to ${settings?.maxExtractedLines ?? MAX_EXTRACTED_LINES}. Each is one charge or product row from the main table — not a subtotal, VAT line, or grand total. Null if the document has no itemised table at all.`,
    items: {
      type: "object",
      properties: {
        description: { type: ["string", "null"], description: "what this line is for, as printed" },
        amount: { type: ["number", "null"], description: "the line's own total amount as PRINTED, excluding VAT where the document separates them. Never calculated." },
        ...extra,
      },
      // Decision 0686: both keys required, as at the top level. Without
      // this, guided decoding let the model answer `lines: [{}]` — one
      // empty row, set aside as amount-less — on every one of Dan's scans.
      required: ["description", "amount", ...Object.keys(extra)],
    },
  };
}

/**
 * **The lines on their own — decision 0688.** Asked in a second call per
 * scanned page, after the header was read in a first. Requiring both keys
 * on every row (0686) made the model write out the table it had skipped
 * with `[{}]`, and on Dan's scans the answer no longer came back in time:
 * the header was lost with the lines. Apart, a header is read in seconds
 * whatever happens to the lines, and `maxItems` plus a lower token cap
 * bound how long a line answer can run.
 */
export function buildLinesSchema(settings?: ExtractionSettings, columns?: readonly LineColumnAsk[] | null): Record<string, unknown> {
  const lines = linesProperty(settings, columns);
  return {
    type: "object",
    properties: { lines: { ...lines, type: "array", maxItems: settings?.maxExtractedLines ?? MAX_EXTRACTED_LINES } },
    required: ["lines"],
  };
}

export function buildLinesPrompt(pageCount = 1, pageNumber?: number, columns?: readonly LineColumnAsk[] | null): string {
  const page = pageCount > 1 && pageNumber ? `This image is page ${pageNumber} of a ${pageCount}-page invoice. ` : "";
  return `${page}You are reading a photograph or scan of a supplier invoice. Return only its line items: each charge or product row of the main table, in order, as printed.

- One entry per row of the table. Not a subtotal, VAT line, discount summary or grand total.
- description: the row's item name or description, as printed.
- amount: the row's own line total as printed, excluding VAT where the document separates them — a plain number, a dot for the decimal point, no currency symbol or thousands separator. Never calculated.
- A row you cannot read: null for that value. Never guess.
- No table of line items on this page: an empty list.
${columnInstructions(columns)}
Return only the JSON object described by the schema.`;
}

export function buildExtractionPrompt(
  vocabulary: VocabularyInput = "invoice",
  pageCount = 1,
  pageNumber?: number,
  /** Decision 0703: what this supplier's invoices are known to look like, where known. */
  hint?: string | null
): string {
  const v = asResolved(vocabulary);
  const customSection =
    v.customFields.length === 0
      ? ""
      : `

This customer has also defined fields of their own. These are not part of any standard — the descriptions below are the customer's own:
${v.customFields.map((f) => `  ${customPromptKey(f.key)} (${f.type}) — ${f.description}`).join("\n")}`;

  // Each page is now its own call (decision 0046), so the note tells
  // the model WHICH page it is looking at rather than asking it to
  // reconcile several. That matters: a model shown only the totals
  // page would otherwise treat the absent line table as a failure to
  // read one, and report low confidence for a page it read perfectly.
  const pageNote =
    pageCount > 1 && pageNumber
      ? `This image is page ${pageNumber} of a ${pageCount}-page invoice. Extract everything this page shows, exactly as you would from a single-page invoice — including every row of any line-item table visible here. The only difference is that a field printed on a different page should be returned as null rather than guessed at.\n\n`
      : pageCount > 1
        ? `You are looking at ${pageCount} images. They are consecutive pages of ONE invoice, in order. Read them together: the line-item table may continue across a page break, and totals are commonly printed only on the last page. Report one set of values for the whole document, never one per page.\n\n`
        : ""

  return `${pageNote}You are reading a photograph or scan of a supplier invoice and extracting specific fields from it.

Rules that matter more than completeness:
- Report only what you can actually read on the document. If a field is not present, or you cannot read it confidently, return null for it. Never guess, never infer a plausible value, and never carry a value over from a different field.
- An invoice has two parties, and confusing them is the most common mistake. The SUPPLIER issues the invoice and is being paid — usually the letterhead at the top. The BUYER is being billed — usually under "Bill To" or "Invoice To". Read the field descriptions carefully and take each value from the correct party.
- An invoice number is a reference code such as "INV-2026-0042" or "MCD2001321-003". It is never a company name.
- Dates must be YYYY-MM-DD. If the document's date format is ambiguous (for example 03/04/2026), and you cannot tell from context which is the day and which is the month, return null rather than choosing.
- Amounts must be plain numbers with no currency symbol, no thousands separator, and a dot for the decimal point.
- Never calculate anything. Do not add up line amounts, do not derive a total from a subtotal and a VAT figure, and do not compute a missing value from other values on the page. If a total is not printed on the document, return null for it. Checking whether the numbers add up is a separate step that happens after you; your only job is to report what is written.
- Set _confidence honestly. A clear, sharp, complete invoice justifies a high score; a blurry photo, a cropped image, or a document you are partly guessing at does not.${customSection}

- Include every field named in the schema, even when the answer is null. Do not omit a key because you could not find its value.
${hint ? `\n${hint}\n` : ""}
Return only the JSON object described by the schema.`;
}

/** Decision 0703: what a reading is told beyond the document, where anything is known. */
export interface ReadingContext {
  hint?: string | null;
  /** Decision 0705: the supplier's line columns beyond item and amount, with the heading printed over each. */
  columns?: readonly LineColumnAsk[] | null;
}

/**
 * **A line column asked for because the supplier's table is known — decision
 * 0705.** Quantity, unit price and VAT rate are read only for a supplier
 * whose columns have been learned: asking every reading for them is what
 * made scans time out in 0686.
 */
export interface LineColumnAsk {
  field: "BT-129" | "BT-146" | "BT-152";
  heading: string | null;
}

const COLUMN_KEYS: Record<LineColumnAsk["field"], { key: string; what: string }> = {
  "BT-129": { key: "quantity", what: "the quantity invoiced, a plain number" },
  "BT-146": { key: "unitPrice", what: "the price of one unit, excluding VAT, a plain number" },
  "BT-152": { key: "vatRate", what: "the VAT rate as a percentage, a plain number (19 for 19%)" },
};

/** The extra properties of a line row for the columns asked (0705). */
function columnProperties(columns?: readonly LineColumnAsk[] | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const c of columns ?? []) {
    const k = COLUMN_KEYS[c.field];
    if (k) out[k.key] = { type: ["number", "null"], description: `${k.what}${c.heading ? `, from the column headed "${c.heading}"` : ""}. Null if the row has none.` };
  }
  return out;
}

/** The lines prompt's words for the columns asked (0705). */
function columnInstructions(columns?: readonly LineColumnAsk[] | null): string {
  const lines = (columns ?? [])
    .filter((c) => COLUMN_KEYS[c.field])
    .map((c) => `- ${COLUMN_KEYS[c.field].key}: ${COLUMN_KEYS[c.field].what}${c.heading ? `, in the column headed "${c.heading}" (lower case, no punctuation, as it was learned)` : ""}. As printed, never calculated; null if the row has none.`);
  return lines.length ? `\nThis supplier's table also has these columns; read them too:\n${lines.join("\n")}\n` : "";
}

/** A line in the canonical shape the rest of the system already uses:
 *  invoice facts plus a line number, with the amount under BT-131.
 *  Deliberately NOT a bespoke {description, amount} shape — the
 *  codebase already warns that passing raw, differently-shaped lines
 *  around caused a real bug once. */
export type ExtractedLine = InvoiceFacts & { lineNumber: number };

export interface ExtractionResult {
  facts: InvoiceFacts;
  lines: ExtractedLine[];
  /** True when the model reported more lines than the cap allows. The
   *  line-sum check must not run against a truncated list — it would
   *  report a mismatch that says nothing about the document, only
   *  about what was captured from it. */
  linesTruncated: boolean;
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

/**
 * **A line's amount, as invoices print it — decision 0685.** `coerce`
 * takes a number, or a string with at most a leading currency symbol and
 * thousands commas. A scanned invoice's line amounts came back in other
 * plain forms and every line was refused. These are read too, and
 * nothing else is:
 *
 * - a currency code before or after (`GBP 579.84`, `579.84 GBP`);
 * - a currency symbol after (`579.84 £`, `579,84 €` is not: see below);
 * - a credit in brackets (`(25.00)`), with a trailing minus (`25.00-`),
 *   or marked `CR` (`25.00 CR`), all negative.
 *
 * A decimal comma (`579,84`) is still refused here: it cannot be told
 * from a thousands comma in a two-digit tail without knowing the
 * document's locale, and inventing a value is worse than none (0041).
 */
export function lineAmount(value: unknown): { ok: true; value: string | number | boolean } | { ok: false } {
  const direct = coerce(value, "number");
  if (direct.ok || typeof value !== "string") return direct;
  let s = value.trim().replace(/[\s\u00a0]+/g, " ");
  let negative = false;
  const bracketed = s.match(/^\((.*)\)$/);
  if (bracketed) {
    negative = true;
    s = bracketed[1].trim();
  }
  const credit = s.match(/^(.*?)\s*(?:CR|Cr|cr)$/);
  if (credit) {
    negative = true;
    s = credit[1].trim();
  }
  if (/-$/.test(s) && !/^-/.test(s)) {
    negative = true;
    s = s.slice(0, -1).trim();
  }
  s = s
    .replace(/^[A-Z]{3}\s*/, "")
    .replace(/\s*[A-Z]{3}$/, "")
    .replace(/\s*[\u00a3\u20ac$\u00a5]$/, "")
    .trim();
  const again = coerce(s, "number");
  if (!again.ok) return again;
  return { ok: true, value: negative ? -Math.abs(again.value as number) : again.value };
}

export function parseExtractionResponse(
  raw: string,
  vocabulary: VocabularyInput = "invoice",
  // Per-channel settings (decision 0053). Defaults are exactly the
  // shipped behaviour, so every existing caller is unchanged.
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS
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

  // Line items. Every line must carry a usable amount, or the whole
  // list is discarded: validation's line-sum check compares against a
  // total, and a partial sum would produce a confident-looking
  // mismatch that reflects only what was captured. Better to have no
  // lines than misleading ones.
  const read = readLineRows(obj.lines, settings);
  const usableLines = read.lines;
  const linesTruncated = read.linesTruncated;

  // Exposed as a real derived fact so customers can write rules
  // against it — "if extraction confidence is below 0.8, assign a
  // task to the AP team" — rather than this module deciding a
  // threshold on their behalf.
  facts["extraction.confidence"] = confidence;
  // Decision 0684: what the model reported for the lines and what was kept, so an invoice
  // arriving with no lines says whether the model saw none or they were discarded.
  facts["extraction.lineRows"] = read.lineRows;
  facts["extraction.linesKept"] = usableLines.length;
  if (read.problem !== null) facts["extraction.lineProblem"] = read.problem;

  return { facts, lines: usableLines, linesTruncated, confidence, missingFields, rawModelOutput: raw };
}

/**
 * Extracts one invoice from one or more page images.
 *
 * Pages are passed in document order and reach the model in a single
 * call. A multi-page invoice is one document, not several — the
 * charge lines may run across a page break, and the totals are
 * commonly on the last page. Extracting each page separately and
 * merging the results in code would mean inventing an answer for what
 * to do when two pages disagree about the same field.
 */
/**
 * Which page a field came from, and what the other pages said.
 *
 * Only populated where pages genuinely disagreed. A conflict is not
 * an error — a header repeated on every page will agree, and a value
 * one page could not read is simply absent — but where two pages
 * both report a field and report it DIFFERENTLY, that is worth
 * surfacing rather than resolving silently.
 */
export interface PageConflict {
  field: string;
  /** The value kept, and the page it came from. */
  chosen: string | number | boolean;
  chosenPage: number;
  /** What the other pages said, by page number. */
  others: { page: number; value: string | number | boolean }[];
}

export interface MultiPageExtractionResult extends ExtractionResult {
  pageCount: number;
  conflicts: PageConflict[];
  /** Pages that failed outright. A page that could not be read does
   *  not sink the document — the others may still carry everything
   *  needed — but it must be visible, because a missing page is
   *  exactly why a total might not match its lines. */
  failedPages: { page: number; reason: string }[];
}

/** The separate lines call's token ceiling: 25 rows need about a thousand. */
export const LINES_MAX_TOKENS = 2500;
/** Decision 0705: what each extra column asked for adds to the lines answer's cap. */
export const LINES_TOKENS_PER_COLUMN = 400;

/**
 * **A scanned page's lines, asked for on their own — decision 0688.**
 * Only once its header was read. Whatever happens here, the header stands:
 * a lines call that times out, runs past its token cap or answers nonsense
 * leaves the page with no lines and `extraction.lineProblem` saying why,
 * with the start of what the model wrote when it wrote anything.
 */
async function readPageLines(
  model: ExtractionModel,
  result: ExtractionResult,
  image: { bytes: Uint8Array; contentType: string },
  pageCount: number,
  pageNumber: number,
  settings: ExtractionSettings,
  columns?: readonly LineColumnAsk[] | null
): Promise<void> {
  try {
    // Decision 0705: a row with more columns is a longer answer.
    const maxTokens = LINES_MAX_TOKENS + (columns?.length ?? 0) * LINES_TOKENS_PER_COLUMN;
    const raw = await model.extract(buildLinesPrompt(pageCount, pageNumber, columns), [image], buildLinesSchema(settings, columns), { maxTokens });
    const read = parseLinesResponse(raw, settings);
    result.lines = read.lines;
    result.linesTruncated = read.linesTruncated;
    result.facts["extraction.lineRows"] = read.lineRows;
    result.facts["extraction.linesKept"] = read.lines.length;
    if (read.problem !== null) result.facts["extraction.lineProblem"] = read.problem;
    else delete result.facts["extraction.lineProblem"];
  } catch (err) {
    // Decision 0696: not a fact about the lines; the document waits for the allowance, header and all.
    if (err instanceof ExtractionRefusal && err.allowance) throw err;
    const why = err instanceof Error ? err.message : String(err);
    const began = err instanceof ExtractionRefusal && err.rawModelOutput ? `; it began: ${err.rawModelOutput.slice(0, 160)}` : "";
    result.lines = [];
    result.facts["extraction.lineRows"] = 0;
    result.facts["extraction.linesKept"] = 0;
    result.facts["extraction.lineProblem"] = `lines not read: ${why.slice(0, 200)}${began}`;
  }
}

/**
 * **A line list as the model gave it, read into lines — decisions 0052,
 * 0684, 0685, 0686.** Shared by the one-call read (text) and the
 * separate lines call for a scanned page (0688).
 */
export function readLineRows(
  input: unknown,
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS
): { lines: ExtractedLine[]; linesTruncated: boolean; lineRows: number; problem: string | null } {
  const rawLines = Array.isArray(input) ? input : [];
  // Rows rejected as not being line items at all, counted separately
  // from rows that failed to parse. The distinction matters for the
  // completeness check below: a row that is not a line item is not
  // evidence that the real lines are unreliable.
  let rejectedRows = 0;
  let lineProblem: string | null = null;
  let setAside: string | null = null;
  const linesTruncated = rawLines.length > settings.maxExtractedLines;
  const lines: ExtractedLine[] = [];
  let lineNumber = 0;
  for (const raw of rawLines.slice(0, settings.maxExtractedLines)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    /**
     * **A row with no amount at all is not a line item — decision 0684.**
     * A scanned invoice's table carries rows of text with nothing in the
     * amount column: a description running onto a second line, a
     * delivery note, a sub-heading. Such a row was counted as a line that
     * failed to read, and one of them threw away every real line. It is
     * now set aside like a row with no description (0052). An amount that
     * is there and cannot be read still discards the list.
     */
    if (row.amount === null || row.amount === undefined || (typeof row.amount === "string" && row.amount.trim() === "")) {
      rejectedRows += 1;
      // Decision 0686: what a set-aside row looked like, kept when no line survives.
      if (setAside === null) setAside = `row ${lines.length + rejectedRows}: no amount: ${JSON.stringify(row).slice(0, 120)}`;
      continue;
    }
    const amount = lineAmount(row.amount);
    if (!amount.ok) {
      // Decision 0685: the first amount refused is kept, so a list discarded for it can be seen.
      if (lineProblem === null) lineProblem = `row ${lines.length + rejectedRows + 1}: amount ${JSON.stringify(row.amount).slice(0, 60)}`;
      continue;
    }

    // A line item has a description — decision 0052.
    //
    // Found live: a page with NO line table returned a single row
    // with a null description and an amount equal to the document
    // total. The prompt already says a line is "not a subtotal, VAT
    // line, or grand total"; it was ignored, which is the same
    // finding as everywhere else this week — a prompt instruction is
    // not a safety property.
    //
    // Deliberately the NARROWEST check that catches it. Rejecting a
    // line whose amount equals a stated total would be more targeted
    // and would also drop a legitimate single-line invoice, where
    // that shape is correct. This encodes something true of real
    // invoices rather than a guess about one document.
    //
    // REVISITABLE, and flagged as such: every extraction decision so
    // far comes from a single German freight invoice with an unusual
    // two-page structure. A customer whose invoices carry genuinely
    // unlabelled rows would need this relaxed, and "must a line have
    // a description" is the shape of thing that belongs in customer
    // configuration rather than platform code. See
    // docs/decisions/0052-line-must-have-description.md.
    const descriptionCheck = coerce(row.description, "text");
    if (settings.requireLineDescription && !descriptionCheck.ok) {
      rejectedRows += 1;
      if (setAside === null) setAside = `row ${lines.length + rejectedRows}: no description: ${JSON.stringify(row).slice(0, 120)}`;
      continue;
    }

    lineNumber += 1;
    const line: ExtractedLine = { lineNumber, "BT-131": amount.value };
    // **The line's text is its Item name, BT-153 — decision 0681.**
    // It used to be a plain `description` key (decision 0052), from
    // before BT-153 was in the vocabulary (0110). A scanned line now
    // carries the same Business Term an e-invoice line does, so the
    // line table, rules, coding suggestions and the ERP export read one
    // field whichever way the invoice arrived.
    if (descriptionCheck.ok) line["BT-153"] = descriptionCheck.value;
    // Decision 0705: the columns asked for because the supplier's table is known. One that cannot be read is left out, never discards the row.
    for (const [field, { key }] of Object.entries(COLUMN_KEYS)) {
      if (row[key] === null || row[key] === undefined) continue;
      const v = lineAmount(row[key]);
      if (v.ok) line[field] = v.value;
    }
    lines.push(line);
  }
  // A line whose AMOUNT could not be coerced means the list is
  // incomplete, and an incomplete list is worse than none for the one
  // thing lines are for — a partial sum produces a confident-looking
  // mismatch reflecting only what was captured.
  //
  // A row rejected for having no description is different: it was
  // never a line item, so its absence does not make the real lines
  // incomplete. Counting it here would throw away eight good charge
  // rows because a ninth was a totals row — which is what a naive
  // length comparison does.
  // Deliberate truncation is not a parse failure. When more rows were
  // reported than the cap allows, the shortfall is expected — so the
  // lines are kept and `linesTruncated` is what stops the line-sum
  // check running against an incomplete list. Comparing against the
  // capped count rather than the raw one keeps those two cases
  // distinct: "we could not read a row" still discards everything.
  const consideredRows = Math.min(rawLines.length, settings.maxExtractedLines);
  const usableLines = lines.length + rejectedRows === consideredRows ? lines : [];

  const problem = lineProblem ?? setAside;
  return { lines: usableLines, linesTruncated, lineRows: rawLines.length, problem: problem !== null && usableLines.length === 0 ? problem : null };
}

/** The separate lines call's answer (0688): `{ lines: [...] }`. A refusal if it is not JSON. */
export function parseLinesResponse(raw: string, settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExtractionRefusal("the model's line answer was not valid JSON", raw);
  }
  const obj = (parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}) as Record<string, unknown>;
  return readLineRows(obj.lines, settings);
}

/**
 * Extracts a multi-page document with ONE MODEL CALL PER PAGE,
 * merged afterwards — decision 0046.
 *
 * The single-call approach this replaces was the right first design
 * and failed against real documents: two scans of 1.5MB and 2.8MB
 * together exceeded the model's time budget (AiError 3046), while
 * either alone extracted comfortably. The constraint is total request
 * size, so the fix is to keep each request the size already known to
 * work.
 *
 * Merging looked like inventing an answer when this was first
 * designed. The real documents showed otherwise: page 1 of the
 * freight invoice carries the header and the line table, page 2
 * carries the totals. They are COMPLEMENTARY, not competing — so
 * "first page that could read it wins" is an honest rule rather than
 * a fudge, and the rare genuine disagreement is reported rather than
 * resolved.
 *
 * Pages run sequentially, not in parallel. Parallel would be faster,
 * but a burst of large concurrent inference requests is precisely
 * what produced the timeout being fixed here.
 */
export async function extractInvoiceFromImages(
  model: ExtractionModel,
  pages: readonly Uint8Array[],
  vocabulary: VocabularyInput = "invoice",
  // Per-channel settings (decision 0053). Previously absent entirely,
  // which meant every setting an administrator configured was
  // honoured nowhere in the image path — see decision 0056.
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS,
  context: ReadingContext = {}
): Promise<MultiPageExtractionResult> {
  if (pages.length === 0) {
    throw new ExtractionRefusal("no pages were supplied");
  }

  const perPage: { page: number; result: ExtractionResult }[] = [];
  const failedPages: { page: number; reason: string; unanswered: boolean }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const bytes = pages[i];
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      failedPages.push({
        page: pageNumber,
        reason: `unsupported image format — expected one of ${SUPPORTED_IMAGE_TYPES.join(", ")}`,
        // **A real answer about the document**, not a model that failed
        // to give one: this file is not an image we can read, and no
        // amount of retrying changes that (decision 0163).
        unanswered: false,
      });
      continue;
    }

    try {
      const ask = () =>
        model.extract(
          // Each call is told which page it is looking at and how many
          // there are, so a model seeing only the totals page does not
          // report the absent line table as a failure to read one.
          buildExtractionPrompt(vocabulary, pages.length, pageNumber, context.hint),
          [{ bytes, contentType: sniffed }],
          buildExtractionSchema(vocabulary, settings, { lines: false })
        );
      /**
       * **Asked once more when the model did not answer — decision
       * 0685.** Dan's scans showed the timeouts are intermittent: the
       * same two-page PDF went unanswered four times in five and was read
       * in full the fifth. One retry, only for a page the model never
       * answered (0163); a page it read and refused is not asked again.
       */
      let raw: string;
      try {
        raw = await ask();
      } catch (first) {
        if (!(first instanceof ExtractionRefusal && first.unanswered)) throw first;
        raw = await ask();
      }
      const result = parseExtractionResponse(raw, vocabulary, settings);
      await readPageLines(model, result, { bytes, contentType: sniffed }, pages.length, pageNumber, settings, context.columns);
      perPage.push({ page: pageNumber, result });
    } catch (err) {
      // Decision 0696: no allowance left means no page will be read now; the document waits whole.
      if (err instanceof ExtractionRefusal && err.allowance) throw err;
      // One unreadable page does not sink the document. The others
      // may carry everything needed, and the failure is recorded so
      // that a later validation mismatch has a visible explanation.
      failedPages.push({
        page: pageNumber,
        reason: err instanceof Error ? err.message : String(err),
        // **Whether the model answered at all** — decision 0163. Kept
        // per page, because one page timing out and another being
        // unreadable are different facts about the document.
        unanswered: err instanceof ExtractionRefusal && err.unanswered,
      });
    }
  }

  if (perPage.length === 0) {
    throw new ExtractionRefusal(
      failedPages.length === 1
        ? failedPages[0].reason
        : `none of the ${pages.length} pages could be read: ${failedPages.map((f) => `page ${f.page}: ${f.reason}`).join("; ")}`,
      undefined,
      /**
       * **Unanswered only if every page went unanswered** — decision
       * 0163.
       *
       * A document where one page timed out and another was genuinely
       * unreadable is a document the model *did* look at, and keeping
       * it as an invoice with no facts would hide a real refusal behind
       * an infrastructure problem.
       */
      failedPages.length > 0 && failedPages.every((f) => f.unanswered)
    );
  }

  return mergePageResults(perPage, pages.length, failedPages, settings);
}

/**
 * Merges per-page results into one.
 *
 * The rules, each chosen because the alternative would assert
 * something untrue:
 *
 * - **A field goes to the first page that read it.** Pages are
 *   complementary in practice; the first non-null answer is the only
 *   answer in the overwhelming majority of cases.
 * - **Disagreements are reported, not resolved.** Silently preferring
 *   one page would hide the one situation where a human genuinely
 *   needs to look.
 * - **Lines concatenate in page order**, renumbered sequentially, so
 *   a table continuing across a break reads as one table.
 * - **Confidence is the LOWEST any page reported**, never an average.
 *   A document is only as trustworthy as its least trustworthy page,
 *   and averaging would let a confident header page mask a barely
 *   legible one.
 * - **A field is missing only if EVERY page failed to read it.**
 */
export function mergePageResults(
  perPage: readonly { page: number; result: ExtractionResult }[],
  pageCount: number,
  failedPages: { page: number; reason: string }[] = [],
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS
): MultiPageExtractionResult {
  // Which page wins a disagreement is configurable (decision 0053).
  // 'first' suits documents whose header repeats on every page;
  // 'last' suits documents where a later page supersedes. Reversing
  // the order here rather than branching at every comparison keeps
  // the merge itself unchanged.
  const ordered = settings.conflictWinner === "last" ? [...perPage].reverse() : perPage;
  const facts: InvoiceFacts = {};
  const sources = new Map<string, number>();
  const conflicts: PageConflict[] = [];
  const conflictValues = new Map<string, { page: number; value: string | number | boolean }[]>();

  for (const { page, result } of ordered) {
    for (const [field, value] of Object.entries(result.facts)) {
      // Derived facts are recomputed after the merge, never carried
      // from a page: extraction.confidence in particular must reflect
      // the whole document, not whichever page happened to be first.
      if (field.startsWith("extraction.")) continue;
      if (!(field in facts)) {
        facts[field] = value;
        sources.set(field, page);
      } else if (facts[field] !== value) {
        const existing = conflictValues.get(field) ?? [];
        existing.push({ page, value: value as string | number | boolean });
        conflictValues.set(field, existing);
      }
    }
  }

  for (const [field, others] of conflictValues) {
    conflicts.push({
      field,
      chosen: facts[field] as string | number | boolean,
      chosenPage: sources.get(field) ?? 0,
      others,
    });
  }

  // Lines concatenate in page order and are renumbered, so a table
  // split across a page break reads as one continuous table rather
  // than two that both start at line 1.
  const lines: ExtractedLine[] = [];
  for (const { result } of perPage) {
    for (const line of result.lines) {
      // The explicit lineNumber overwrites the copied one, so there is
      // nothing to strip first.
      lines.push({ ...line, lineNumber: lines.length + 1 });
    }
  }

  // The lowest any page reported — and 0 if any page failed outright.
  //
  // Reporting confidence 1 for a document whose first page could not
  // be read at all is worse than reporting nothing: it is a confident
  // claim about a document half of which was never seen. Found live,
  // where a two-page invoice with a failed page one returned
  // confidence 1 from page two alone.
  let confidence =
    failedPages.length > 0 ? 0 : Math.min(...perPage.map((p) => p.result.confidence));

  // Missing only where EVERY page failed to read it: a field on page
  // 2 alone is not missing because page 1 could not see it.
  const missingFields = perPage[0].result.missingFields.filter(
    (field) => !(field in facts)
  );

  facts["extraction.confidence"] = confidence;
  // Decision 0684: line rows reported across every page, and lines kept.
  facts["extraction.lineRows"] = perPage.reduce((n, p) => n + Number(p.result.facts["extraction.lineRows"] ?? 0), 0);
  facts["extraction.linesKept"] = lines.length;
  // Decision 0685: the first refused amount on any page, when no lines were kept.
  const problem = perPage.map((p) => p.result.facts["extraction.lineProblem"]).find((v) => typeof v === "string");
  if (problem !== undefined && lines.length === 0) facts["extraction.lineProblem"] = problem;
  else delete facts["extraction.lineProblem"];
  // Conflicts and failed pages become real facts, so a rule can raise
  // a task for a human — decision 0048.
  //
  // Deliberately NOT resolved automatically. Preferring whichever
  // value happens to match the line sum would be defensible
  // arithmetic, and would also hide the signal entirely: nobody would
  // ever see that two pages disagreed, so nobody would ever configure
  // a rule for a supplier whose documents do it every time. The
  // manual task IS the trigger to go and fix it properly.
  facts["extraction.conflicts"] = conflicts.map((c) => c.field).join(",");
  facts["extraction.pagesFailed"] = failedPages.length;

  /**
   * **Does the reading add up?** — decision 0170.
   *
   * A real freight invoice came back with eight plausible lines
   * summing to 3,137.47 against a header `BT-106` of 2,272.47 — out by
   * 865.00 — and reported `extraction.confidence: 0.9` with no
   * conflicts. **The model was confident about a reading that does not
   * balance.**
   *
   * The arithmetic was available here the whole time. A line table that
   * does not sum to the header total is the strongest single signal
   * that a table was misread: a wrapped description, a merged cell, a
   * column taken for another.
   *
   * **Not an error, and not a refusal.** The document may genuinely be
   * inconsistent, and decision 0119's validation says so downstream.
   * This says something different and more useful to a person: *"we may
   * have read this badly"*, which wants a different response from
   * *"this invoice is wrong"*.
   *
   * So the confidence drops, and the discrepancy is named.
   */
  // An `ExtractedLine` is `InvoiceFacts & { lineNumber }` — the facts
  // directly, not nested under one.
  const lineTotal = lines.reduce((sum: number, line) => {
    const net = (line as Record<string, unknown>)["BT-131"];
    return sum + (typeof net === "number" ? net : 0);
  }, 0);
  const headerTotal = facts["BT-106"];

  if (lines.length > 0 && typeof headerTotal === "number") {
    // Rounded to the penny before comparing: floating point makes a
    // sum of decimals disagree with itself, and a rule about half a
    // penny would fire on arithmetic rather than on documents.
    const difference = Math.round((lineTotal - headerTotal) * 100) / 100;

    facts["extraction.linesDiffer"] = difference;

    if (difference !== 0) {
      /**
       * **Halved rather than zeroed.** The facts are still worth
       * having — a header read cleanly is a header read cleanly — and
       * a person keying needs somewhere to start. What is not warranted
       * is telling them we are 90% sure.
       */
      confidence = Math.min(confidence, 0.5);
    }
  }
  // The other page's reading, as a parameterised fact — decision
  // 0050. Naming WHICH fields disagreed was not enough to act on:
  // a rule resolving a conflict needs the value it is resolving TO,
  // and nothing exposed it. Found by writing a resolution rule that
  // copied from BT-106, only to discover BT-106 was in conflict too
  // and held the same wrong value.
  //
  // Only the FIRST alternative is exposed. Every real case so far is
  // two pages disagreeing; a rule needing to choose among three
  // readings would need to see them all, and that is a harder
  // question than this design should answer speculatively.
  for (const conflict of conflicts) {
    if (conflict.others.length > 0) {
      facts[`extraction.alternative(${conflict.field})`] = conflict.others[0].value;
    }
  }

  return {
    facts,
    lines,
    linesTruncated: perPage.some((p) => p.result.linesTruncated),
    confidence,
    missingFields,
    rawModelOutput: perPage.map((p) => `--- page ${p.page} ---\n${p.result.rawModelOutput}`).join("\n"),
    pageCount,
    conflicts,
    failedPages,
  };
}

/**
 * **An invoice read from its PDF's text — decision 0683.** The same
 * prompt, schema and parsing as a photograph, told it is reading text
 * rather than a picture. One call for the whole document: the text of
 * even a long invoice is small, and the model sees every page at once,
 * as the multi-page image prompt asks it to.
 */
export async function extractInvoiceFromPdfText(
  model: ExtractionModel,
  pages: readonly string[],
  vocabulary: VocabularyInput = "invoice",
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS,
  truncated = false,
  context: ReadingContext = {}
): Promise<ExtractionResult> {
  const prompt = buildExtractionPrompt(vocabulary, 1, undefined, context.hint).replace(
    "You are reading a photograph or scan of a supplier invoice and extracting specific fields from it.",
    "You are reading the text of a supplier invoice, taken from its PDF page by page, and extracting specific fields from it. The text below is all there is: the layout is lost, so a table's columns appear as words along a line, and a label may sit on the line before or after its value."
  );
  const text = pages.map((page, i) => `--- page ${i + 1} of ${pages.length} ---\n${page}`).join("\n\n");
  const raw = await model.extract(
    `${prompt}\n\nThe invoice's text${truncated ? " (cut short: the document is longer than one request can carry)" : ""}:\n\n${text}`,
    [],
    buildExtractionSchema(vocabulary, settings, { columns: context.columns })
  );
  return parseExtractionResponse(raw, vocabulary, settings);
}

export async function extractInvoiceFromImage(
  model: ExtractionModel,
  bytes: Uint8Array,
  vocabulary: VocabularyInput = "invoice",
  settings: ExtractionSettings = DEFAULT_EXTRACTION_SETTINGS,
  context: ReadingContext = {}
): Promise<ExtractionResult> {
  return extractInvoiceFromImages(model, [bytes], vocabulary, settings, context);
}

export type { ResolvedVocabulary };
export { isKnownFieldType };
