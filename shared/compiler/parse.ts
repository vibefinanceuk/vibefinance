import { RuleValidationError, validateRule } from "../interpreter/evaluate.js";
import type { CompiledRule, RuleAction, RuleNode } from "../interpreter/types.js";
import type { VocabularyName } from "../interpreter/vocabulary.js";
import type { CompileOutcome } from "./types.js";

interface RawCompiledShape {
  status: "compiled";
  conditions: RuleNode;
  actions: RuleAction[];
}

interface RawRefusedShape {
  status: "refused";
  reason: string;
}

/** Exported for reuse by examples.ts's own refusal messages — same
 * reasoning as extractJson's export just above. */
export function truncate(s: string, limit = 2000): string {
  return s.length <= limit ? s : s.slice(0, limit) + `... [${s.length - limit} more chars truncated]`;
}

/**
 * Extract the first JSON value from text that may have extra prose or
 * markdown fences around it — smaller/open models in particular do not
 * reliably follow "respond with only JSON" instructions. Same defensive
 * shape as migrations/apply_migrations.py's parse_wrangler_json: try a
 * direct parse, then look for the first '{' and parse from there.
 *
 * Exported for reuse by examples.ts's response parsing — deliberately
 * the same function, not a second near-identical one, so a future fix
 * to this extraction logic doesn't need to be applied twice. This is
 * also why examples.ts's model response is specified as a JSON object
 * (`{"examples": [...]}`) rather than a bare array: this function's
 * bracket-matching is `{`/`}`-based, and reusing it unchanged was
 * preferred over writing a second, subtly different array variant.
 */
export function extractJson(raw: string): unknown | undefined {
  const stripped = raw.trim();
  try {
    return JSON.parse(stripped);
  } catch {
    // fall through to the recovery attempt below
  }
  const start = stripped.indexOf("{");
  if (start === -1) return undefined;
  // Try progressively shorter suffixes from the last '}' backward, since
  // trailing prose after the JSON is at least as common as a leading
  // banner before it.
  const end = stripped.lastIndexOf("}");
  if (end === -1 || end < start) return undefined;
  try {
    return JSON.parse(stripped.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function isRawCompiled(value: unknown): value is RawCompiledShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.status === "compiled" && "conditions" in v && Array.isArray(v.actions);
}

function isRawRefused(value: unknown): value is RawRefusedShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.status === "refused" && typeof v.reason === "string";
}

/**
 * Parse and validate the model's raw text output. This is the refusal
 * boundary: a rule that fails validation here must never be persisted
 * or executed — it becomes a refusal, with the validation error as the
 * reason, exactly like a rule the model itself declined to write.
 * "It can only ever produce something the interpreter already runs"
 * (Blueprint, build order) is enforced here, not trusted from the model.
 */
export function parseModelOutput(raw: string, vocabulary: VocabularyName = "invoice"): CompileOutcome {
  const parsed = extractJson(raw);

  if (parsed === undefined) {
    return {
      kind: "refused",
      reason:
        "The model's response could not be parsed as JSON. Raw output: " +
        truncate(raw),
      rawModelOutput: raw,
    };
  }

  if (isRawRefused(parsed)) {
    return { kind: "refused", reason: parsed.reason, rawModelOutput: raw };
  }

  if (!isRawCompiled(parsed)) {
    return {
      kind: "refused",
      reason:
        "The model's JSON response did not match either the 'compiled' or " +
        "'refused' shape. Raw output: " +
        truncate(raw),
      rawModelOutput: raw,
    };
  }

  // Validate against the closed vocabulary before this can ever be
  // trusted. id/version are placeholders here purely because
  // validateRule() takes a full CompiledRule — the real values are
  // assigned by the caller on persistence, never by the model.
  const stub: CompiledRule = {
    id: "__unvalidated__",
    version: 0,
    conditions: parsed.conditions,
    actions: parsed.actions,
  };
  try {
    validateRule(stub, vocabulary);
  } catch (err) {
    if (err instanceof RuleValidationError) {
      return {
        kind: "refused",
        reason: `The model produced a rule outside the closed vocabulary: ${err.message}`,
        rawModelOutput: raw,
      };
    }
    throw err;
  }

  return {
    kind: "compiled",
    conditions: parsed.conditions,
    actions: parsed.actions,
    rawModelOutput: raw,
  };
}
