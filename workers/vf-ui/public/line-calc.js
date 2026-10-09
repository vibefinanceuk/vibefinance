/**
 * **What a line's net amount should be — decision 0708.**
 *
 * Dan, 9 October 2026, working INV-16356: *"The line net amount is not
 * displayed, only the line total amount inclusive of vat. This means the user
 * needs to manually calculate…"* (it turned out that invoice's amounts were
 * already net; the VAT column beside them is the rate). Agreed: **suggest** the
 * net amount, never fill it silently, and recognise a VAT-inclusive figure.
 *
 * The line net amount (BT-131) is what the document prints; quantity × unit
 * price is a check on it, not a replacement, since discounts, charges and
 * per-pack prices make the two differ on real invoices (EN 16931 BR-24 takes
 * the printed amount). So this only ever offers.
 */

const round2 = (n) => Math.round(n * 100) / 100;

function num(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * What to offer for `line`'s net amount, or null when there is nothing to say:
 *
 * - `{ kind: "calc", amount, qty, price }`: quantity × unit price (divided by
 *   the price's base quantity, BT-149, where given), when the net amount is
 *   empty, or differs (`mismatch: true`);
 * - `{ kind: "gross", amount, rate }`: the net amount entered is quantity ×
 *   price **plus VAT** at the line's rate (BT-152), so it was a VAT-inclusive
 *   figure; `amount` is the net.
 */
export function lineNetSuggestion(line) {
  const qty = num(line?.["BT-129"]);
  const price = num(line?.["BT-146"]);
  if (qty === null || price === null) return null;
  const base = num(line?.["BT-149"]) || 1;
  const amount = round2((qty * price) / base);
  const current = num(line?.["BT-131"]);
  if (current === null) return { kind: "calc", amount, qty, price };
  if (Math.abs(current - amount) < 0.005) return null;
  const rate = num(line?.["BT-152"]);
  if (rate !== null && rate > 0 && Math.abs(current - round2(amount * (1 + rate / 100))) < 0.015) {
    return { kind: "gross", amount, rate };
  }
  return { kind: "calc", amount, qty, price, mismatch: true };
}
