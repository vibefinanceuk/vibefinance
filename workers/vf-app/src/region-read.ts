/**
 * **Reading the part of a page a person lassoed — decision 0699.**
 *
 * The viewer reads a scan with Tesseract in the browser (decision 0698).
 * Where Tesseract is unsure of the words a person lassoed, or they are not
 * the kind of value the field wants (letters in an amount), the viewer
 * sends just that cut-out here and the vision model reads it: a few
 * hundred pixels, so a small part of the AI allowance rather than a page.
 *
 * And where no field had focus, the model also says **which field** the
 * cut-out looks like, from the fields the person could fill — the viewer
 * offers it ("Looks like Due date · Put it there"), and nothing is filled
 * until they say so.
 */
import { ExtractionRefusal, type ExtractionModel } from "./extraction.js";

/** The largest cut-out accepted, decoded. A lasso round a value is a few kilobytes. */
export const MAX_REGION_BYTES = 1_500_000;
/** Enough for any one value, and short enough that a runaway answer ends quickly. */
export const REGION_MAX_TOKENS = 300;
const MAX_FIELDS = 120;

export interface RegionField {
  field: string;
  label: string;
  kind: string;
}

export interface RegionAnswer {
  status: number;
  body: { text?: string; field?: string | null; error?: string; reason?: string };
}

const KIND_WORDS: Record<string, string> = {
  amount: "an amount of money",
  number: "a number",
  date: "a date",
  text: "text",
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

function decodeBase64(text: string): Uint8Array | null {
  try {
    const raw = atob(text.replace(/^data:[^,]*,/, ""));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/** The instruction to the model, from what the viewer knows about the cut-out. */
export function regionPrompt(opts: { label: string; kind: string; ocrText: string; context: string; fields: RegionField[] }): string {
  const parts = [
    "This image is a small part of an invoice, cut out by a person who drew round it.",
    opts.label
      ? `Read the value in it exactly as printed. It should be the invoice's "${opts.label}", which is ${KIND_WORDS[opts.kind] ?? "text"}.`
      : "Read the text in it exactly as printed.",
    "Give the value only: no label, no explanation. Keep its own separators and currency sign as printed.",
  ];
  if (opts.ocrText) parts.push(`A text reader saw "${opts.ocrText}", which may be wrong: correct it from the image.`);
  if (opts.context) parts.push(`Printed beside it on the page: "${opts.context}".`);
  if (opts.fields.length) {
    parts.push(
      "Also say which one of these invoice fields the value is, by its code, or \"none\" if none fits:",
      ...opts.fields.map((f) => `- ${f.field}: ${f.label} (${KIND_WORDS[f.kind] ?? "text"})`)
    );
  }
  parts.push("If there is no readable text, give an empty text.");
  return parts.join("\n");
}

/**
 * Reads a lassoed cut-out. `body` is the viewer's request:
 * `{ image (base64 JPEG or PNG), contentType?, label?, kind?, ocrText?, context?, fields? }`.
 */
export async function handleReadRegion(model: ExtractionModel | null, body: unknown): Promise<RegionAnswer> {
  if (!model) return { status: 503, body: { error: "AI binding not configured", reason: "ai_unavailable" } };
  const b = (body ?? {}) as Record<string, unknown>;
  const bytes = typeof b.image === "string" ? decodeBase64(b.image) : null;
  if (!bytes || bytes.length === 0) return { status: 400, body: { error: "image is required, as base64" } };
  if (bytes.length > MAX_REGION_BYTES) return { status: 413, body: { error: `the cut-out is larger than ${MAX_REGION_BYTES} bytes` } };
  const contentType = b.contentType === "image/png" ? "image/png" : "image/jpeg";

  const fields: RegionField[] = (Array.isArray(b.fields) ? b.fields : [])
    .slice(0, MAX_FIELDS)
    .map((f) => ({ field: clean((f as RegionField)?.field, 40), label: clean((f as RegionField)?.label, 80), kind: clean((f as RegionField)?.kind, 10) }))
    .filter((f) => /^[A-Za-z0-9._-]+$/.test(f.field));
  const kind = clean(b.kind, 10) || "text";
  const prompt = regionPrompt({
    label: clean(b.label, 80),
    kind,
    ocrText: clean(b.ocrText, 300),
    context: clean(b.context, 300),
    fields,
  });

  const schema: Record<string, unknown> = {
    type: "object",
    properties: {
      text: { type: "string" },
      ...(fields.length ? { field: { type: "string", enum: [...fields.map((f) => f.field), "none"] } } : {}),
    },
    required: fields.length ? ["text", "field"] : ["text"],
  };

  let raw: string;
  try {
    raw = await model.extract(prompt, [{ bytes, contentType }], schema, { maxTokens: REGION_MAX_TOKENS });
  } catch (err) {
    if (err instanceof ExtractionRefusal && err.allowance) {
      return { status: 503, body: { error: err.message, reason: "ai_allowance" } };
    }
    return { status: 502, body: { error: err instanceof Error ? err.message : String(err), reason: "ai_failed" } };
  }

  let parsed: { text?: unknown; field?: unknown };
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 502, body: { error: "the model's answer was not JSON", reason: "ai_failed" } };
  }
  const text = clean(parsed.text, 500);
  const field = typeof parsed.field === "string" && fields.some((f) => f.field === parsed.field) ? parsed.field : null;
  return { status: 200, body: { text, ...(fields.length ? { field } : {}) } };
}
