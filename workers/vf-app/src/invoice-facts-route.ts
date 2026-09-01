import type { InvoiceFacts } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";

/**
 * Persists invoice header and line facts — see docs/decisions/
 * 0017-invoice-facts-storage.md. Deliberately narrow: this accepts
 * already-extracted facts as JSON, the same shape POST /rules/
 * evaluate's own inline `facts` already takes. It does not parse a
 * PDF, XML, or JPEG — that's the separate, still-unbuilt document
 * ingestion path decision 0013 and decision 0015 both already
 * flagged as missing. This bundle is what happens once facts exist,
 * not how they get extracted from a raw document.
 */

/**
 * Merges an invoice_headers row's structured columns into a parsed
 * facts object, under each column's real vocabulary field name — only
 * when the column is actually set. A NULL column must never overwrite
 * a genuine value already present in facts_json.
 *
 * Extracted as a shared function rather than left inline in one route
 * (decision 0028's own fix, originally written only for /rules/
 * evaluate) after the exact same gap was found a second time in
 * intake-capture-route.ts — the same correctness bug shouldn't get a
 * second, separate place to hide.
 */
export interface InvoiceHeaderStructuredColumns {
  supplier_vat_id: string | null;
  currency: string | null;
  issue_date: string | null;
  total_with_vat: number | null;
  mandate_channel: string | null;
  invoice_number: string | null;
  duplicate_confidence: number | null;
}

export function mergeStructuredInvoiceFacts(facts: InvoiceFacts, row: InvoiceHeaderStructuredColumns): InvoiceFacts {
  const merged = { ...facts };
  if (row.invoice_number !== null) merged["BT-1"] = row.invoice_number;
  if (row.supplier_vat_id !== null) merged["BT-31"] = row.supplier_vat_id;
  if (row.currency !== null) merged["BT-5"] = row.currency;
  if (row.issue_date !== null) merged["BT-2"] = row.issue_date;
  if (row.total_with_vat !== null) merged["BT-112"] = row.total_with_vat;
  if (row.mandate_channel !== null) merged["mandate.channel"] = row.mandate_channel;
  if (row.duplicate_confidence !== null) merged["invoice.duplicate_confidence"] = row.duplicate_confidence;
  return merged;
}

interface InvoiceLineInput {
  lineNumber?: unknown;
  description?: unknown;
  amount?: unknown;
  costCentre?: unknown;
  facts?: unknown;
}

interface UpsertInvoiceBody {
  id?: unknown;
  supplierVatId?: unknown;
  currency?: unknown;
  issueDate?: unknown;
  totalWithVat?: unknown;
  mandateChannel?: unknown;
  invoiceNumber?: unknown;
  facts?: unknown;
  lines?: unknown;
}

function isValidLine(line: unknown): line is InvoiceLineInput {
  if (typeof line !== "object" || line === null) return false;
  const l = line as InvoiceLineInput;
  return typeof l.lineNumber === "number";
}

/**
 * Decision 0028's weighted duplicate score. Supplier is the gate —
 * without a matching supplier, nothing else is meaningful evidence of
 * duplication; two different suppliers with a coincidentally similar
 * amount is just coincidence, not partial duplication. Given a
 * matching supplier, three independently-weighted signals sum toward
 * 1.0: an exact invoice number match (0.6, the single strongest
 * signal — suppliers essentially never legitimately reuse invoice
 * numbers), an exact total amount match (0.25), and an exact issue
 * date match (0.15). Deliberately simple and explainable — exact
 * match only, no fuzzy string matching — easy to justify to an
 * auditor, the same explainability-over-cleverness discipline this
 * project has favored everywhere else. Compares against every other
 * invoice already on file from the same supplier; the maximum score
 * against any single candidate wins, not a sum across candidates.
 */
async function computeDuplicateConfidence(
  db: D1Database,
  excludeId: string,
  supplierVatId: string | null,
  invoiceNumber: string | null,
  totalWithVat: number | null,
  issueDate: string | null
): Promise<number> {
  if (!supplierVatId) return 0;

  const candidates = await db
    .prepare("SELECT invoice_number, total_with_vat, issue_date FROM invoice_headers WHERE supplier_vat_id = ? AND id != ?")
    .bind(supplierVatId, excludeId)
    .all<{ invoice_number: string | null; total_with_vat: number | null; issue_date: string | null }>();

  let maxScore = 0;
  for (const candidate of candidates.results) {
    let score = 0;
    if (invoiceNumber !== null && candidate.invoice_number === invoiceNumber) score += 0.6;
    if (totalWithVat !== null && candidate.total_with_vat === totalWithVat) score += 0.25;
    if (issueDate !== null && candidate.issue_date === issueDate) score += 0.15;
    maxScore = Math.max(maxScore, score);
  }
  return maxScore;
}

