import type { InvoiceFacts } from "@vibefinance/shared";
import { validateInvoiceFacts } from "./validation.js";
import type { RouteResult } from "./org-route.js";
import { findSimilarInvoices } from "./invoice-history.js";

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
 *
 * The candidate lookup itself was extracted into findSimilarInvoices
 * (decision 0032) — this function now supplies only the scoring logic
 * on top of it, exactly the split decision 0015 originally called
 * for: a shared, general lookup, with each real consumer's own
 * comparison logic layered on top rather than duplicated into its own
 * query. Behavior is unchanged — every existing test for this
 * function still holds, unmodified.
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

  const candidates = await findSimilarInvoices(db, { excludeId, supplierVatId });

  let maxScore = 0;
  for (const candidate of candidates) {
    let score = 0;
    if (invoiceNumber !== null && candidate.invoiceNumber === invoiceNumber) score += 0.6;
    if (totalWithVat !== null && candidate.totalWithVat === totalWithVat) score += 0.25;
    if (issueDate !== null && candidate.issueDate === issueDate) score += 0.15;
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

/**
 * One invoice, with its facts and lines — decision 0120.
 *
 * **There was no way to read an invoice.** It could be keyed, placed,
 * given a document and a signed URL — and not fetched. So the keying
 * screen built its values from five fields on the task list's *summary*
 * row, and everything else somebody typed had nowhere to come back
 * from.
 *
 * Reported plainly: *"I click save, it says saved, I leave the screen
 * and re-enter, and it's empty again."* The save worked. Nothing read
 * it back.
 */
export async function handleGetInvoice(db: D1Database, invoiceId: string): Promise<RouteResult> {
  const invoice = await db
    .prepare(
      `SELECT id, supplier_vat_id, currency, issue_date, total_with_vat, facts_json,
              org_unit_id, org_assigned_by
       FROM invoice_headers WHERE id = ?`
    )
    .bind(invoiceId)
    .first<{
      id: string;
      supplier_vat_id: string | null;
      currency: string | null;
      issue_date: string | null;
      total_with_vat: number | null;
      facts_json: string;
      org_unit_id: string | null;
      org_assigned_by: string | null;
    }>();

  if (!invoice) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }

  let facts: Record<string, unknown> = {};
  try {
    facts = JSON.parse(invoice.facts_json || "{}") as Record<string, unknown>;
  } catch {
    // A row whose facts cannot be parsed still has an identity and
    // lines. Returning nothing would hide a document somebody needs to
    // look at — which is the opposite of what this system does with a
    // document it cannot read (decision 0063).
  }

  const lineRows = await db
    .prepare(
      "SELECT line_number, description, amount, cost_centre, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number"
    )
    .bind(invoiceId)
    .all<{
      line_number: number;
      description: string | null;
      amount: number | null;
      cost_centre: string | null;
      facts_json: string;
    }>();

  const lines = lineRows.results.map((row) => {
    let lineFacts: Record<string, unknown> = {};
    try {
      lineFacts = JSON.parse(row.facts_json || "{}") as Record<string, unknown>;
    } catch {
      // Same reasoning, per line.
    }
    return {
      lineNumber: row.line_number,
      description: row.description,
      amount: row.amount,
      costCentre: row.cost_centre,
      // **The facts, because those are what a rule tests** and what the
      // keying screen edits (decision 0109). The columns above are the
      // convenience copy.
      facts: lineFacts,
    };
  });

  /**
   * How the invoice validates **as it stands** — decision 0119.
   *
   * Without this the exceptions panel is empty until somebody presses
   * Save: they open a document with three failures, see *"Nothing to
   * resolve"*, and have to change something before being told what is
   * wrong. **The screen should say what it knows on arrival.**
   *
   * Computed rather than stored, and **advisory**, exactly as keying's
   * verdict is (decision 0072): re-running validation is not
   * re-evaluating rules, and nothing here moves the process.
   */
  const verdict = validateInvoiceFacts(
    facts as InvoiceFacts,
    lines.map((line) => line.facts as Record<string, unknown>)
  );

  return {
    status: 200,
    body: {
      id: invoice.id,
      facts,
      lines,
      orgUnitId: invoice.org_unit_id,
      orgAssignedBy: invoice.org_assigned_by,
      validation: {
        passed: verdict.passed,
        checked: verdict.checked,
        failures: verdict.failures,
        ...(verdict.involves ? { involves: verdict.involves } : {}),
        ...(verdict.invalidCodes ? { invalidCodes: verdict.invalidCodes } : {}),
        advisory: true,
      },
    },
  };
}
