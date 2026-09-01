/**
 * The historical, queryable invoice-facts framework — see
 * docs/decisions/0032-historical-invoice-facts-framework.md and
 * decision 0015's own original design, which this bundle carries
 * through directly rather than re-deciding: "one shared query
 * interface, with multiple purpose-built methods per real consumer —
 * not one generic query capability every consumer builds on top of
 * directly, and not separate ad-hoc implementations of 'search past
 * invoices.'" The same discipline `resolveTenant()` already enforces
 * for tenant-scoped data access, and `evaluateConditions()` already
 * demonstrates for the interpreter itself.
 *
 * `invoice_runs` has only ever logged evaluation *outcomes* — never
 * the actual field values that were evaluated. This module is what
 * persistence already exists for (`invoice_headers`/`invoice_lines`,
 * decision 0017) finally being queried across invoices, not just
 * read back for one.
 *
 * Deliberately not a closed set — decision 0015 named two confirmed
 * consumers beyond duplicate detection (a future operator UI, a
 * future analytics page); this file gives each a real method, and
 * a real, later consumer is expected to add its own rather than
 * force-fit an existing one.
 *
 * Lives inside each customer's own vf-app database, the same trust
 * boundary invoice_runs already sits inside — no new boundary,
 * decision 0001's own tenant-isolation model extended, not reopened.
 */

export interface SimilarInvoiceCandidate {
  id: string;
  invoiceNumber: string | null;
  totalWithVat: number | null;
  issueDate: string | null;
}

/**
 * Finds every other invoice on file from the same supplier — the
 * targeted lookup decision 0028's own duplicate-confidence scoring
 * already needed. Extracted here, and decision 0028's own logic
 * refactored to call this rather than run its own inline query, so
 * the same class of "separate ad-hoc implementation" decision 0015
 * explicitly declined doesn't quietly reappear. Returns raw
 * candidates only — comparing them against a specific invoice's own
 * values (decision 0028's weighted scoring) stays the caller's job,
 * not this method's; a general lookup shouldn't bake in one
 * consumer's own scoring logic.
 */
export async function findSimilarInvoices(
  db: D1Database,
  params: { excludeId: string; supplierVatId: string }
): Promise<SimilarInvoiceCandidate[]> {
  const rows = await db
    .prepare("SELECT id, invoice_number, total_with_vat, issue_date FROM invoice_headers WHERE supplier_vat_id = ? AND id != ?")
    .bind(params.supplierVatId, params.excludeId)
    .all<{ id: string; invoice_number: string | null; total_with_vat: number | null; issue_date: string | null }>();

  return rows.results.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    totalWithVat: r.total_with_vat,
    issueDate: r.issue_date,
  }));
}

export interface SupplierHistoryEntry {
  id: string;
  invoiceNumber: string | null;
  totalWithVat: number | null;
  issueDate: string | null;
  mandateChannel: string | null;
  duplicateConfidence: number | null;
}

/**
 * A supplier's own invoice history — the future-operator-UI use case
 * decision 0015 named directly: an operator reviewing one invoice
 * would naturally want to see what else this supplier has sent.
 * Ordered by created_at, not issue_date — issue_date is optional and
 * can be NULL, but created_at is guaranteed and represents when this
 * system actually received each record, the more operationally
 * meaningful "most recent" for someone reviewing incoming activity.
 */
export async function getSupplierHistory(db: D1Database, supplierVatId: string, limit = 20): Promise<SupplierHistoryEntry[]> {
  const rows = await db
    .prepare(
      `SELECT id, invoice_number, total_with_vat, issue_date, mandate_channel, duplicate_confidence
       FROM invoice_headers WHERE supplier_vat_id = ? ORDER BY created_at DESC LIMIT ?`
    )
    .bind(supplierVatId, limit)
    .all<{
      id: string;
      invoice_number: string | null;
      total_with_vat: number | null;
      issue_date: string | null;
      mandate_channel: string | null;
      duplicate_confidence: number | null;
    }>();

  return rows.results.map((r) => ({
    id: r.id,
    invoiceNumber: r.invoice_number,
    totalWithVat: r.total_with_vat,
    issueDate: r.issue_date,
    mandateChannel: r.mandate_channel,
    duplicateConfidence: r.duplicate_confidence,
  }));
}

export interface MonthlyTotal {
  month: string;
  totalAmount: number;
  invoiceCount: number;
}

/**
 * Aggregate totals by month — the future-analytics-page use case
 * decision 0015 named directly ("totals by month"). A genuinely
 * different access pattern from the two lookups above: a broad
 * aggregate rather than a narrow, targeted one, deliberately kept as
 * its own method rather than forced through the same shape — exactly
 * the distinction decision 0015 itself drew between these access
 * patterns.
 *
 * An invoice with no issue_date at all is excluded — there is no
 * month to meaningfully group it into. A real, honest limitation,
 * not a silent one: stated here rather than producing a misleading
 * "unknown month" bucket.
 */
export async function getMonthlyTotals(db: D1Database, params?: { supplierVatId?: string }): Promise<MonthlyTotal[]> {
  const supplierFilter = params?.supplierVatId ? "AND supplier_vat_id = ?" : "";
  const bindings = params?.supplierVatId ? [params.supplierVatId] : [];

  const rows = await db
    .prepare(
      `SELECT strftime('%Y-%m', issue_date) AS month,
              COALESCE(SUM(total_with_vat), 0) AS total_amount,
              count(*) AS invoice_count
       FROM invoice_headers
       WHERE issue_date IS NOT NULL ${supplierFilter}
       GROUP BY month
       ORDER BY month ASC`
    )
    .bind(...bindings)
    .all<{ month: string; total_amount: number; invoice_count: number }>();

  return rows.results.map((r) => ({
    month: r.month,
    totalAmount: r.total_amount,
    invoiceCount: r.invoice_count,
  }));
}
