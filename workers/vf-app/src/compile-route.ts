import { compileRule } from "@vibefinance/shared";
import type { CompilerModel } from "@vibefinance/shared";

export interface CompileRequestBody {
  ruleSetId?: unknown;
  sourceText?: unknown;
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
 */
export async function handleCompileRequest(
  model: CompilerModel,
  compiledBy: string,
  db: D1Database,
  body: CompileRequestBody
): Promise<CompileRouteResult> {
  const { ruleSetId, sourceText } = body;
  if (typeof ruleSetId !== "string" || !ruleSetId || typeof sourceText !== "string" || !sourceText) {
    return { status: 400, body: { error: "ruleSetId and sourceText (both strings) are required" } };
  }

  const ruleSetExists = await db
    .prepare("SELECT id FROM rule_sets WHERE id = ?")
    .bind(ruleSetId)
    .first();
  if (!ruleSetExists) {
    return { status: 404, body: { error: `rule set ${ruleSetId} does not exist` } };
  }

  const outcome = await compileRule(model, sourceText);

  // Refusal as a first-class output (Blueprint, "Subsystem one"): a
  // sentence the model can't express in the closed vocabulary is
  // reported back for the person to rephrase, and nothing is stored —
  // never silently approximated, never persisted half-formed.
  if (outcome.kind === "refused") {
    return { status: 422, body: { status: "refused", reason: outcome.reason } };
  }

  const ruleId = crypto.randomUUID();
  const version = 1;

  const nextSortOrder = await db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM rules WHERE rule_set_id = ?")
    .bind(ruleSetId)
    .first<{ next: number }>();
  const sortOrder = nextSortOrder?.next ?? 0;

  // Append-only: a new rule and its first version. approved_by/
  // approved_at are left null — "A person activated this. Never
  // auto-promote a generated rule." (Blueprint, rule_versions). This
  // draft has no effect on invoice evaluation until someone approves it
  // through a separate step (Blueprint build order step 3, not this one).
  await db.batch([
    db
      .prepare("INSERT INTO rules (id, rule_set_id, sort_order, enabled) VALUES (?, ?, ?, 1)")
      .bind(ruleId, ruleSetId, sortOrder),
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
      ),
  ]);

  return {
    status: 201,
    body: {
      status: "compiled",
      ruleId,
      version,
      ruleSetId,
      conditions: outcome.conditions,
      actions: outcome.actions,
    },
  };
}
