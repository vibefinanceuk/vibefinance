/**
 * Which supplier an arriving invoice is from — decision 0209.
 *
 * **Decision 0204's mechanism with the fields reversed.** That record
 * matched the *buyer* on `BT-49` and `BT-48` to place an invoice in an
 * org; this matches the *seller* on `BT-34` and `BT-31` to attach it to
 * a supplier the ERP already knows.
 *
 * **The point is the ERP identifier**, and the operator said why:
 *
 *   Key to the mirror is having an ERP Identifier. If we do not have
 *   that, it indicates a new supplier record. Otherwise when we pass
 *   the information to the ERP, it will not know who it belongs to.
 *
 * So *matched* does not mean *"we recognise this company"*. It means
 * **"we can name it to the ERP"**, and an invoice without that cannot
 * be paid however well we recognise the name on it.
 */

/** The identifiers, in the order they are trusted. */
const IDENTIFIERS: readonly { fact: string; column: string }[] = [
  /**
   * **`BT-34` first, because it is unambiguous.** An electronic address
   * is issued under a scheme and identifies one party; a VAT number is
   * shared by every site of a company and is written a dozen ways.
   */
  { fact: "BT-34", column: "electronic_address" },
  /**
   * **`BT-31` second, and it is the one real documents carry.** A
   * photographed invoice has the seller's VAT number on it and almost
   * never an electronic address — the same asymmetry decision 0204
   * found on the buyer's side.
   */
  { fact: "BT-31", column: "vat_id" },
];

export interface MatchedSupplier {
  supplierId: string | null;
  /** What a payment instruction must carry. Null when unmatched. */
  erpIdentifier: string | null;
  /** Which identifier matched — `BT-34`, `BT-31`, or null. */
  matchedOn: string | null;
  /**
   * Why no supplier resulted, where none did.
   *
   * **Three reasons needing three different actions**: a document that
   * named nobody, a supplier we have never been told about, and a
   * supplier we know under several sites with no way to choose.
   */
  reason: "no_identifier" | "no_match" | "ambiguous_site" | null;
  /**
   * **When the mirror was last told the truth** — decision 0208.
   *
   * Reported beside an unmatched supplier, because a stale mirror lies
   * confidently: a supplier added to the ERP on Monday and loaded here
   * on Friday means four days of invoices routed for review, each
   * correct according to this system and wrong in fact.
   *
   * *"The supplier list was loaded eleven days ago"* is the fact that
   * tells somebody what to do. Without it, *"unknown supplier"* reads
   * as advice to create one — which, as a mirror, is exactly what we
   * must not suggest.
   */
  listLoadedAt: string | null;
}

export async function matchSupplier(
  db: D1Database,
  facts: Record<string, unknown>
): Promise<MatchedSupplier> {
  const lastLoad = await db
    .prepare("SELECT loaded_at FROM supplier_loads ORDER BY loaded_at DESC LIMIT 1")
    .first<{ loaded_at: string }>();
  const listLoadedAt = lastLoad?.loaded_at ?? null;

  const present = IDENTIFIERS.filter(
    (id) => typeof facts[id.fact] === "string" && (facts[id.fact] as string).trim() !== ""
  );

  if (present.length === 0) {
    return {
      supplierId: null,
      erpIdentifier: null,
      matchedOn: null,
      reason: "no_identifier",
      listLoadedAt,
    };
  }

  for (const identifier of present) {
    const value = (facts[identifier.fact] as string).trim();

    /**
     * **Compared without case or spacing.** A VAT number written
     * `GB 907 856 199` on a document and `GB907856199` in an ERP export
     * is the same number, and neither the supplier nor the person who
     * produced the spreadsheet should have to know what the other used.
     *
     * **Active suppliers only.** A supplier absent from a later load is
     * inactive rather than deleted (decision 0208), and an invoice
     * arriving now belongs to the ERP's current truth — matching a
     * closed supplier would produce a payment instruction the ERP
     * refuses.
     */
    const matches = await db
      .prepare(
        `SELECT id, erp_identifier FROM suppliers
         WHERE status = 'active'
           AND ${identifier.column} IS NOT NULL
           AND upper(replace(${identifier.column}, ' ', '')) = upper(replace(?, ' ', ''))`
      )
      .bind(value)
      .all<{ id: string; erp_identifier: string }>();

    if (matches.results.length === 0) continue;

    if (matches.results.length === 1) {
      const found = matches.results[0];
      return {
        supplierId: found.id,
        erpIdentifier: found.erp_identifier,
        matchedOn: identifier.fact,
        reason: null,
        listLoadedAt,
      };
    }

    /**
     * **Several sites share a VAT number**, which is normal rather than
     * a data fault: Oracle's site is the relationship between our
     * business unit and theirs, and a company has one VAT registration
     * across all of them.
     *
     * Decision 0207 recorded this as harder than the buyer's side, and
     * it is: a supplier with three sites is common, where a buyer with
     * several operating units is a configuration somebody chose.
     *
     * **Reported rather than guessed at.** Picking one would attach an
     * invoice to terms nobody agreed for it.
     */
    return {
      supplierId: null,
      erpIdentifier: null,
      matchedOn: identifier.fact,
      reason: "ambiguous_site",
      listLoadedAt,
    };
  }

  return {
    supplierId: null,
    erpIdentifier: null,
    matchedOn: null,
    reason: "no_match",
    listLoadedAt,
  };
}
