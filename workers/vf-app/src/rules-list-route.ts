import type { RouteResult } from "./examples-route.js";
import { t } from "./i18n.js";
import type { Locale } from "./i18n.js";

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
  name: string | null;
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
      `SELECT r.id, r.rule_set_id, r.enabled, r.sort_order, r.name,
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
        name: r.name,
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
        // **Where a rule can actually go.** A stage with no rule set
        // has nowhere to put one, and a screen offering to write one
        // there would be offering a dead end.
        hasRuleSet: s.rule_set_id !== null,
        ruleSetId: s.rule_set_id,
      })),
    },
  };
}

/**
 * Give a stage somewhere to put rules — decision 0154.
 *
 * **A chicken and egg, found on the screen.** The rules screen offered
 * *"write a new rule"* only where a stage already had a rule set — so
 * rules could only be added where rules already existed, and a stage
 * that had never had one never could.
 *
 * Every rule set until now came from a migration or by hand, which is
 * why nobody had noticed: the operator seeded the ones they needed.
 *
 * **Created on demand rather than up front.** A stage with no rules
 * needs no rule set, and creating one for every stage would leave empty
 * sets nothing references — the shape decision 0060 records about
 * intake channels outliving their purpose.
 */
export async function ensureRuleSetForStage(
  db: D1Database,
  stageId: string
): Promise<{ ruleSetId: string } | { error: string }> {
  const stage = await db
    .prepare("SELECT id, name, rule_set_id FROM process_stages WHERE id = ?")
    .bind(stageId)
    .first<{ id: string; name: string; rule_set_id: string | null }>();

  if (!stage) return { error: `stage ${stageId} does not exist` };
  if (stage.rule_set_id) return { ruleSetId: stage.rule_set_id };

  const ruleSetId = `rs-${stageId}`;

  await db.batch([
    db
      .prepare(
        `INSERT INTO rule_sets (id, name, mode, vocabulary)
         VALUES (?, ?, 'all_matches', 'invoice')`
      )
      // **`all_matches`, not `first_match`.** A stage where several
      // rules apply should apply them all; `first_match` would let the
      // order rules happen to be in decide which ones counted, which is
      // a surprise nobody asked for (decision 0031's two modes).
      .bind(ruleSetId, stage.name),
    db
      .prepare("UPDATE process_stages SET rule_set_id = ? WHERE id = ?")
      .bind(ruleSetId, stageId),
  ]);

  return { ruleSetId };
}

/**
 * Pause a rule, or resume it — decision 0155.
 *
 * **Nothing changed `rules.enabled` before this.** A rule was created
 * enabled and stayed so; the only way to stop one was to delete it,
 * which loses the sentence somebody wrote and every example they
 * confirmed.
 *
 * **Pausing is not unapproving.** The version keeps its approval and
 * its confirmed examples, so resuming needs no second trip through the
 * activation gate (decision 0034) — the gate exists to prove somebody
 * read the rule, and they did.
 *
 * That is why the rules list distinguishes *paused* from *draft*: one
 * was trusted once and the other never has been.
 */
export async function handleSetRuleEnabled(
  db: D1Database,
  ruleId: string,
  enabled: unknown
): Promise<RouteResult> {
  if (typeof enabled !== "boolean") {
    return { status: 400, body: { error: "enabled (true or false) is required" } };
  }

  const rule = await db
    .prepare("SELECT id, enabled FROM rules WHERE id = ?")
    .bind(ruleId)
    .first<{ id: string; enabled: number }>();

  if (!rule) {
    return { status: 404, body: { error: `rule ${ruleId} does not exist` } };
  }

  await db
    .prepare("UPDATE rules SET enabled = ? WHERE id = ?")
    .bind(enabled ? 1 : 0, ruleId)
    .run();

  return { status: 200, body: { ruleId, enabled } };
}

/**
 * One rule, with every version — decision 0155.
 *
 * **The list shows the latest; this shows the history.** Somebody
 * asking *"why did this change"* needs to see that v2 replaced v1 and
 * when, which the list cannot say without becoming a different screen.
 */
export async function handleGetRule(db: D1Database, ruleId: string): Promise<RouteResult> {
  const rule = await db
    .prepare(
      `SELECT r.id, r.rule_set_id, r.enabled, r.name, s.id AS stage_id, s.name AS stage_name
       FROM rules r
       JOIN rule_sets rs ON rs.id = r.rule_set_id
       LEFT JOIN process_stages s ON s.rule_set_id = rs.id
       WHERE r.id = ?`
    )
    .bind(ruleId)
    .first<{
      id: string;
      rule_set_id: string;
      enabled: number;
      name: string | null;
      stage_id: string | null;
      stage_name: string | null;
    }>();

  if (!rule) {
    return { status: 404, body: { error: `rule ${ruleId} does not exist` } };
  }

  const versions = await db
    .prepare(
      `SELECT v.version, v.source_text, v.compiled_json, v.approved_by, v.approved_at,
              v.effective_from, v.effective_to,
              (SELECT count(*) FROM rule_examples e
                 WHERE e.rule_id = v.rule_id AND e.rule_version = v.version) AS examples_total,
              (SELECT count(*) FROM rule_examples e
                 WHERE e.rule_id = v.rule_id AND e.rule_version = v.version
                   AND e.confirmed_by IS NOT NULL) AS examples_confirmed
       FROM rule_versions v WHERE v.rule_id = ? ORDER BY v.version DESC`
    )
    .bind(ruleId)
    .all<{
      version: number;
      source_text: string;
      compiled_json: string;
      approved_by: string | null;
      approved_at: string | null;
      effective_from: string | null;
      effective_to: string | null;
      examples_total: number;
      examples_confirmed: number;
    }>();

  return {
    status: 200,
    body: {
      id: rule.id,
      ruleSetId: rule.rule_set_id,
      name: rule.name,
      enabled: rule.enabled === 1,
      stageId: rule.stage_id,
      stageName: rule.stage_name,
      versions: versions.results.map((v) => ({
        version: v.version,
        sourceText: v.source_text,
        // **The compiled rule, so the screen can read it back.** A
        // person recognises their sentence; the read-back is how they
        // check the system understood it (decision 0153).
        ...(() => {
          try {
            const compiled = JSON.parse(v.compiled_json);
            return { conditions: compiled.conditions, actions: compiled.actions };
          } catch {
            // A version whose JSON will not parse is a version this
            // screen cannot read back, and saying nothing is better
            // than a crash.
            return {};
          }
        })(),
        approvedBy: v.approved_by,
        approvedAt: v.approved_at,
        effectiveFrom: v.effective_from,
        effectiveTo: v.effective_to,
        // **Which version is actually running.** A rule can hold three
        // versions where one is live, and "which" is the first thing
        // anybody asks.
        isLive:
          rule.enabled === 1 && v.approved_at !== null && v.effective_to === null,
        examplesTotal: v.examples_total,
        examplesConfirmed: v.examples_confirmed,
      })),
    },
  };
}

/**
 * A rule's own name, changed without touching its logic — decision
 * 0266.
 *
 * **Deliberately not part of `handleCompileRequest`.** Compiling a new
 * version means a real model call, a fresh worked-examples generation,
 * and a new draft awaiting activation — all of it wasted if somebody
 * only wanted to fix a typo in what a rule is called. Renaming updates
 * one column and nothing else: no version, no re-approval, no effect
 * on what the rule does.
 */
export async function handleRenameRule(
  db: D1Database,
  ruleId: string,
  newName: unknown,
  locale: Locale = "en"
): Promise<RouteResult> {
  if (typeof newName !== "string" || !newName.trim()) {
    return { status: 400, body: { error: t("ruleNameRequired", locale) } };
  }

  const rule = await db.prepare("SELECT id FROM rules WHERE id = ?").bind(ruleId).first();
  if (!rule) {
    return { status: 404, body: { error: t("ruleDoesNotExist", locale, { ruleId }) } };
  }

  await db.prepare("UPDATE rules SET name = ? WHERE id = ?").bind(newName.trim(), ruleId).run();

  return { status: 200, body: { ruleId, name: newName.trim() } };
}
