import type { RouteResult } from "./org-route.js";

/**
 * Persists expense report facts — see docs/decisions/
 * 0025-intake-channel-in-routes-and-expense-storage.md. Mirrors
 * invoice-facts-route.ts's own handleUpsertInvoice exactly, the same
 * discipline decision 0017 established for invoices, applied here for
 * the first time to Expense. A single flat table, not a header/lines
 * split — expense reports, as decision 0022's own EXPENSE_FIELDS
 * modeled them, were never a header-with-multiple-lines document the
 * way an EN 16931 invoice genuinely is.
 *
 * Deliberately narrow, the same scope boundary invoice-facts-route.ts
 * already states: this accepts already-extracted facts as JSON, the
 * same shape the workflow engine's own inline `facts` already takes.
 * It does not parse a receipt image or a mobile app's own submission
 * format — that remains a separate, unbuilt ingestion concern.
 */

interface UpsertExpenseReportBody {
  id?: unknown;
  employeeId?: unknown;
  category?: unknown;
  amount?: unknown;
  currency?: unknown;
  submittedDate?: unknown;
  costCentre?: unknown;
  receiptAttached?: unknown;
  tripEndDate?: unknown;
  intakeChannel?: unknown;
  facts?: unknown;
}

/**
 * Upsert, not insert-only — the same reasoning invoice_headers
 * already gives for its own mutability: an expense report may be
 * corrected, or enriched, over its lifecycle.
 */
export async function handleUpsertExpenseReport(db: D1Database, body: UpsertExpenseReportBody): Promise<RouteResult> {
  const { id, employeeId, category, amount, currency, submittedDate, costCentre, receiptAttached, tripEndDate, intakeChannel, facts } =
    body;
  if (typeof id !== "string" || !id) {
    return { status: 400, body: { error: "id (string) is required" } };
  }
  if (facts !== undefined && (typeof facts !== "object" || facts === null || Array.isArray(facts))) {
    return { status: 400, body: { error: "facts, if provided, must be an object" } };
  }
  if (receiptAttached !== undefined && typeof receiptAttached !== "boolean") {
    return { status: 400, body: { error: "receiptAttached, if provided, must be a boolean" } };
  }

  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM expense_reports WHERE id = ?").bind(id).first();
  const receiptAttachedValue = receiptAttached === undefined ? null : receiptAttached ? 1 : 0;

  const statement = existing
    ? db
        .prepare(
          `UPDATE expense_reports
           SET employee_id = ?, category = ?, amount = ?, currency = ?, submitted_date = ?,
               cost_centre = ?, receipt_attached = ?, trip_end_date = ?, intake_channel = ?,
               facts_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .bind(
          (employeeId as string) ?? null,
          (category as string) ?? null,
          (amount as number) ?? null,
          (currency as string) ?? null,
          (submittedDate as string) ?? null,
          (costCentre as string) ?? null,
          receiptAttachedValue,
          (tripEndDate as string) ?? null,
          (intakeChannel as string) ?? null,
          JSON.stringify(facts ?? {}),
          now,
          id
        )
    : db
        .prepare(
          `INSERT INTO expense_reports
             (id, employee_id, category, amount, currency, submitted_date, cost_centre,
              receipt_attached, trip_end_date, intake_channel, facts_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .bind(
          id,
          (employeeId as string) ?? null,
          (category as string) ?? null,
          (amount as number) ?? null,
          (currency as string) ?? null,
          (submittedDate as string) ?? null,
          (costCentre as string) ?? null,
          receiptAttachedValue,
          (tripEndDate as string) ?? null,
          (intakeChannel as string) ?? null,
          JSON.stringify(facts ?? {}),
          now,
          now
        );

  await statement.run();

  return { status: existing ? 200 : 201, body: { id } };
}