/**
 * Upsert, not insert-only — an invoice's facts are expected to be
 * refined over an invoice's lifecycle (a correction, an enrichment
 * agent adding a derived fact once the workflow engine exists), the
 * same reasoning the migration's own comment gives for why this data
 * is mutable rather than versioned-and-immutable like rule_versions.
 * Calling this again for the same id replaces the header's facts and
 * fully replaces its line set — never a partial, ambiguous merge.
 *
 * Duplicate confidence (decision 0028) is computed and stored on
 * every upsert — the invoice being submitted, never a retroactive
 * rescore of anything already on file. An earlier invoice was
 * submitted first; it shouldn't suddenly read as "a duplicate" just
 * because something similar arrives later. The later submission is
 * the one whose score reflects the match.
 */
export async function handleUpsertInvoice(db: D1Database, body: UpsertInvoiceBody): Promise<RouteResult> {
  const { id, supplierVatId, currency, issueDate, totalWithVat, mandateChannel, invoiceNumber, facts, lines } = body;
  if (typeof id !== "string" || !id) {
    return { status: 400, body: { error: "id (string) is required" } };
  }
  if (facts !== undefined && (typeof facts !== "object" || facts === null || Array.isArray(facts))) {
    return { status: 400, body: { error: "facts, if provided, must be an object" } };
  }
  if (lines !== undefined && !Array.isArray(lines)) {
    return { status: 400, body: { error: "lines, if provided, must be an array" } };
  }
  const lineInputs = (lines ?? []) as unknown[];
  if (!lineInputs.every(isValidLine)) {
    return { status: 422, body: { error: "one or more lines is missing a numeric lineNumber" } };
  }
  const lineNumbers = (lineInputs as InvoiceLineInput[]).map((l) => l.lineNumber);
  if (new Set(lineNumbers).size !== lineNumbers.length) {
    return { status: 422, body: { error: "line numbers must be unique within one invoice" } };
  }

  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM invoice_headers WHERE id = ?").bind(id).first();

  const resolvedSupplierVatId = (supplierVatId as string) ?? null;
  const resolvedInvoiceNumber = (invoiceNumber as string) ?? null;
  const resolvedTotalWithVat = (totalWithVat as number) ?? null;
  const resolvedIssueDate = (issueDate as string) ?? null;

  const duplicateConfidence = await computeDuplicateConfidence(
    db,
    id,
    resolvedSupplierVatId,
    resolvedInvoiceNumber,
    resolvedTotalWithVat,
    resolvedIssueDate
  );

  const statements = [
    existing
      ? db
          .prepare(
            `UPDATE invoice_headers
             SET supplier_vat_id = ?, currency = ?, issue_date = ?, total_with_vat = ?, mandate_channel = ?,
                 invoice_number = ?, duplicate_confidence = ?, facts_json = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            resolvedSupplierVatId,
            (currency as string) ?? null,
            resolvedIssueDate,
            resolvedTotalWithVat,
            (mandateChannel as string) ?? null,
            resolvedInvoiceNumber,
            duplicateConfidence,
            JSON.stringify(facts ?? {}),
            now,
            id
          )
      : db
          .prepare(
            `INSERT INTO invoice_headers
               (id, supplier_vat_id, currency, issue_date, total_with_vat, mandate_channel,
                invoice_number, duplicate_confidence, facts_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            resolvedSupplierVatId,
            (currency as string) ?? null,
            resolvedIssueDate,
            resolvedTotalWithVat,
            (mandateChannel as string) ?? null,
            resolvedInvoiceNumber,
            duplicateConfidence,
            JSON.stringify(facts ?? {}),
            now,
            now
          ),
    // Full replace of the line set — never a partial merge, so a
    // caller can never end up with a mix of old and new lines by
    // accident.
    db.prepare("DELETE FROM invoice_lines WHERE invoice_id = ?").bind(id),
    ...(lineInputs as InvoiceLineInput[]).map((line) =>
      db
        .prepare(
          `INSERT INTO invoice_lines (id, invoice_id, line_number, description, amount, cost_centre, facts_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          id,
          line.lineNumber,
          (line.description as string) ?? null,
          (line.amount as number) ?? null,
          (line.costCentre as string) ?? null,
          JSON.stringify(line.facts ?? {})
        )
    ),
  ];

  await db.batch(statements);

  return {
    status: existing ? 200 : 201,
    body: { id, lineCount: lineInputs.length, duplicateConfidence },
  };
}
