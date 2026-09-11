/**
 * Which org an arriving invoice belongs to — decision 0204.
 *
 * **Two ways, and a source chooses.** Decision 0036 built one and
 * designed the other:
 *
 * - **A default on the source.** One mailbox per org, and everything
 *   arriving there belongs to it. Built, and how every document is
 *   placed today.
 * - **Read from the document.** One mailbox for everybody, and the
 *   invoice says whose it is. Decision 0036 added the columns —
 *   *"the identifiers an arriving invoice can be matched against"* —
 *   and nothing has ever read them.
 *
 * The operator wants both, chosen per source, with `<Automatic>` as an
 * entry in the same dropdown as the orgs themselves.
 */

/**
 * The identifiers, in the order they are trusted.
 *
 * **`BT-49` first, because Peppol routes on it.** It is the buyer's
 * electronic address and the reason an invoice reached this enterprise
 * at all — decision 0036's own note.
 *
 * **`BT-48` second, and it is the one real documents carry.** A
 * photographed invoice has a VAT number on it and almost never an
 * electronic address, so the strongest identifier is the one least
 * often present.
 *
 * **`BT-10` last.** A buyer's own routing reference is whatever the
 * buyer told the supplier to write, which is useful and not
 * authoritative.
 */
const IDENTIFIERS: readonly { fact: string; column: string }[] = [
  { fact: "BT-49", column: "buyer_endpoint" },
  { fact: "BT-48", column: "vat_id" },
  { fact: "BT-10", column: "buyer_reference" },
];

export interface DerivedOrg {
  /** The operating unit to assign, where one could be resolved. */
  unitId: string | null;
  /** The legal entity the document named, matched or not. */
  entityId: string | null;
  /** Which identifier matched — `BT-49`, `BT-48`, `BT-10`, or null. */
  matchedOn: string | null;
  /**
   * Why no unit resulted, where none did. **A fact about the document
   * rather than a failure**, and the thing somebody needs in order to
   * fix it.
   */
  reason: "no_identifier" | "no_match" | "ambiguous_unit" | "no_operating_unit" | null;
}

/**
 * Read the recipient off the invoice and find whose it is.
 *
 * **The identifiers name a legal entity and an invoice may only be
 * assigned to an operating unit** — decision 0036's standing invariant,
 * *"an operating unit's parent is a legal entity"*, read the other way.
 *
 * So a match on *Acme UK* is not yet an answer. Where that entity has
 * **exactly one** operating unit beneath it, the answer is unambiguous.
 * Where it has several, the document belongs to the entity and to no
 * particular department — **which is a real answer and not a failure**,
 * and is reported rather than guessed at.
 */
export async function deriveOrgUnit(
  db: D1Database,
  facts: Record<string, unknown>
): Promise<DerivedOrg> {
  const present = IDENTIFIERS.filter(
    (id) => typeof facts[id.fact] === "string" && (facts[id.fact] as string).trim() !== ""
  );

  if (present.length === 0) {
    return { unitId: null, entityId: null, matchedOn: null, reason: "no_identifier" };
  }

  for (const identifier of present) {
    const value = (facts[identifier.fact] as string).trim();

    /**
     * **Compared without case or spacing**, because a VAT number
     * written `GB 907 856 199` on a document and `GB907856199` in
     * configuration is the same number, and a person typing either
     * should not have to know which the other used.
     */
    const entity = await db
      .prepare(
        `SELECT id FROM org_units
         WHERE kind = 'legal_entity'
           AND ${identifier.column} IS NOT NULL
           AND upper(replace(${identifier.column}, ' ', '')) = upper(replace(?, ' ', ''))`
      )
      .bind(value)
      .first<{ id: string }>();

    if (!entity) continue;

    const beneath = await db
      .prepare("SELECT id FROM org_units WHERE parent_unit_id = ? AND kind = 'operating_unit'")
      .bind(entity.id)
      .all<{ id: string }>();

    if (beneath.results.length === 1) {
      return {
        unitId: beneath.results[0].id,
        entityId: entity.id,
        matchedOn: identifier.fact,
        reason: null,
      };
    }

    return {
      unitId: null,
      entityId: entity.id,
      matchedOn: identifier.fact,
      /**
       * **Named apart**, because they need different fixes: an entity
       * with no operating unit needs one created, and an entity with
       * several needs somebody to say which — or a rule that does.
       */
      reason: beneath.results.length === 0 ? "no_operating_unit" : "ambiguous_unit",
    };
  }

  return { unitId: null, entityId: null, matchedOn: null, reason: "no_match" };
}

