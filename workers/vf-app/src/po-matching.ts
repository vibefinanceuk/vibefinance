import type { InvoiceFacts } from "@vibefinance/shared";

/**
 * Computing po.matched / po.variance_pct and their line-level siblings —
 * decision 0370.
 *
 * **Recomputed at every evaluation, never stored.** Decision 0081 named
 * this tension directly: "at capture it is a fact about the moment, at
 * evaluation it changes as orders arrive." A purchase order can land
 * after the invoice that references it — this is reference data loaded
 * on its own schedule, not something that arrives with the invoice — so
 * a value computed once at capture and never revisited would be wrong
 * for exactly the invoices this feature exists to help: the ones whose
 * order shows up later. Every caller assembling facts for evaluation is
 * expected to call this fresh, the same way mergeStructuredInvoiceFacts
 * already re-derives supplier.* facts rather than trusting a stored
 * copy.
 *
 * **Tolerance is not invented here.** supplier.amountTolerancePct and
 * supplier.quantityTolerancePct already exist (decision 0209) and are
 * already merged onto every invoice's own facts before this runs. This
 * module reads them rather than asking for a new setting — the same
 * "how far before the match fails" the schema's own comment already
 * describes.
 */

interface PurchaseOrderRow {
  id: string;
  payable_amount: number | null;
}

interface PurchaseOrderLineRow {
  line_extension_amount: number | null;
  quantity: number | null;
  unit_code: string | null;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function toText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim() !== "") return value.trim();
  if (typeof value === "number") return String(value);
  return undefined;
}

/** Percentage variance of `actual` from `expected`, undefined if `expected` is 0 or absent. */
function variancePct(actual: number | undefined, expected: number | undefined): number | undefined {
  if (actual === undefined || expected === undefined || expected === 0) return undefined;
  return (Math.abs(actual - expected) / Math.abs(expected)) * 100;
}

export interface PoHeaderMatch {
  matched: boolean;
  variancePct: number | undefined;
}

export interface PoLineMatch {
  matched: boolean;
  variancePct: number | undefined;
  quantityVariancePct: number | undefined;
}

/**
 * Header-level match — decision 0081's original po.matched, finally
 * computed. Joins on BT-13 (the invoice's own purchase order
 * reference) against purchase_orders.order_number.
 *
 * No PO reference, or a referenced PO that does not exist in storage
 * yet, both read as **not matched** — the same state, deliberately.
 * A rule cannot usefully act differently on "no order was ever named"
 * versus "an order was named but has not arrived here yet"; both mean
 * the same thing today: there is nothing to check this invoice
 * against.
 */
