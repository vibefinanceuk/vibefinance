import type { RouteResult } from "./examples-route.js";

/**
 * The rules that exist, by stage — decision 0149.
 *
 * **No route listed rules.** Compiling, confirming and activating all
 * have one; seeing what is already running does not — the same gap
 * decision 0128 found with processes, where somebody could create one
 * and never see it.
 *
 * Organised by **stage**, because that is how the question arrives.
 * Nobody asks *"what rules exist"*; they ask *"why did this invoice get
 * held"*, and the answer is found at the stage it was held at.
 */

interface RuleRow {
  id: string;
  rule_set_id: string;
  enabled: number;
  sort_order: number;
  stage_id: string | null;
  stage_name: string | null;
  sequence: number | null;
  version: number | null;
  source_text: string | null;
  approved_by: string | null;
  approved_at: string | null;
  examples_total: number;
  examples_confirmed: number;
}

/**
 * What state a rule is in, from a person's point of view.
 *
 * **Four words, not four columns.** The database records `enabled`,
 * `approved_at`, an effective window and a count of confirmed
 * examples; a person wants to know whether it is running.
 */
function stateOf(row: RuleRow): "live" | "paused" | "awaiting_confirmation" | "draft" {
  // Approved and switched on is the only state that acts on an invoice.
  if (row.approved_at && row.enabled === 1) return "live";

  // Approved and switched off: it did run, and somebody stopped it.
  // Distinguished from a draft because the difference matters — one was
  // trusted once and the other never has been.
  if (row.approved_at) return "paused";

  // Compiled, with examples waiting to be read. The activation gate
  // (decision 0034) is what stands between here and live.
  if (row.examples_total > 0) return "awaiting_confirmation";

  return "draft";
}

export async function handleListRules(
  db: D1Database,
  stageId: string | null
): Promise<RouteResult> {
  /**
   * The latest version of each rule, and how far its examples have got.
   *
   * A rule can have several versions (decision 0014); the one worth
   * showing is the newest, because that is what a person is working on
   * or what is running.
   */
  const rows = await db
    .prepare(
      `SELECT r.id, r.rule_set_id, r.enabled, r.sort_order,
              s.id AS stage_id, s.name AS stage_name, s.sequence,
              v.version, v.source_text, v.approved_by, v.approved_at,
              (SELECT count(*) FROM rule_examples e
                 WHERE e.rule_id = r.id AND e.rule_version = v.version) AS examples_total,
              (SELECT count(*) FROM rule_examples e
                 WHERE e.rule_id = r.id AND e.rule_version = v.version
                   AND e.confirmed_by IS NOT NULL) AS examples_confirmed
       FROM rules r
       JOIN rule_sets rs ON rs.id = r.rule_set_id
       LEFT JOIN process_stages s ON s.rule_set_id = rs.id
       LEFT JOIN rule_versions v ON v.rule_id = r.id
         AND v.version = (SELECT MAX(v2.version) FROM rule_versions v2 WHERE v2.rule_id = r.id)
       ${stageId ? "WHERE s.id = ?" : ""}
       ORDER BY s.sequence, r.sort_order`
    )
    .bind(...(stageId ? [stageId] : []))
    .all<RuleRow>();

  return {
    status: 200,
    body: {
      rules: rows.results.map((r) => ({
        id: r.id,
        ruleSetId: r.rule_set_id,
        // **The sentence somebody wrote**, not the compiled JSON. A
        // person recognises their own words; nobody recognises
        // `{"field":"BT-112","operator":"greater_than"}`.
        sourceText: r.source_text,
        version: r.version,
        stageId: r.stage_id,
        stageName: r.stage_name,
        state: stateOf(r),
        // Only where it means something: how many examples are still
        // waiting, so the list can say "2 to confirm" rather than
        // making somebody open the rule to find out.
        ...(stateOf(r) === "awaiting_confirmation"
          ? { awaiting: r.examples_total - r.examples_confirmed }
          : {}),
        approvedBy: r.approved_by,
        approvedAt: r.approved_at,
      })),
    },
  };
}

/**
 * Every stage, with how many rules run there — decision 0149.
 *
 * **A stage with no rules is worth showing**, not hiding. Somebody
 * wondering why nothing happens at Coding needs to see that Coding is
 * empty, which an omitted row cannot tell them.
 */
export async function handleRuleStages(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT s.id, s.name, s.sequence, s.rule_set_id,
              (SELECT count(*) FROM rules r WHERE r.rule_set_id = s.rule_set_id) AS rule_count
       FROM process_stages s
       ORDER BY s.sequence`
    )
    .all<{
      id: string;
      name: string;
      sequence: number;
      rule_set_id: string | null;
      rule_count: number;
    }>();

  return {
    status: 200,
    body: {
      stages: rows.results.map((s) => ({
        id: s.id,
        name: s.name,
        sequence: s.sequence,
        // **The sequence is the point** (the operator's own): a rule
        // fires at a stage, and what a rule can test depends on what
        // has happened to the document by then.
        ruleCount: s.rule_count,
        hasRuleSet: s.rule_set_id !== null,
      })),
    },
  };
}
