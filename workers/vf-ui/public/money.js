import { currentLocale } from "/strings.js";

/**
 * **Amounts shown as money — decision 0677.**
 *
 * An invoice's amounts were shown as the bare number stored
 * (`12500.2`). They are now shown in the invoice's own currency, with
 * thousands grouped and two decimals: `£12,500.20` in English and
 * `12.500,20 £` in German. Only what is *shown* changes: what is stored
 * and sent is the same plain number (`12500.2`) whatever the language.
 *
 * The money fields are the EN 16931 amounts the viewer shows. BT-129
 * (quantity) and BT-152 (VAT rate) are numbers, not money, and are left
 * as they are.
 */
export const MONEY_FIELDS = new Set(["BT-106", "BT-109", "BT-110", "BT-112", "BT-115", "BT-131", "BT-146"]);

/** A unit price may carry more than two decimals (EN 16931 allows it); a total never does. */
const MAX_DECIMALS = { "BT-146": 4 };

/** The number format for the language on screen: German `12.500,20`, otherwise UK `12,500.20`. */
export function numberLocale() {
  return currentLocale() === "de" ? "de-DE" : "en-GB";
}

function separators() {
  return numberLocale() === "de-DE" ? { group: ".", decimal: "," } : { group: ",", decimal: "." };
}

/**
 * An amount as money: in `currency` (an ISO 4217 code such as GBP)
 * where the invoice has one, else as a grouped number with two
 * decimals. A value that is not a number is given back as it is, so a
 * mis-keyed value is still seen rather than hidden.
 */
export function formatMoney(value, currency, field) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const digits = { minimumFractionDigits: 2, maximumFractionDigits: MAX_DECIMALS[field] ?? 2 };
  const code = String(currency ?? "").trim().toUpperCase();
  if (/^[A-Z]{3}$/.test(code)) {
    try {
      return new Intl.NumberFormat(numberLocale(), { style: "currency", currency: code, ...digits }).format(n);
    } catch {
      // An unknown code falls through to a plain grouped number.
    }
  }
  return new Intl.NumberFormat(numberLocale(), digits).format(n);
}

/** The amount as somebody edits it: no currency, no grouping, the language's own decimal mark (`12500.20` / `12500,20`). */
export function plainAmount(value) {
  if (value === null || value === undefined || String(value).trim() === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toFixed(2).replace(".", separators().decimal);
}

/**
 * What somebody typed (or what a field shows), back to the stored plain
 * number as text (`"12500.2"`); `""` for nothing, and the text itself
 * when it is not a number, so the check still sees it.
 *
 * Read in the language on screen: in German `12.500,20` is twelve
 * thousand five hundred. **One allowance:** a single mark followed by
 * one, two or four digits can only be a decimal mark, whichever it is —
 * so `12500.20` typed on a German screen, or `12500,20` on an English
 * one, is still 12500.20. Three digits after a single mark (`1.234`)
 * follows the language: a thousands separator in German, a decimal in
 * English.
 */
export function parseAmount(text) {
  const raw = String(text ?? "").trim();
  if (raw === "") return "";
  const negative = /^-|^\(.*\)$|-\s*$/.test(raw);
  let s = raw.replace(/[^\d.,]/g, "");
  if (s === "") return raw;
  const { group, decimal } = separators();
  const marks = s.replace(/\d/g, "");
  if (marks.length === 1) {
    const after = s.length - s.search(/[.,]/) - 1;
    if (after !== 3) s = s.replace(/[.,]/, "."); // can only be a decimal mark
    else s = marks === decimal ? s.replace(decimal, ".") : s.replace(group, "");
  } else {
    s = s.split(group).join("").replace(decimal, ".");
  }
  if (!/^\d*\.?\d*$/.test(s) || s === ".") return raw;
  const n = Number(s);
  return Number.isFinite(n) ? String(negative ? -n : n) : raw;
}

/**
 * An editable amount: shows the money (`£12,500.20`) until it is
 * clicked into, then the plain amount to type over (`12500.20`), and
 * the money again when it is left. Its `value` is therefore read with
 * `parseAmount()`, never `Number()`.
 */
export function moneyInput(el, { id, value, currency, field }) {
  const input = el("input", { type: "text", inputmode: "decimal", class: "moneyinput", ...(id ? { id } : {}), "data-money": field });
  input.value = formatMoney(value, currency, field);
  input.addEventListener("focus", () => {
    const stored = parseAmount(input.value);
    input.value = stored === "" || !Number.isFinite(Number(stored)) ? input.value : plainAmount(stored);
  });
  input.addEventListener("blur", () => {
    const stored = parseAmount(input.value);
    if (stored !== "" && Number.isFinite(Number(stored))) input.value = formatMoney(stored, currency, field);
  });
  return input;
}
