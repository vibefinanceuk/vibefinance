import type { CompiledRule, CompiledRuleSet, RuleAction, RuleNode } from "@vibefinance/shared";

interface RuleSetRow {
  id: string;
  mode: "first_match" | "all_matches";
}

interface ActiveRuleRow {
  rule_id: string;
  version: number;
  compiled_json: string;
}

/**
 * Loads a rule set from D1, filtered to exactly the rules that should
 * actually govern evaluation right now — the piece
 * docs/decisions/0007-rule-approval.md's scope boundary left open:
 * "activated rules... don't yet change what /rules/evaluate does."
 *
 * A rule's version counts as currently effective only if all of:
 * - the rule itself is enabled (`rules.enabled = 1`)
 * - that version has been activated (`rule_versions.approved_by IS NOT NULL`
 *   — see activate-route.ts; a rule can never reach this state without
 *   every one of its worked examples having been confirmed first)
 * - `now` falls within its effective window
 *   (`effective_from <= now`, and `effective_to` is either unset or
 *   still in the future)
 *
 * `rules.sort_order` governs evaluation order, same as
 * evaluateRuleSet already assumes for an inline ruleSet.
 *
 * Multi-version selection: exercised by real data as of decision
 * 0014-rule-versioning.md — activate-route.ts now closes a rule's
 * previously-open version when a new one activates, so under normal
 * operation exactly one row ever matches. If a rule somehow has more
 * than one row matching every condition above — written defensively
 * for that case — the highest version number wins, on the theory that
 * a later version is the more recent authorial intent. As of
 * migrations/0005_rule_versioning_invariant.sql, this scenario is
 * additionally refused at the database layer by a partial unique
 * index (confirmed: even a direct INSERT bypassing all application
 * code cannot construct it) — this tiebreak logic is defense-in-depth
 * for a database that predates that migration or one where the
 * constraint has somehow been dropped, not a path expected to run in
 * normal operation.
 */
export async function loadActiveRuleSet(
  db: D1Database,
  ruleSetId: string,
  now: Date = new Date()
): Promise<CompiledRuleSet | null> {
  const ruleSetRow = await db
    .prepare("SELECT id, mode FROM rule_sets WHERE id = ?")
    .bind(ruleSetId)
    .first<RuleSetRow>();
  if (!ruleSetRow) return null;

  const nowIso = now.toISOString();
  const rows = await db
    .prepare(
      `SELECT r.id AS rule_id, rv.version AS version, rv.compiled_json AS compiled_json
       FROM rules r
       JOIN rule_versions rv ON rv.rule_id = r.id
       WHERE r.rule_set_id = ?
         AND r.enabled = 1
         AND rv.approved_by IS NOT NULL
         AND rv.effective_from IS NOT NULL
         AND rv.effective_from <= ?
         AND (rv.effective_to IS NULL OR rv.effective_to > ?)
         AND rv.version = (
           SELECT MAX(rv2.version) FROM rule_versions rv2
           WHERE rv2.rule_id = r.id
             AND rv2.approved_by IS NOT NULL
             AND rv2.effective_from IS NOT NULL
             AND rv2.effective_from <= ?
             AND (rv2.effective_to IS NULL OR rv2.effective_to > ?)
         )
       ORDER BY r.sort_order ASC`
    )
    .bind(ruleSetId, nowIso, nowIso, nowIso, nowIso)
    .all<ActiveRuleRow>();

  const rules: CompiledRule[] = rows.results.map((row) => {
    const parsed = JSON.parse(row.compiled_json) as { conditions: RuleNode; actions: RuleAction[] };
    return { id: row.rule_id, version: row.version, conditions: parsed.conditions, actions: parsed.actions };
  });

  return { id: ruleSetRow.id, mode: ruleSetRow.mode, rules };
}