/**
 * Finding one of our own units by hand — decision 0224.
 *
 * **The mirror of decision 0222's supplier search**, and the operator's
 * reason for it: *"sometimes re-routing is needed."*
 *
 * Only **operating units**, because decision 0036's standing invariant
 * says an invoice belongs to one. Offering a legal entity would offer a
 * choice the database refuses.
 */
export async function searchOrgUnits(
  db: D1Database,
  query: string
): Promise<{ status: number; body: unknown }> {
  const q = query.trim();
  if (q.length < 2) return { status: 200, body: { units: [] } };

  const like = `%${q.replace(/[%_]/g, "")}%`;

  const rows = await db
    .prepare(
      `SELECT u.id, u.name, u.kind, p.name AS parent_name, p.vat_id AS parent_vat_id,
              u.vat_id, u.city, u.postal_code
       FROM org_units u
       LEFT JOIN org_units p ON p.id = u.parent_unit_id
       WHERE u.kind = 'operating_unit'
         AND (
           u.name LIKE ?1
           OR u.id LIKE ?1
           OR p.name LIKE ?1
           OR u.vat_id LIKE ?1
           OR p.vat_id LIKE ?1
           OR u.city LIKE ?1
           OR p.city LIKE ?1
         )
       ORDER BY u.name
       LIMIT 25`
    )
    .bind(like)
    .all<Record<string, unknown>>();

  return { status: 200, body: { units: rows.results } };
}

/**
 * Re-routing an invoice to a different unit — decision 0224.
 *
 * **A wrong unit is worse than none.** None stops at the org gate
 * (decision 0037); a wrong one sails through every org-scoped stage
 * after it — decision 0196's rules, decision 0197's fields, decision
 * 0199's permissions, decision 0202's queues — each behaving correctly
 * on the wrong answer.
 *
 * Recorded as `'manual'`, because decision 0036's `org_assigned_by`
 * distinguishes what the source said, what a rule derived, and what a
 * person decided.
 */
export async function setInvoiceOrgUnit(
  db: D1Database,
  invoiceId: string,
  unitId: unknown,
  chosenBy: string
): Promise<{ status: number; body: unknown }> {
  if (typeof unitId !== "string" || !unitId) {
    return { status: 400, body: { error: "unitId (string) is required" } };
  }

  const invoice = await db
    .prepare("SELECT id FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first();
  if (!invoice) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };

  const unit = await db
    .prepare("SELECT id, kind FROM org_units WHERE id = ?")
    .bind(unitId)
    .first<{ id: string; kind: string }>();
  if (!unit) return { status: 404, body: { error: `unit ${unitId} does not exist` } };

  if (unit.kind !== "operating_unit") {
    // Decision 0036's invariant, refused with a reason rather than as a
    // constraint error.
    return {
      status: 409,
      body: {
        error: "an invoice belongs to an operating unit, not to a legal entity",
        reason: "not_an_operating_unit",
      },
    };
  }

  await db
    .prepare(
      `UPDATE invoice_headers
       SET org_unit_id = ?, org_assigned_by = 'manual',
           facts_json = json_remove(
             json_set(facts_json, '$."org.chosenBy"', ?),
             '$."org.unplaced"')
       WHERE id = ?`
    )
    .bind(unitId, chosenBy, invoiceId)
    .run();

  return { status: 200, body: { invoiceId, unitId } };
}
