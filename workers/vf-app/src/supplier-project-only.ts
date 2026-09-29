/**
 * **Project-only expenditure — decision 0547.** A supplier site whose
 * spend is always charged to a project: its invoices' coded lines need a
 * project before a coding task completes, and under "one or the other"
 * (0540) they are coded to a project, never a cost centre.
 *
 * **Read live, never frozen into the invoice's facts.** The setting is
 * VibeFinance's own and changes by hand, so an invoice captured before
 * it was switched on is judged by what it says now, the same choice
 * decision 0422 made for a supplier's hold.
 *
 * `null` when the invoice has no supplier attached (or the column is not
 * there yet): nothing is imposed.
 */
export async function supplierProjectOnly(db: D1Database, invoiceId: string): Promise<boolean | null> {
  try {
    const row = await db
      .prepare(
        `SELECT s.project_only FROM invoice_headers h JOIN suppliers s ON s.id = h.supplier_id WHERE h.id = ?`
      )
      .bind(invoiceId)
      .first<{ project_only: number }>();
    return row ? row.project_only === 1 : null;
  } catch {
    // Before migration 0101: no setting, nothing imposed.
    return null;
  }
}
