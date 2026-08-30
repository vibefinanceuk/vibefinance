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
 * Scope boundary, stated plainly rather than silently implied:
 * activating a rule version updates rule_versions' approval columns in
 * D1. It does not, on its own, change what /rules/evaluate actually
 * does — that endpoint takes its ruleSet directly from the request
 * body today, not by loading activated rules from this database. See
 * docs/decisions/0007-rule-approval.md.
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
  await db
    .prepare(
      "UPDATE rule_versions SET approved_by = ?, approved_at = ?, effective_from = ? WHERE rule_id = ? AND version = ?"
    )
    .bind(activatedBy, now, now, ruleId, version)
    .run();

  return { status: 200, body: { ruleId, version, approvedBy: activatedBy, approvedAt: now, effectiveFrom: now } };
}
