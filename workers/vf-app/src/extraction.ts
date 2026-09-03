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
    images: readonly { bytes: Uint8Array; contentType: string }[],
    schema: Record<string, unknown>
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

  // Line items, asked for in the same call rather than a second one:
  // the model is already looking at the table, and a separate
  // inference would cost another round trip and risk the two
  // disagreeing about the same document.
  //
  // Deliberately minimal — description and amount only. Quantity and
  // unit price are common on product invoices and absent from freight
  // ones; these two are what the line-sum validation check needs, and
  // more can be added when something needs them.
  properties.lines = {
    type: ["array", "null"],
    description:
      `The invoice's line items, in the order they appear, up to ${MAX_EXTRACTED_LINES}. Each is one charge or product row from the main table — not a subtotal, VAT line, or grand total. Null if the document has no itemised table at all.`,
    items: {
      type: "object",
      properties: {
        description: { type: ["string", "null"], description: "what this line is for, as printed" },
        amount: { type: ["number", "null"], description: "the line's own total amount as PRINTED, excluding VAT where the document separates them. Never calculated." },
      },
    },
  };

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

export function buildExtractionPrompt(
  vocabulary: VocabularyInput = "invoice",
  pageCount = 1,
  pageNumber?: number
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

Return only the JSON object described by the schema.`;
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

  // Line items. Every line must carry a usable amount, or the whole
  // list is discarded: validation's line-sum check compares against a
  // total, and a partial sum would produce a confident-looking
  // mismatch that reflects only what was captured. Better to have no
  // lines than misleading ones.
  const rawLines = Array.isArray(obj.lines) ? obj.lines : [];
  const linesTruncated = rawLines.length > MAX_EXTRACTED_LINES;
  const lines: ExtractedLine[] = [];
  let lineNumber = 0;
  for (const raw of rawLines.slice(0, MAX_EXTRACTED_LINES)) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const amount = coerce(row.amount, "number");
    if (!amount.ok) continue;
    lineNumber += 1;
    const line: ExtractedLine = { lineNumber, "BT-131": amount.value };
    // The description is deliberately NOT given a BT code. BT-153
    // exists in EN 16931, but adding it to the closed vocabulary
    // purely to carry text no rule tests would widen the vocabulary
    // for nothing — and invoice_lines already has its own
    // description column for exactly this. Kept under a plain key,
    // which flows through facts_json to storage without pretending
    // to be a Business Term.
    const description = coerce(row.description, "text");
    if (description.ok) line.description = description.value;
    lines.push(line);
  }
  // A line the model reported but whose amount could not be coerced
  // means the list is incomplete, and an incomplete list is worse
  // than none for the one thing lines are for.
  const usableLines = lines.length === rawLines.length ? lines : [];

  // Exposed as a real derived fact so customers can write rules
  // against it — "if extraction confidence is below 0.8, assign a
  // task to the AP team" — rather than this module deciding a
  // threshold on their behalf.
  facts["extraction.confidence"] = confidence;

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
  vocabulary: VocabularyInput = "invoice"
): Promise<MultiPageExtractionResult> {
  if (pages.length === 0) {
    throw new ExtractionRefusal("no pages were supplied");
  }

  const perPage: { page: number; result: ExtractionResult }[] = [];
  const failedPages: { page: number; reason: string }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const pageNumber = i + 1;
    const bytes = pages[i];
    const sniffed = sniffImageType(bytes);
    if (!sniffed) {
      failedPages.push({
        page: pageNumber,
        reason: `unsupported image format — expected one of ${SUPPORTED_IMAGE_TYPES.join(", ")}`,
      });
      continue;
    }

    try {
      const raw = await model.extract(
        // Each call is told which page it is looking at and how many
        // there are, so a model seeing only the totals page does not
        // report the absent line table as a failure to read one.
        buildExtractionPrompt(vocabulary, pages.length, pageNumber),
        [{ bytes, contentType: sniffed }],
        buildExtractionSchema(vocabulary)
      );
      perPage.push({ page: pageNumber, result: parseExtractionResponse(raw, vocabulary) });
    } catch (err) {
      // One unreadable page does not sink the document. The others
      // may carry everything needed, and the failure is recorded so
      // that a later validation mismatch has a visible explanation.
      failedPages.push({ page: pageNumber, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  if (perPage.length === 0) {
    throw new ExtractionRefusal(
      failedPages.length === 1
        ? failedPages[0].reason
        : `none of the ${pages.length} pages could be read: ${failedPages.map((f) => `page ${f.page}: ${f.reason}`).join("; ")}`
    );
  }

  return mergePageResults(perPage, pages.length, failedPages);
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
  failedPages: { page: number; reason: string }[] = []
): MultiPageExtractionResult {
  const facts: InvoiceFacts = {};
  const sources = new Map<string, number>();
  const conflicts: PageConflict[] = [];
  const conflictValues = new Map<string, { page: number; value: string | number | boolean }[]>();

  for (const { page, result } of perPage) {
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
      const { lineNumber: _ignored, ...rest } = line;
      lines.push({ ...rest, lineNumber: lines.length + 1 });
    }
  }

  const confidence = Math.min(...perPage.map((p) => p.result.confidence));

  // Missing only where EVERY page failed to read it: a field on page
  // 2 alone is not missing because page 1 could not see it.
  const missingFields = perPage[0].result.missingFields.filter(
    (field) => !(field in facts)
  );

  facts["extraction.confidence"] = confidence;

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

export async function extractInvoiceFromImage(
  model: ExtractionModel,
  bytes: Uint8Array,
  vocabulary: VocabularyInput = "invoice"
): Promise<ExtractionResult> {
  return extractInvoiceFromImages(model, [bytes], vocabulary);
}

export type { ResolvedVocabulary };
export { isKnownFieldType };
