import type { RouteResult } from "./org-route.js";

/**
 * Frequency-based Account Coding defaults — decision 0456, Phase 1 of
 * the autocode idea the operator raised.
 *
 * **The training data already exists.** `keyed_fields` (decision
 * 0071/0109) has recorded every person-keyed value, per invoice and
 * line, since Account Coding's own fields became keyable (decision
 * 0451). This is that history read back, not a new capture mechanism —
 * a customer who has been coding invoices for a month already has a
 * suggestion engine's worth of data sitting in a table nobody built
 * for this purpose.
 *
 * **Frequency, not a model.** Deliberately the simpler of the two
 * phases discussed with the operator: "what did this supplier's own
 * lines usually get coded to" is a GROUP BY, fully explainable, and
 * useful from the first handful of examples — where a trained model
 * needs volume a new customer will not have yet. A real learned model
 * (predicting from a line's own description or amount, not just
 * supplier identity) is Phase 2, deferred until there's evidence
 * frequency alone is missing real patterns.
 *
 * **Advisory only, by design — the same posture every other automated
 * thing in this product already takes** (a compiled rule needs a
 * person to activate it, a stage error is surfaced rather than acted
 * on, a duplicate is flagged rather than blocked). This module never
 * writes a fact; it returns a suggestion for the caller to pre-fill,
 * and a person still keys the real value — which is also what keeps
 * `keyed_fields` recording genuine confirmations rather than the
 * suggestion engine quietly grading its own homework.
 */

/** The four Account Coding fields decision 0453's pop-out already keys — line-scope, none parsed from the document. */
export const CODING_SUGGESTION_FIELDS = ["BT-133", "coding.project", "coding.commodity_code", "coding.gl_code"] as const;
export type CodingSuggestionField = (typeof CODING_SUGGESTION_FIELDS)[number];

/**
 * Below this many prior keyed examples for this supplier and field, no
 * suggestion is offered at all — a "pattern" built from one or two
 * invoices is noise wearing a confident face, and offering nothing is
 * more honest than offering a coin flip.
 */
const MIN_SAMPLE_SIZE = 3;

/**
 * Below this share of the sample, the most common value isn't common
 * enough to call a pattern — three different Cost Centres appearing
 * once each is three data points and zero signal.
 */
const MIN_CONFIDENCE = 0.5;

export interface CodingSuggestion {
  value: string;
  /** topCount / sampleSize — how much of this supplier's own history agrees with this value. */
  confidence: number;
  /** How many prior keyed values for this field/supplier this suggestion is drawn from. */
  sampleSize: number;
}

interface FrequencyRow {
  new_value: string;
  cnt: number;
}

/**
 * One field's suggestion, or none if there isn't enough agreement in
 * this supplier's own history to offer one.
 *
 * `new_value` is stored `JSON.stringify`-encoded (key-fields-route.ts)
 * so a string and a number never collide as text — parsed back here,
 * with a row that fails to parse simply excluded rather than crashing
 * a suggestion for every other row.
 */
async function suggestOneField(
  db: D1Database,
  field: CodingSuggestionField,
  supplierVatId: string
): Promise<CodingSuggestion | undefined> {
  const rows = await db
    .prepare(
      `SELECT kf.new_value AS new_value, COUNT(*) AS cnt
       FROM keyed_fields kf
       JOIN invoice_headers ih ON ih.id = kf.invoice_id
       WHERE kf.field = ?
         AND kf.line_number IS NOT NULL
         AND ih.supplier_vat_id = ?
       GROUP BY kf.new_value
       ORDER BY cnt DESC`
    )
    .bind(field, supplierVatId)
    .all<FrequencyRow>();

  if (rows.results.length === 0) return undefined;

  const sampleSize = rows.results.reduce((sum, row) => sum + row.cnt, 0);
  if (sampleSize < MIN_SAMPLE_SIZE) return undefined;

  const top = rows.results[0];
  const confidence = top.cnt / sampleSize;
  if (confidence < MIN_CONFIDENCE) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(top.new_value);
  } catch {
    return undefined; // a row that can't be read back suggests nothing, rather than a raw JSON string
  }
  if (typeof value !== "string" || value.trim() === "") return undefined;

  return { value, confidence, sampleSize };
}

/**
 * Suggestions for all four fields at once, for one supplier — the
 * shape the pop-out needs in a single call rather than four.
 */
export async function suggestCodingValues(
  db: D1Database,
  supplierVatId: string
): Promise<Partial<Record<CodingSuggestionField, CodingSuggestion>>> {
  const entries = await Promise.all(
    CODING_SUGGESTION_FIELDS.map(async (field) => [field, await suggestOneField(db, field, supplierVatId)] as const)
  );
  const result: Partial<Record<CodingSuggestionField, CodingSuggestion>> = {};
  for (const [field, suggestion] of entries) {
    if (suggestion) result[field] = suggestion;
  }
  return result;
}

export async function handleCodingSuggestions(db: D1Database, invoiceId: string): Promise<RouteResult> {
  const header = await db
    .prepare("SELECT supplier_vat_id FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ supplier_vat_id: string | null }>();
  if (!header) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }
  if (!header.supplier_vat_id) {
    // No identified supplier — no history to compare against. Not an
    // error; there is simply nothing to suggest yet, the same "empty
    // is a real, valid state" precedent an empty rule set already set.
    return { status: 200, body: { suggestions: {} } };
  }

  const suggestions = await suggestCodingValues(db, header.supplier_vat_id);
  return { status: 200, body: { suggestions } };
}
