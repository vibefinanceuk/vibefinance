/**
 * **A search term, read the way a screen shows things — decisions 0693
 * and 0695.** Shared by the Tasks and Documents searches, so a term finds
 * the same thing on both.
 *
 * One bound value carrying three forms of the term, as JSON, so a query
 * adds no numbered placeholders:
 * - `text`: as typed, for LIKE;
 * - `compact`: without spaces, for a VAT number shown as "GB 126 7764 47";
 * - `amount`: the term read as money ("£2,595.31", "2.595,31", "250"), for
 *   matching `printf('%.2f', amount)`, two decimals as screens show it;
 *   null when the term is not an amount.
 *
 * In SQL: `x LIKE json_extract(?n, '$.text') ESCAPE '\\'`. `%`, `_` and `\\`
 * in the term are escaped, never wildcards.
 */
export function searchTerms(search: string | null | undefined): string | null {
  const term = search?.trim();
  if (!term) return null;
  const like = (value: string) => `%${value.replace(/[\\%_]/g, "\\$&")}%`;
  const amount = searchAmount(term);
  return JSON.stringify({
    text: like(term),
    compact: like(term.replace(/\s+/g, "")),
    amount: amount === null ? null : like(amount),
  });
}

/**
 * The search term as an amount with a dot for its decimals ("2595.31"), or
 * null when it is not one. Grouping and currency are dropped; where both a
 * comma and a dot appear, the later one is the decimal mark; a lone comma
 * followed by one or two digits is a decimal comma ("579,84").
 */
export function searchAmount(term: string): string | null {
  const s = term.replace(/^[A-Z]{3}|[A-Z]{3}$/gi, "").replace(/[\s\u00a0£€$¥]/g, "");
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  let n: string;
  if (dot >= 0 && comma >= 0) {
    n = dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  } else if (comma >= 0) {
    n = /,\d{1,2}$/.test(s) && s.split(",").length === 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if ((s.match(/\./g) ?? []).length > 1) {
    n = s.replace(/\./g, "");
  } else {
    n = s;
  }
  return /^\d+(\.\d*)?$/.test(n) ? n.replace(/\.$/, "") : null;
}
