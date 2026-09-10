/**
 * Which configuration applies to which unit — decision 0196.
 *
 * **One resolver, and nothing else walks the tree.**
 *
 * Decision 0192 named the risk this file exists to contain: forgetting
 * a unit does not fail. It returns the group's answer — plausible, and
 * quietly wrong. Decision 0001's `resolveTenant` is protected by a lint
 * rule that makes the equivalent mistake uncompilable; this cannot be,
 * because the scope is optional by design and a query omitting it
 * returns valid rows.
 *
 * So the defence is that **there is one walk**, written once, and a
 * route that wants unit-aware configuration calls it rather than
 * joining for itself.
 */

/**
 * The units to consult, most specific first.
 *
 * An operating unit, then the legal entity above it, then that entity's
 * parent, to the top. Decision 0036's invariant is what keeps this
 * short and its shape known: **an operating unit's parent is a legal
 * entity**, so the first step is always out of the department and into
 * the company.
 *
 * The walk stops on a cycle it did not create. A tree is a tree because
 * a migration says so, and decision 0152's lesson is that a guarantee
 * the code makes is not one the data keeps.
 */
export async function unitLineage(
  db: D1Database,
  unitId: string | null
): Promise<string[]> {
  if (!unitId) return [];

  const lineage: string[] = [];
  const seen = new Set<string>();
  let current: string | null = unitId;

  while (current && !seen.has(current)) {
    seen.add(current);
    lineage.push(current);

    const row: { parent_unit_id: string | null } | null = await db
      .prepare("SELECT parent_unit_id FROM org_units WHERE id = ?")
      .bind(current)
      .first();

    if (!row) break;
    current = row.parent_unit_id;
  }

  return lineage;
}

/**
 * Which rule set runs at this stage, for this unit.
 *
 * **The stage's own is the group's answer**, and a unit may override it
 * for that stage alone — so France and Germany share a process and
 * differ on one rule, rather than duplicating seven stages to change
 * one threshold.
 *
 * Resolution is *most specific wins*: an override on the operating unit
 * beats one on its legal entity, which beats the stage's own.
 *
 * **A null unit returns the group's answer**, which is what every
 * caller got before this existed and what a customer with no units
 * configured still gets.
 */
export async function resolveRuleSetForStage(
  db: D1Database,
  stageId: string,
  unitId: string | null
): Promise<string | null> {
  const stage = await db
    .prepare("SELECT rule_set_id FROM process_stages WHERE id = ?")
    .bind(stageId)
    .first<{ rule_set_id: string | null }>();

  if (!stage) return null;

  const lineage = await unitLineage(db, unitId);
  if (lineage.length === 0) return stage.rule_set_id;

  /**
   * One query for the whole lineage, then the most specific match —
   * rather than a query per level, which would be a round trip per
   * ancestor for an answer that is almost always the default.
   */
  const placeholders = lineage.map(() => "?").join(", ");
  const overrides = await db
    .prepare(
      `SELECT unit_id, rule_set_id FROM stage_rule_set_overrides
       WHERE stage_id = ? AND unit_id IN (${placeholders})`
    )
    .bind(stageId, ...lineage)
    .all<{ unit_id: string; rule_set_id: string }>();

  if (overrides.results.length === 0) return stage.rule_set_id;

  // `lineage` is already most-specific-first, so the earliest match is
  // the answer.
  for (const unit of lineage) {
    const match = overrides.results.find((o) => o.unit_id === unit);
    if (match) return match.rule_set_id;
  }

  return stage.rule_set_id;
}

/**
 * Where a stage's rule set came from.
 *
 * **A configuration inherited from two levels up is one nobody can
 * see** — decision 0185 made the argument about approval hierarchies
 * and it is the same here. A screen showing *"Approval: the group's
 * rules"* and *"Approval: Acme France's rules"* is the difference
 * between a setting somebody trusts and one they work around.
 */
export async function explainRuleSetForStage(
  db: D1Database,
  stageId: string,
  unitId: string | null
): Promise<{ ruleSetId: string | null; fromUnitId: string | null; inherited: boolean }> {
  const stage = await db
    .prepare("SELECT rule_set_id FROM process_stages WHERE id = ?")
    .bind(stageId)
    .first<{ rule_set_id: string | null }>();

  if (!stage) return { ruleSetId: null, fromUnitId: null, inherited: false };

  const lineage = await unitLineage(db, unitId);

  for (const unit of lineage) {
    const override = await db
      .prepare(
        "SELECT rule_set_id FROM stage_rule_set_overrides WHERE stage_id = ? AND unit_id = ?"
      )
      .bind(stageId, unit)
      .first<{ rule_set_id: string }>();

    if (override) {
      return {
        ruleSetId: override.rule_set_id,
        fromUnitId: unit,
        // **Inherited** means it came from somewhere above the unit
        // asked about, which is the case a person needs pointing out.
        inherited: unit !== unitId,
      };
    }
  }

  return { ruleSetId: stage.rule_set_id, fromUnitId: null, inherited: lineage.length > 0 };
}
