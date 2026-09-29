import type { InvoiceFacts } from "@vibefinance/shared";
import { computePoLineMatch, getOrgMatchingConfig, loadPoConsumption } from "./po-matching.js";
import { activePairings, loadPairings } from "./po-pairings.js";
import { lineUse, loadInvoice } from "./po-match-panel-route.js";

/**
 * How each invoice line matches its PO line, for the viewer's **Match
 * column** — decision 0536.
 *
 * The operator's own words, after trying the suggestions on a live
 * invoice: "once matched, the line items at the bottom do not indicate
 * that the matching has taken place." Agreed: a chip in its own column
 * headed **Match**, hover text for the colours, and a pop-out for the
 * line, read-only outside the Matching stage ("If changes are needed,
 * the user can 'Return' to matching later in the process").
 *
 * **Part of reading the invoice, so it rides on `GET /invoices/:id`**:
 * anyone who can open the invoice (an approver included) sees its lines'
 * match without a permission of their own. It says nothing the invoice
 * itself does not already imply: the PO its own BT-13 names, and that
 * PO's own lines.
 *
 * **The same answer the rules give.** Saved pairings (0532) and what
 * other invoices have taken (0533) are applied exactly as at evaluation,
 * and each verdict is `computePoLineMatch`'s own.
 *
 * `null` for an invoice that names no PO: a non-PO invoice has no Match
 * column at all.
 */

/** `nonpo` — decision 0537: marked at Matching as not on the order, and coded by hand. */
export type LineMatchState = "matched" | "over" | "unit" | "nopoline" | "nonpo";