export async function computePoMatch(db: D1Database, headerFacts: InvoiceFacts): Promise<PoHeaderMatch> {
  const orderNumber = toText(headerFacts["BT-13"]);
  if (!orderNumber) return { matched: false, variancePct: undefined };

  const order = await db
    .prepare("SELECT id, payable_amount FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<PurchaseOrderRow>();
  if (!order) return { matched: false, variancePct: undefined };

  const invoiceTotal = toNumber(headerFacts["BT-112"]);
  const variance = variancePct(invoiceTotal, order.payable_amount ?? undefined);
  if (variance === undefined) return { matched: false, variancePct: undefined };

  const tolerance = toNumber(headerFacts["supplier.amountTolerancePct"]) ?? 0;
  return { matched: variance <= tolerance, variancePct: variance };
}

/**
 * Line-level match — decision 0370. Joins on BT-13 (which order) and
 * BT-132 (which line of that order), the standard's own mechanism:
 * `InvoiceLine/OrderLineReference/LineID`.
 *
 * **BT-132 absent means not matched, never a positional guess.** The
 * EN 16931 reference guidance is explicit that "order line and invoice
 * line do not always have a one-to-one relation" even when BT-13 is
 * present — falling back to "invoice line N is order line N" would
 * report a match that might not be real, which is worse than reporting
 * none. The same standard applies as po.matched's own header-level
 * absence: refused rather than guessed.
 *
 * **Quantity is checked independently of amount, and its own absence
 * does not fail the line.** A quantity-less line (a service, a flat
 * fee) is not thereby a bad match on price; the two tolerances already
 * exist as separate settings for exactly this reason. A unit mismatch
 * between the two sides (the order says EA, the invoice says BOX) is
 * treated the same way — comparing raw numbers across units would be a
 * meaningless variance, not a real one, so quantity is left out of the
 * verdict rather than reported wrong.
 */
export async function computePoLineMatch(
  db: D1Database,
  headerFacts: InvoiceFacts,
  lineFacts: InvoiceFacts
): Promise<PoLineMatch> {
  const orderNumber = toText(headerFacts["BT-13"]);
  const lineRef = toText(lineFacts["BT-132"]);
  const empty: PoLineMatch = { matched: false, variancePct: undefined, quantityVariancePct: undefined };
  if (!orderNumber || !lineRef) return empty;

  const lineNumber = Number(lineRef);
  if (!Number.isFinite(lineNumber)) return empty;

  const order = await db
    .prepare("SELECT id, payable_amount FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<PurchaseOrderRow>();
  if (!order) return empty;

  const poLine = await db
    .prepare(
      "SELECT line_extension_amount, quantity, unit_code FROM purchase_order_lines WHERE purchase_order_id = ? AND line_number = ?"
    )
    .bind(order.id, lineNumber)
    .first<PurchaseOrderLineRow>();
  if (!poLine) return empty;

  const invoiceLineAmount = toNumber(lineFacts["BT-131"]);
  const amountVariance = variancePct(invoiceLineAmount, poLine.line_extension_amount ?? undefined);
  if (amountVariance === undefined) return empty;

  const amountTolerance = toNumber(headerFacts["supplier.amountTolerancePct"]) ?? 0;
  const amountOk = amountVariance <= amountTolerance;

  // Quantity: independent check, and its own absence never fails the
  // line — see the function's own comment above.
  const invoiceQuantity = toNumber(lineFacts["BT-129"]);
  const invoiceUnit = toText(lineFacts["BT-130"]);
  const poUnit = toText(poLine.unit_code ?? undefined);
  const unitsComparable = !invoiceUnit || !poUnit || invoiceUnit === poUnit;

  let quantityVariance: number | undefined;
  let quantityOk = true;
  if (unitsComparable) {
    quantityVariance = variancePct(invoiceQuantity, poLine.quantity ?? undefined);
    if (quantityVariance !== undefined) {
      const quantityTolerance = toNumber(headerFacts["supplier.quantityTolerancePct"]) ?? 0;
      quantityOk = quantityVariance <= quantityTolerance;
    }
  }

  return { matched: amountOk && quantityOk, variancePct: amountVariance, quantityVariancePct: quantityVariance };
}

/**
 * Merges header-level po.* facts into `headerFacts`, and line-level
 * po.line_* facts into every entry of `lines`, computed fresh against
 * whatever purchase order data exists right now.
 *
 * A single entry point for every caller that assembles facts before
 * evaluation, so the header and line computations can never drift out
 * of sync with each other or be wired into one call site and forgotten
 * in another.
 */
export async function mergePoMatchFacts(
  db: D1Database,
  headerFacts: InvoiceFacts,
  lines: (InvoiceFacts & { lineNumber: number })[]
): Promise<{ headerFacts: InvoiceFacts; lines: (InvoiceFacts & { lineNumber: number })[] }> {
  const header = await computePoMatch(db, headerFacts);
  const mergedHeaderFacts: InvoiceFacts = {
    ...headerFacts,
    "po.matched": header.matched,
    ...(header.variancePct !== undefined ? { "po.variance_pct": header.variancePct } : {}),
  };

  const mergedLines = await Promise.all(
    lines.map(async (line) => {
      const lineMatch = await computePoLineMatch(db, mergedHeaderFacts, line);
      return {
        ...line,
        "po.line_matched": lineMatch.matched,
        ...(lineMatch.variancePct !== undefined ? { "po.line_variance_pct": lineMatch.variancePct } : {}),
        ...(lineMatch.quantityVariancePct !== undefined
          ? { "po.line_quantity_variance_pct": lineMatch.quantityVariancePct }
          : {}),
      };
    })
  );

  return { headerFacts: mergedHeaderFacts, lines: mergedLines };
}
