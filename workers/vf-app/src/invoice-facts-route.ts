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
  facts?: unknown;
  lines?: unknown;
}

function isValidLine(line: unknown): line is InvoiceLineInput {
  if (typeof line !== "object" || line === null) return false;
  const l = line as InvoiceLineInput;
  return typeof l.lineNumber === "number";
}

/**
 * Upsert, not insert-only — an invoice's facts are expected to be
 * refined over an invoice's lifecycle (a correction, an enrichment
 * agent adding a derived fact once the workflow engine exists), the
 * same reasoning the migration's own comment gives for why this data
 * is mutable rather than versioned-and-immutable like rule_versions.
 * Calling this again for the same id replaces the header's facts and
 * fully replaces its line set — never a partial, ambiguous merge.
 */
export async function handleUpsertInvoice(db: D1Database, body: UpsertInvoiceBody): Promise<RouteResult> {
  const { id, supplierVatId, currency, issueDate, totalWithVat, mandateChannel, facts, lines } = body;
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

  const statements = [
    existing
      ? db
          .prepare(
            `UPDATE invoice_headers
             SET supplier_vat_id = ?, currency = ?, issue_date = ?, total_with_vat = ?, mandate_channel = ?, facts_json = ?, updated_at = ?
             WHERE id = ?`
          )
          .bind(
            (supplierVatId as string) ?? null,
            (currency as string) ?? null,
            (issueDate as string) ?? null,
            (totalWithVat as number) ?? null,
            (mandateChannel as string) ?? null,
            JSON.stringify(facts ?? {}),
            now,
            id
          )
      : db
          .prepare(
            `INSERT INTO invoice_headers
               (id, supplier_vat_id, currency, issue_date, total_with_vat, mandate_channel, facts_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .bind(
            id,
            (supplierVatId as string) ?? null,
            (currency as string) ?? null,
            (issueDate as string) ?? null,
            (totalWithVat as number) ?? null,
            (mandateChannel as string) ?? null,
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
    body: { id, lineCount: lineInputs.length },
  };
}
