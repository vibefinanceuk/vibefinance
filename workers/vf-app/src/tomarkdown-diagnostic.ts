import type { RouteResult } from "./org-route.js";

/**
 * A diagnostic, not a product feature — for the text-layer design in
 * docs/design/text-layer-extraction.md.
 *
 * It answers one question and nothing else: does env.AI.toMarkdown()
 * preserve enough of an invoice's structure for a model to interpret
 * it? Cloudflare's own example shows page markers and metadata for a
 * prose document; whether an eight-row charge table survives readably
 * is unknown, and reasoning about it has been unreliable all week.
 *
 * Deliberately does NOT interpret the result. Adding a model call
 * would confound two questions — "was the text extracted?" and "can a
 * model read it?" — and the first has to be answered before the
 * second is worth asking. The same mistake as building a diagnostic
 * that tested a simplified request (decision 0045).
 */

interface ToMarkdownCapable {
  toMarkdown(
    docs: { name: string; blob: Blob }[]
  ): Promise<{ name: string; mimeType: string; format: string; tokens: number; data: string }[]>;
}

export async function handleToMarkdownDiagnostic(
  ai: unknown,
  bytes: Uint8Array,
  filename = "invoice.pdf"
): Promise<RouteResult> {
  const binding = ai as Partial<ToMarkdownCapable>;
  if (typeof binding?.toMarkdown !== "function") {
    // Reported rather than assumed: toMarkdown is newer than the rest
    // of this codebase's AI usage, and a binding without it would
    // otherwise fail as a confusing type error at runtime.
    return {
      status: 501,
      body: { error: "this AI binding does not expose toMarkdown" },
    };
  }

  let converted;
  try {
    converted = await binding.toMarkdown([
      { name: filename, blob: new Blob([bytes as BlobPart], { type: "application/octet-stream" }) },
    ]);
  } catch (err) {
    return { status: 502, body: { error: `toMarkdown failed: ${String(err).slice(0, 500)}` } };
  }

  const doc = converted?.[0];
  if (!doc) {
    return { status: 502, body: { error: "toMarkdown returned no document" } };
  }

  const text = doc.data ?? "";

  // The specific values this document is known to contain. Checking
  // for them directly answers "did the structure survive" far more
  // usefully than a character count — a scanned PDF can yield
  // thousands of characters of nothing useful.
  const looksFor: Record<string, string> = {
    invoiceNumber: "SKELS26003894",
    supplierVat: "DE813799533",
    clientVat: "DE273445064",
    subtotal: "3,137.47",
    firstLineAmount: "1,797.47",
    firstLineDescription: "International Freight",
    lastLineDescription: "Drop off",
    totalsLabel: "SUBTOTAL",
  };
  const found: Record<string, boolean> = {};
  for (const [label, needle] of Object.entries(looksFor)) {
    found[label] = text.includes(needle);
  }

  return {
    status: 200,
    body: {
      mimeType: doc.mimeType,
      format: doc.format,
      // Zero would confirm the text layer was read rather than a
      // model describing the page — the difference between exact
      // characters and inferred ones.
      tokens: doc.tokens,
      characters: text.length,
      found,
      // The first stretch, so the shape of what came back is visible
      // rather than only whether known values appear in it.
      head: text.slice(0, 2500),
      // The totals block sits at the end and is the value most worth
      // seeing in context.
      tail: text.slice(-1500),
      note: "diagnostic only — remove once the text-layer question is settled",
    },
  };
}
