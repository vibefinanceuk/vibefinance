import { compileRule, generateExamples } from "@vibefinance/shared";
import type { VocabularyName } from "@vibefinance/shared";
import { resolveVocabulary } from "@vibefinance/shared";
import { loadCustomFields } from "./custom-field-route.js";
import type { CompilerModel } from "@vibefinance/shared";
import { t } from "./i18n.js";
import type { Locale } from "./i18n.js";

export interface CompileRequestBody {
  ruleSetId?: unknown;
  sourceText?: unknown;
  /** Recompile an existing rule into a new version, rather than
   * creating a brand new one — see docs/decisions/0014-rule-versioning.md.
   * Omitted or absent means "create a new rule", exactly the original
   * behaviour, unchanged. */
  ruleId?: unknown;
}

export interface CompileRouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * The compile route's logic, separated from src/index.ts's fetch()
 * handler specifically so it can be tested with a fake CompilerModel
 * and the real (local) D1 binding — this session has no Cloudflare
 * credentials to call the real AI binding, so the model is always
 * injected here, never constructed internally.
 *
 * `locale` only affects the two static validation messages below —
 * the model's own refusal reason (both for the rule itself and for
 * its worked examples) is deliberately left untranslated. See
 * docs/decisions/0008-locale-aware-messages.md on why that's a
 * different kind of problem than swapping a fixed string.
 */
export async function handleCompileRequest(
  model: CompilerModel,
  compiledBy: string,
  db: D1Database,
  body: CompileRequestBody,
  locale: Locale = "en"
): Promise<CompileRouteResult> {
  const { ruleSetId, sourceText, ruleId: providedRuleId } = body;
  if (typeof ruleSetId !== "string" || !ruleSetId || typeof sourceText !== "string" || !sourceText) {
    return { status: 400, body: { error: t("ruleSetIdSourceTextRequired", locale) } };
  }
  if (providedRuleId !== undefined && (typeof providedRuleId !== "string" || !providedRuleId)) {
    return { status: 400, body: { error: t("ruleIdMustBeString", locale) } };
  }

  const ruleSetExists = await db
    .prepare("SELECT id, vocabulary FROM rule_sets WHERE id = ?")
    .bind(ruleSetId)
    .first<{ id: string; vocabulary: VocabularyName }>();
  if (!ruleSetExists) {
    return { status: 404, body: { error: t("ruleSetDoesNotExist", locale, { ruleSetId }) } };
  }

  // Recompiling an existing rule into a new version, rather than
  // creating a brand new one — see docs/decisions/0014-rule-versioning.md.
  // The rule must already exist and belong to the same rule set;
  // recompiling across rule sets would silently move a rule, which
  // this deliberately refuses rather than allows.
  let ruleId: string;
  let version: number;
  let isNewRule: boolean;

  if (providedRuleId) {
    const existingRule = await db
      .prepare("SELECT id FROM rules WHERE id = ? AND rule_set_id = ?")
      .bind(providedRuleId, ruleSetId)
      .first();
    if (!existingRule) {
      return { status: 404, body: { error: t("ruleDoesNotExistInRuleSet", locale, { ruleId: providedRuleId, ruleSetId }) } };
    }
    const maxVersion = await db
      .prepare("SELECT MAX(version) AS max FROM rule_versions WHERE rule_id = ?")
      .bind(providedRuleId)
      .first<{ max: number | null }>();
    ruleId = providedRuleId;
    version = (maxVersion?.max ?? 0) + 1;
    isNewRule = false;
  } else {
    ruleId = crypto.randomUUID();
    version = 1;
    isNewRule = true;
  }

  // Compiled and validated against the rule set's own recorded
  // vocabulary (decision 0022) — not always "invoice." A rule
  // compiling for an expense rule set sees the expense field
  // vocabulary in its prompt, and anything referencing an invoice
  // field is refused, not silently accepted.
  //
  // Resolved here, at the edge, with the customer's own declared
  // fields merged in (decision 0041). This is the single database
  // read in the custom-field path: everything downstream —
  // compileRule, validateRule, the interpreter — receives a complete
  // vocabulary and never performs a lookup, which is what keeps them
  // synchronous and pure.
  const customFields = await loadCustomFields(db);
  const vocabulary = resolveVocabulary(ruleSetExists.vocabulary, customFields);

  const outcome = await compileRule(model, sourceText, vocabulary);

  // Refusal as a first-class output (Blueprint, "Subsystem one"): a
  // sentence the model can't express in the closed vocabulary is
  // reported back for the person to rephrase, and nothing is stored —
  // never silently approximated, never persisted half-formed. This
  // applies identically whether compiling a new rule or a new version
  // of an existing one — a refused recompile leaves the existing rule
  // and its currently-active version completely untouched.
  if (outcome.kind === "refused") {
    return { status: 422, body: { status: "refused", reason: outcome.reason } };
  }

  const statements = [];
  if (isNewRule) {
    const nextSortOrder = await db
      .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM rules WHERE rule_set_id = ?")
      .bind(ruleSetId)
      .first<{ next: number }>();
    const sortOrder = nextSortOrder?.next ?? 0;
    statements.push(
      db
        .prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
        .bind(ruleId, ruleSetId, sortOrder)
    );
  }

  // Append-only: a new version, always — recompiling an existing rule
  // never updates or deletes a prior version's row, it only ever adds
  // one. approved_by/approved_at are left null — "A person activated
  // this. Never auto-promote a generated rule." (Blueprint,
  // rule_versions). This draft has no effect on invoice evaluation
  // until someone confirms its examples and activates it — see
  // activate-route.ts.
  statements.push(
    db
      .prepare(
        `INSERT INTO rule_versions (rule_id, version, source_text, compiled_json, compiled_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(
        ruleId,
        version,
        sourceText,
        JSON.stringify({ conditions: outcome.conditions, actions: outcome.actions }),
        compiledBy
      )
  );
  await db.batch(statements);

  // Worked examples (Blueprint, build order step 3): a separate model
  // call from the compile above, so a failure here never undoes the
  // rule itself — it's already validly compiled and stored. Without
  // examples, though, activate-route.ts's "at least one example, all
  // confirmed" requirement can never be satisfied, so a rule whose
  // examples failed to generate is stuck as a permanent draft until
  // this is retried (no retry endpoint yet — matches the same
  // raw-DB-access-for-now precedent as rule_sets provisioning).
  const examplesOutcome = await generateExamples(model, outcome.conditions, outcome.actions, vocabulary);
  let examplesSummary: Record<string, unknown>;
  if (examplesOutcome.kind === "generated") {
    const inserts = examplesOutcome.examples.map((example) =>
      db
        .prepare(
          `INSERT INTO rule_examples (id, rule_id, rule_version, invoice_json, expect_match)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(
          crypto.randomUUID(),
          ruleId,
          version,
          JSON.stringify(example.invoice),
          example.expectMatch ? 1 : 0
        )
    );
    await db.batch(inserts);
    examplesSummary = { status: "generated", count: examplesOutcome.examples.length };
  } else {
    examplesSummary = { status: "refused", reason: examplesOutcome.reason };
  }

  return {
    status: 201,
    body: {
      status: "compiled",
      ruleId,
      version,
      // Makes the two cases distinguishable in the response without
      // the caller needing to already know whether they sent ruleId —
      // useful for a UI that wants to say "new rule" vs "new version"
      // without re-deriving it from the request it just made.
      isNewVersionOfExistingRule: !isNewRule,
      ruleSetId,
      conditions: outcome.conditions,
      actions: outcome.actions,
      examples: examplesSummary,
    },
  };
}
