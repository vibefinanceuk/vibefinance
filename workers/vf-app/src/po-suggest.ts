/**
 * Suggesting a PO line for an invoice line — decision 0534, phase 4 of
 * the PO matching panel.
 *
 * **Scored, not guessed.** Every suggestion comes with the reasons it
 * was made, so a person can check it before accepting. Accepting is an
 * ordinary saved pairing (decision 0532); nothing here pairs a line on
 * its own.
 *
 * The score, 0–100:
 * - **The same item code** (the seller's item identifier, BT-155, or a
 *   standard one, BT-157, equal to the PO line's own) is near-certain:
 *   95 before anything else is weighed.
 * - Otherwise, weighted:
 *   - **description** (60%): how many words the invoice line's name
 *     and description (BT-153, BT-154) share with the PO line's, as a
 *     Dice coefficient;
 *   - **price** (25%): full marks for a unit price within 1% of the
 *     PO's, half within 10%;
 *   - **fits** (10%): the quantity is not more than what is left on the
 *     PO line (decision 0533's consumption);
 *   - **unit** (5%): the same unit code.
 *
 * `SUGGEST_THRESHOLD` is the least score shown.
 */

export const SUGGEST_THRESHOLD = 50;

export type SuggestReason = "itemcode" | "description" | "price" | "fits";

export interface SuggestInvoiceLine {
  name: string | null;
  description: string | null;
  sellerItemId: string | null;
  standardItemId: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
  price: number | null;
}

export interface SuggestPoLine {
  lineNumber: number;
  name: string | null;
  description: string | null;
  sellerItemId: string | null;
  standardItemId: string | null;
  quantity: number | null;
  unit: string | null;
  amount: number | null;
  price: number | null;
  /** What is left of the ordered quantity after other invoices, when known. */
  leftQuantity: number | null;
}

export interface Suggestion {
  poLineNumber: number;
  score: number;
  reasons: SuggestReason[];
}

const STOPWORDS = new Set(["the", "and", "for", "with", "of", "a", "an", "to", "in", "on", "per", "x", "no"]);

/** Lower-case words of two or more letters, a plural "s" dropped, stopwords left out. */
export function words(...texts: (string | null)[]): Set<string> {
  const out = new Set<string>();
  for (const text of texts) {
    for (const raw of String(text ?? "").toLowerCase().split(/[^a-z0-9äöüß]+/)) {
      if (raw.length < 2 || STOPWORDS.has(raw)) continue;
      out.add(raw.length > 3 && raw.endsWith("s") ? raw.slice(0, -1) : raw);
    }
  }
  return out;
}

function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return (2 * shared) / (a.size + b.size);
}

function unitPrice(price: number | null, amount: number | null, quantity: number | null): number | null {
  if (price !== null) return price;
  if (amount !== null && quantity) return amount / quantity;
  return null;
}

function same(a: string | null, b: string | null): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** One invoice line against one PO line. */
export function scorePair(inv: SuggestInvoiceLine, po: SuggestPoLine): Suggestion {
  const reasons: SuggestReason[] = [];
  const itemCode = same(inv.sellerItemId, po.sellerItemId) || same(inv.standardItemId, po.standardItemId);
  if (itemCode) reasons.push("itemcode");

  const description = dice(words(inv.name, inv.description), words(po.name, po.description));
  if (description >= 0.5) reasons.push("description");

  const invPrice = unitPrice(inv.price, inv.amount, inv.quantity);
  const poPrice = unitPrice(po.price, po.amount, po.quantity);
  let price = 0;
  if (invPrice !== null && poPrice) {
    const diff = Math.abs(invPrice - poPrice) / Math.abs(poPrice);
    price = diff <= 0.01 ? 1 : diff <= 0.1 ? 0.5 : 0;
  }
  if (price === 1) reasons.push("price");

  const fits = inv.quantity !== null && po.leftQuantity !== null ? inv.quantity <= po.leftQuantity : false;
  if (fits) reasons.push("fits");
  const unit = same(inv.unit, po.unit) ? 1 : 0;

  const weighed = 0.6 * description + 0.25 * price + 0.1 * (fits ? 1 : 0) + 0.05 * unit;
  const score = Math.round(itemCode ? Math.max(95, weighed * 100) : weighed * 100);
  return { poLineNumber: po.lineNumber, score, reasons };
}

/** The best PO line for an invoice line, or null when none reaches the threshold. */
export function bestSuggestion(inv: SuggestInvoiceLine, poLines: SuggestPoLine[]): Suggestion | null {
  let best: Suggestion | null = null;
  for (const po of poLines) {
    const s = scorePair(inv, po);
    if (!best || s.score > best.score) best = s;
  }
  return best && best.score >= SUGGEST_THRESHOLD ? best : null;
}
