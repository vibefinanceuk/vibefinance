import type { InvoiceFacts } from "@vibefinance/shared";

/**
 * Saved line pairings — decision 0532, phase 2 of the PO matching panel.
 *
 * A person can pair an invoice line with a PO line by hand in the panel.
 * The pairing is stored in `invoice_line_po_pairings` (migration 0094),
 * never written over the supplier's own BT-132, and applied here, at
 * evaluation, as that line's order line reference. So everything that
 * matches a line against its PO line (`computePoLineMatch`) sees the
 * person's choice without knowing a pairing exists.
 *
 * **Only while the invoice still names the PO the pairing was made
 * against.** A re-link to another PO (0530) leaves the pairing stored
 * but inert; linking back brings it back.
 *
 * Called before `mergePoMatchFacts` by every path that knows which
 * invoice it is evaluating: `loadLiveInvoiceFacts` (every re-evaluation
 * after a task completes, and the 0487 re-check), the invoice read path
 * (`handleGetInvoice`), the stage-visit route, and the panel itself.
 * Intake needs none: a new invoice has no pairings.
 */

export interface SavedPairing {
  lineNumber: number;
  orderNumber: string;
  poLineNumber: number;
  pairedBy: string;
  pairedByName: string | null;
  pairedAt: string;
}

export async function loadPairings(db: D1Database, invoiceId: string): Promise<SavedPairing[]> {
  const rows = await db
    .prepare(
      `SELECT p.line_number, p.order_number, p.po_line_number, p.paired_by, u.name AS paired_by_name, p.paired_at
       FROM invoice_line_po_pairings p LEFT JOIN org_users u ON u.id = p.paired_by
       WHERE p.invoice_id = ?`
    )
    .bind(invoiceId)
    .all<{
      line_number: number;
      order_number: string;
      po_line_number: number;
      paired_by: string;
      paired_by_name: string | null;
      paired_at: string;
    }>();
  return rows.results.map((r) => ({
    lineNumber: r.line_number,
    orderNumber: r.order_number,
    poLineNumber: r.po_line_number,
    pairedBy: r.paired_by,
    pairedByName: r.paired_by_name,
    pairedAt: r.paired_at,
  }));
}

/** The pairings that apply to this invoice right now: those made against the PO its BT-13 names. */
export function activePairings(pairings: SavedPairing[], headerFacts: InvoiceFacts): Map<number, SavedPairing> {
  const bt13 = headerFacts["BT-13"];
  const orderNumber = typeof bt13 === "string" ? bt13.trim() : typeof bt13 === "number" ? String(bt13) : "";
  return new Map(pairings.filter((p) => orderNumber !== "" && p.orderNumber === orderNumber).map((p) => [p.lineNumber, p]));
}

/**
 * Each paired line's facts with BT-132 set to the paired PO line.
 * Returns new objects; the stored facts are never touched.
 */
export async function applySavedPairings<L extends InvoiceFacts & { lineNumber: number }>(
  db: D1Database,
  invoiceId: string,
  headerFacts: InvoiceFacts,
  lines: L[]
): Promise<L[]> {
  if (lines.length === 0) return lines;
  const active = activePairings(await loadPairings(db, invoiceId), headerFacts);
  if (active.size === 0) return lines;
  return lines.map((line) => {
    const pairing = active.get(line.lineNumber);
    return pairing ? ({ ...line, "BT-132": String(pairing.poLineNumber) } as L) : line;
  });
}
