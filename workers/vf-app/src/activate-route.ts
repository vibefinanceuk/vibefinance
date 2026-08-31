import type { RouteResult } from "./examples-route.js";
import { t } from "./i18n.js";
import type { Locale } from "./i18n.js";

interface VersionRow {
  approved_by: string | null;
}

interface ExampleConfirmationRow {
  confirmed_by: string | null;
}

/**
 * POST /rules/:ruleId/versions/:version/activate — the enforcement
 * point for "A person activated this. Never auto-promote a generated
 * rule" (Blueprint, rule_versions). Requires at least one worked
 * example to exist for this rule version, and every one of them to be
 * confirmed — a rule whose example generation failed (see
 * compile-route.ts's examples.status: "refused" case) has zero
 * examples and can never satisfy this, by construction, not by a
 * special case here.
 *
 * Activating a version also closes any previously-open version of the
 * SAME rule — see docs/decisions/0014-rule-versioning.md. A clean
 * handoff: the old version's effective_to is set to the exact same
 * timestamp as the new version's effective_from, so there is never a
 * gap (a moment with no version in force) or an overlap (two versions
 * simultaneously eligible) at the database level. The old version's
 * row is never altered beyond that — its own history (who approved
 * it, when, and the window it was actually in force) stays intact and
 * queryable, matching the append-only spirit of invoice_runs: any
 * historical evaluation must remain reproducible using the version
 * that was genuinely in force at the time, not today's.
 *
 * `loadActiveRuleSet` (rule-set-loader.ts) already loads activated
 * rules into real evaluation — this closed a scope boundary that used
 * to exist here, in an earlier bundle. Activating a version now
 * really does change what `/rules/evaluate` returns for callers using
 * `ruleSetId`, not just what this database records.
 */
export async function handleActivateRule(
  db: D1Database,
  ruleId: string,
  version: number,
  activatedBy: unknown,
  locale: Locale = "en"
): Promise<RouteResult> {
  if (typeof activatedBy !== "string" || !activatedBy) {
    return { status: 400, body: { error: t("activatedByRequired", locale) } };
  }

  const versionRow = await db
    .prepare("SELECT approved_by FROM rule_versions WHERE rule_id = ? AND version = ?")
    .bind(ruleId, version)
    .first<VersionRow>();
  if (!versionRow) {
    return { status: 404, body: { error: t("ruleVersionDoesNotExist", locale, { ruleId, version }) } };
  }
  if (versionRow.approved_by) {
    return {
      status: 409,
      body: { error: t("alreadyActivated", locale), approvedBy: versionRow.approved_by },
    };
  }

  const examples = await db
    .prepare("SELECT confirmed_by FROM rule_examples WHERE rule_id = ? AND rule_version = ?")
    .bind(ruleId, version)
    .all<ExampleConfirmationRow>();
  if (examples.results.length === 0) {
    return {
      status: 409,
      body: { error: t("cannotActivateNoExamples", locale) },
    };
  }
  const unconfirmedCount = examples.results.filter((e) => !e.confirmed_by).length;
  if (unconfirmedCount > 0) {
    return {
      status: 409,
      body: {
        error: t("cannotActivateUnconfirmed", locale, {
          unconfirmed: unconfirmedCount,
          total: examples.results.length,
        }),
      },
    };
  }

  const now = new Date().toISOString();
  // Order matters here, and is the reason this is two statements in a
  // specific sequence rather than one combined UPDATE: SQLite checks a
  // UNIQUE constraint immediately per statement within a batch, not
  // deferred until the whole batch commits. Activating the new version
  // BEFORE closing the old one would, for one statement's duration,
  // leave both the old and the new version simultaneously matching
  // "approved and still open" — exactly what
  // 0005_rule_versioning_invariant.sql's partial unique index exists to
  // forbid, and it does: that ordering was tried, and this exact
  // scenario failed with a real UNIQUE constraint violation before
  // being corrected to the order below. Close first, then open — at
  // no point during the batch does more than one version match.
  await db.batch([
    db
      .prepare(
        `UPDATE rule_versions SET effective_to = ?
         WHERE rule_id = ? AND version < ? AND approved_by IS NOT NULL AND effective_to IS NULL`
      )
      .bind(now, ruleId, version),
    db
      .prepare(
        "UPDATE rule_versions SET approved_by = ?, approved_at = ?, effective_from = ? WHERE rule_id = ? AND version = ?"
      )
      .bind(activatedBy, now, now, ruleId, version),
  ]);

  return { status: 200, body: { ruleId, version, approvedBy: activatedBy, approvedAt: now, effectiveFrom: now } };
}