export interface LineMatchSummary {
  orderNumber: string;
  /** False when BT-13 names a PO not held here. */
  held: boolean;
  /**
   * Decision 0545 — the PO's own status (active, on_hold, closed) and why
   * it is on hold. The line chips still say how each line compares; the
   * pop-out warns that the invoice is not matched while the PO is not
   * active.
   */
  poStatus: string | null;
  holdReason: string | null;
  lines: {
    lineNumber: number;
    state: LineMatchState;
    supplierReference: string | null;
    poLine: {
      lineNumber: number;
      name: string | null;
      quantity: number | null;
      unit: string | null;
      price: number | null;
      amount: number | null;
    } | null;
    use: {
      orderedQuantity: number | null;
      orderedAmount: number | null;
      beforeQuantity: number;
      beforeAmount: number;
      thisQuantity: number;
      thisAmount: number;
      leftQuantity: number | null;
      leftAmount: number | null;
    } | null;
    /** The panel's own verdict shape, so both say it in the same words. */
    result: {
      matched: boolean;
      referenceFound: boolean;
      priceMatched: boolean | null;
      quantityMatched: boolean | null;
      unitMismatch: boolean;
      variancePct: number | null;
      quantityVariancePct: number | null;
    };
    pairing: { source: "manual" | "suggestion"; kind: "po_line" | "non_po"; pairedByName: string | null; pairedAt: string } | null;
  }[];
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function text(v: unknown): string | null {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number") return String(v);
  return null;
}

export async function lineMatchSummary(
  db: D1Database,
  invoiceId: string,
  facts: InvoiceFacts
): Promise<LineMatchSummary | null> {
  const orderNumber = text(facts["BT-13"]);
  if (!orderNumber) return null;

  const po = await db
    .prepare("SELECT id, status, hold_reason FROM purchase_orders WHERE order_number = ?")
    .bind(orderNumber)
    .first<{ id: string; status: string; hold_reason: string | null }>();
  const invoiceLines = (
    await db
      .prepare("SELECT line_number, facts_json FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
      .bind(invoiceId)
      .all<{ line_number: number; facts_json: string | null }>()
  ).results;

  if (!po) {
    return {
      orderNumber,
      held: false,
      poStatus: null,
      holdReason: null,
      lines: invoiceLines.map((l) => ({
        lineNumber: l.line_number,
        state: "nopoline",
        supplierReference: text((JSON.parse(l.facts_json || "{}") as InvoiceFacts)["BT-132"]),
        poLine: null,
        use: null,
        result: {
          matched: false,
          referenceFound: false,
          priceMatched: null,
          quantityMatched: null,
          unitMismatch: false,
          variancePct: null,
          quantityVariancePct: null,
        },
        pairing: null,
      })),
    };
  }

  const poLines = (
    await db
      .prepare(
        `SELECT line_number, item_name, item_description, quantity, unit_code, price_amount, line_extension_amount
         FROM purchase_order_lines WHERE purchase_order_id = ?`
      )
      .bind(po.id)
      .all<{
        line_number: number;
        item_name: string | null;
        item_description: string | null;
        quantity: number | null;
        unit_code: string | null;
        price_amount: number | null;
        line_extension_amount: number | null;
      }>()
  ).results;

  // Supplier tolerances, read exactly as the panel and evaluation read them.
  const invoice = await loadInvoice(db, invoiceId);
  const headerFacts = invoice?.headerFacts ?? facts;

  const orgConfig = await getOrgMatchingConfig(db);
  const consumption = await loadPoConsumption(db, orderNumber, invoiceId);
  const pairings = activePairings(await loadPairings(db, invoiceId), facts);

  const parsed = invoiceLines.map((l) => {
    const stored = JSON.parse(l.facts_json || "{}") as InvoiceFacts;
    const pairing = pairings.get(l.line_number) ?? null;
    const effective =
      pairing?.kind === "non_po"
        ? (Object.fromEntries(Object.entries(stored).filter(([k]) => k !== "BT-132")) as InvoiceFacts)
        : pairing
          ? ({ ...stored, "BT-132": String(pairing.poLineNumber) } as InvoiceFacts)
          : stored;
    return { l, stored, pairing, effective, ref: num(text(effective["BT-132"])) };
  });

  // What this invoice takes from each PO line, by the reference in force.
  const thisByLine = new Map<number, { quantity: number; amount: number }>();
  for (const p of parsed) {
    if (p.ref === null) continue;
    const t = thisByLine.get(p.ref) ?? { quantity: 0, amount: 0 };
    t.quantity += num(p.stored["BT-129"]) ?? 0;
    t.amount += num(p.stored["BT-131"]) ?? 0;
    thisByLine.set(p.ref, t);
  }

  const lines = await Promise.all(
    parsed.map(async ({ l, stored, pairing, effective, ref }) => {
      const match = await computePoLineMatch(db, headerFacts, effective, orgConfig, consumption);
      const poLine = ref === null ? undefined : poLines.find((p) => p.line_number === ref);
      const state: LineMatchState = pairing?.kind === "non_po"
        ? "nonpo"
        : !match.referenceFound || !poLine
        ? "nopoline"
        : match.matched
          ? "matched"
          : match.unitMismatch
            ? "unit"
            : "over";
      return {
        lineNumber: l.line_number,
        state,
        supplierReference: text(stored["BT-132"]),
        poLine: poLine
          ? {
              lineNumber: poLine.line_number,
              name: poLine.item_name ?? poLine.item_description,
              quantity: poLine.quantity,
              unit: poLine.unit_code,
              price: poLine.price_amount,
              amount: poLine.line_extension_amount,
            }
          : null,
        use: poLine ? lineUse(poLine, consumption, thisByLine.get(poLine.line_number)) : null,
        result: {
          matched: match.matched,
          referenceFound: match.referenceFound,
          priceMatched: match.priceMatched ?? null,
          quantityMatched: match.quantityMatched ?? null,
          unitMismatch: match.unitMismatch,
          variancePct: match.variancePct ?? null,
          quantityVariancePct: match.quantityVariancePct ?? null,
        },
        pairing: pairing
          ? { source: pairing.source, kind: pairing.kind, pairedByName: pairing.pairedByName, pairedAt: pairing.pairedAt }
          : null,
      };
    })
  );

  return {
    orderNumber,
    held: true,
    poStatus: po.status,
    holdReason: po.status === "on_hold" ? po.hold_reason : null,
    lines,
  };
}
