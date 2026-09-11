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
  /**
   * The company this invoice bills — decision 0226.
   *
   * **The legal entity itself**, not a department beneath it. An
   * invoice bills the company with the tax identifier; which department
   * bears the cost is a line-level question, answered at Coding against
   * `invoice_lines.cost_centre`.
   */
  unitId: string | null;
  /** The same thing, kept for callers that read it. */
  entityId: string | null;
  /** Which identifier matched — `BT-49`, `BT-48`, `BT-10`, or null. */
  matchedOn: string | null;
  /**
   * Why nothing resulted, where nothing did.
   *
   * **Two reasons, where there were four.** `ambiguous_unit` and
   * `no_operating_unit` existed only because a match on a company had
   * to be forced down to a department — decision 0225 called them
   * artefacts, and they are gone rather than fixed.
   */
  reason: "no_identifier" | "no_match" | null;
}

/**
 * Read the recipient off the invoice and find which company it bills.
 *
 * **The identifiers name a legal entity, and a legal entity is the
 * answer** — decision 0226. This used to resolve down to a department
 * and report `ambiguous_unit` where a company had several, which
 * decision 0225 found was a question nobody had asked:
 *
 *   An invoice may be booked to the general ledger across business
 *   units / departments.
 *
 * **So the header names the company and the lines carry the coding.**
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

    /**
     * **The company is the answer** — decision 0226.
     *
     * This used to resolve down to a single operating unit beneath the
     * entity and report `ambiguous_unit` where there were several. **A
     * company with three departments was never ambiguous**: the
     * question is which company bought it, and the document said.
     *
     * Which department bears the cost is a line-level question, and
     * `invoice_lines.cost_centre` has been where it belongs since
     * migration 0007.
     */
    return {
      unitId: entity.id,
      entityId: entity.id,
      matchedOn: identifier.fact,
      reason: null,
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
 * **Companies first, and departments still offered** — decision 0226.
 * An invoice bills a legal entity, so that is what a person is usually
 * choosing; a customer with none configured has operating units and
 * nothing else, and refusing those would leave them unable to choose
 * anything.
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
       WHERE (
           u.name LIKE ?1
           OR u.id LIKE ?1
           OR p.name LIKE ?1
           OR u.vat_id LIKE ?1
           OR p.vat_id LIKE ?1
           OR u.city LIKE ?1
           OR p.city LIKE ?1
         )
       /**
        * **Companies first** — decision 0226. An invoice bills one, and
        * a person choosing by hand is choosing one. An operating unit
        * is still offered, because a customer with no legal entities
        * configured has nothing else.
        */
       ORDER BY CASE u.kind WHEN 'legal_entity' THEN 0 ELSE 1 END, u.name
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

  /**
   * **No guard on the kind** — decision 0226.
   *
   * This refused anything that was not an operating unit, which is
   * migration 0036's invariant and is now inverted: an invoice bills a
   * **company**.
   *
   * And the obvious replacement — refusing anything that is not a legal
   * entity — would be wrong in the same way. **A customer with no legal
   * entities configured has operating units and nothing else**, and an
   * invoice placed on one is placed as well as it can be.
   *
   * So a person may choose either, and the search offers companies
   * first.
   */

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
