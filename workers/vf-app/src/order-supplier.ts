/** A VAT number without its country prefix, spaces or dots — as credit notes match a supplier (0731). */
export const bareVat = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^[A-Z]{2}(?=\d)/, "");
/** The same in SQL: spaces, dots and (decision 0756) hyphens dropped, and the country prefix where one leads the digits. */
export const BARE_SQL = (col: string) => {
  const clean = `upper(replace(replace(replace(${col}, ' ', ''), '.', ''), '-', ''))`;
  return `(CASE WHEN ${clean} GLOB '[A-Z][A-Z][0-9]*' THEN substr(${clean}, 3) ELSE ${clean} END)`;
};


/**
 * **An order's supplier, however its seller is written — decision 0756.**
 * A purchase order names its seller by `seller_party_id`: the supplier's
 * VAT number as the customer's procurement system writes it ("DE123456789",
 * "DE 123 456 789", "123456789"), or the supplier's ERP number. Matched
 * exactly, a supplier kept as "DE 123 456 789" was no order's supplier: a
 * three-way supplier's orders were treated as two-way, and the order's
 * supplier was blank on the GRNI report, in receipt emails, Conversations,
 * agents' answers, Documents and the PO match panel.
 *
 * The VAT number with spaces, dots and hyphens dropped — and its country
 * prefix too where only one side writes one, so "123456789" is
 * "DE123456789", but "GB1" is never "DE1"; or the ERP number, exactly. An
 * active supplier first, then by name, where more than one answers.
 */

/** A VAT number with spaces, dots and hyphens dropped, upper case: its country prefix kept. */
const CLEAN_SQL = (col: string) => `upper(replace(replace(replace(${col}, ' ', ''), '.', ''), '-', ''))`;
const HAS_PREFIX_SQL = (col: string) => `(${CLEAN_SQL(col)} GLOB '[A-Z][A-Z][0-9]*')`;

/**
 * SQL: whether two VAT numbers are the same number. Written the same once
 * cleaned; or, where only one carries its country prefix, the same
 * without it. Two numbers that both name their country must name the same
 * one: GB1 is not DE1.
 */
export const SAME_VAT_SQL = (a: string, b: string) =>
  `(${a} IS NOT NULL AND ${b} IS NOT NULL AND (${CLEAN_SQL(a)} = ${CLEAN_SQL(b)} OR (NOT (${HAS_PREFIX_SQL(a)} AND ${HAS_PREFIX_SQL(b)}) AND ${BARE_SQL(a)} = ${BARE_SQL(b)})))`;

/** SQL: whether supplier `s` is the seller `seller` (a column or expression) names. */
export const SUPPLIER_IS_SELLER = (s: string, seller: string) =>
  `(${SAME_VAT_SQL(`${s}.vat_id`, seller)} OR (${s}.erp_identifier IS NOT NULL AND ${s}.erp_identifier = ${seller}))`;

/** SQL: one of the order's supplier's columns, for seller `seller`; null where no supplier answers. */
export const ORDER_SUPPLIER_SQL = (column: string, seller: string, alias = "osx") =>
  `(SELECT ${alias}.${column} FROM suppliers ${alias} WHERE ${SUPPLIER_IS_SELLER(alias, seller)} ORDER BY ${alias}.status = 'active' DESC, ${alias}.name LIMIT 1)`;

/** SQL: the order's supplier's id, to join on (`LEFT JOIN suppliers x ON x.id = ORDER_SUPPLIER_ID(...)`). */
export const ORDER_SUPPLIER_ID = (seller: string, alias = "osx") => ORDER_SUPPLIER_SQL("id", seller, alias);

/** Whether two VAT numbers are the same number, however written — as `SAME_VAT_SQL`. */
export function sameVat(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const clean = (v: string) => v.toUpperCase().replace(/[\s.\-]/g, "");
  const prefixed = (v: string) => /^[A-Z]{2}\d/.test(clean(v));
  if (clean(a) !== "" && clean(a) === clean(b)) return true;
  if (prefixed(a) && prefixed(b)) return false;
  const x = bareVat(a);
  return x !== "" && x === bareVat(b);
}
