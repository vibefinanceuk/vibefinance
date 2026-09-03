import {
  asResolved,
  isKnownAction,
  isKnownField,
  isKnownOperator,
  isOperatorValidForField,
  OPERATORS_BY_TYPE,
} from "./vocabulary.js";
import type { VocabularyInput } from "./vocabulary.js";
import type {
  Condition,
  CompiledRule,
  CompiledRuleSet,
  InvoiceFacts,
  RuleNode,
  RuleSetOutcome,
  StepTrace,
} from "./types.js";

/**
 * Hold this line (Blueprint, "Subsystem one"): the rule language must
 * never become Turing-complete. Nesting is bounded so that "how deep can
 * a rule go" has a fixed answer independent of any particular rule —
 * that answer has to survive being stated in a security review.
 */
export const MAX_COMBINATOR_DEPTH = 5;

export class RuleValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleValidationError";
  }
}

/**
 * Validate a rule against the closed vocabulary before it is ever stored
 * or executed. This is the boundary the (future) natural-language
 * compiler's output must cross — "refusal as a first-class output" means
 * the compiler calls this and reports failure back to the author rather
 * than storing something this function would reject.
 *
 * vocabulary defaults to "invoice" — every caller written before
 * decision 0022's multi-vocabulary support existed continues checking
 * exactly what it always checked, unchanged, unless it explicitly asks
 * for a different one.
 */
export function validateRule(rule: CompiledRule, vocabulary: VocabularyInput = "invoice"): void {
  validateNode(rule.conditions, 0, vocabulary);
  if (rule.actions.length === 0) {
    throw new RuleValidationError(`rule ${rule.id}: at least one action is required`);
  }
  for (const action of rule.actions) {
    if (!isKnownAction(action.type)) {
      throw new RuleValidationError(
        `rule ${rule.id}: unknown action "${action.type}" — not in the closed vocabulary`
      );
    }
    // set_field is the one action that writes back into the fact set,
    // so its params are checked against the closed vocabulary here —
    // decision 0049. Without this a rule could name any field at all,
    // and the vocabulary would stop being closed at exactly the point
    // where it matters most: the place a rule can change data.
    if (action.type === "set_field") {
      const params = (action.params ?? {}) as Record<string, unknown>;
      const target = params.field;
      if (typeof target !== "string" || !isKnownField(target, vocabulary)) {
        throw new RuleValidationError(
          `rule ${rule.id}: set_field names "${String(target)}", which is not in the closed vocabulary`
        );
      }
      const hasLiteral = "value" in params;
      const hasFrom = typeof params.fromField === "string";
      // Exactly one source. Both would leave which one wins to
      // whichever the implementation happened to check first;
      // neither would set nothing at all while looking like it does
      // something.
      if (hasLiteral === hasFrom) {
        throw new RuleValidationError(
          `rule ${rule.id}: set_field needs exactly one of "value" or "fromField", not ${hasLiteral ? "both" : "neither"}`
        );
      }
      if (hasFrom && !isKnownField(params.fromField as string, vocabulary)) {
        throw new RuleValidationError(
          `rule ${rule.id}: set_field copies from "${String(params.fromField)}", which is not in the closed vocabulary`
        );
      }
    }
  }
}

function validateNode(node: RuleNode, depth: number, vocabulary: VocabularyInput): void {
  if (depth > MAX_COMBINATOR_DEPTH) {
    throw new RuleValidationError(
      `combinator nesting exceeds MAX_COMBINATOR_DEPTH (${MAX_COMBINATOR_DEPTH})`
    );
  }
  if ("all" in node) {
    if (node.all.length === 0) {
      throw new RuleValidationError("empty 'all' combinator");
    }
    for (const child of node.all) validateNode(child, depth + 1, vocabulary);
    return;
  }
  if ("any" in node) {
    if (node.any.length === 0) {
      throw new RuleValidationError("empty 'any' combinator");
    }
    for (const child of node.any) validateNode(child, depth + 1, vocabulary);
    return;
  }
  validateCondition(node, vocabulary);
}

function validateCondition(condition: Condition, vocabulary: VocabularyInput): void {
  if (!isKnownField(condition.field, vocabulary)) {
    throw new RuleValidationError(
      `unknown field "${condition.field}" — not in the closed vocabulary`
    );
  }
  if (!isKnownOperator(condition.operator)) {
    throw new RuleValidationError(
      `unknown operator "${condition.operator}" — not in the closed vocabulary`
    );
  }
  const needsValue = !["is_present", "is_empty"].includes(condition.operator);
  if (needsValue && condition.value === undefined) {
    throw new RuleValidationError(
      `condition on "${condition.field}" with operator "${condition.operator}" requires a value`
    );
  }
  // Type-awareness (decision 0041). Without this, an operator that
  // cannot possibly match a field's declared type is accepted here
  // and then silently returns false forever at evaluation time —
  // `greater_than` compares with `typeof actual === "number"`, so a
  // textual field never satisfies it. No error, no refusal, just a
  // rule that quietly does nothing. Refusing at compile time turns
  // the worst failure mode this engine has into a real message.
  if (!isOperatorValidForField(condition.field, condition.operator, vocabulary)) {
    const type = asResolved(vocabulary).fieldTypes[condition.field];
    throw new RuleValidationError(
      `operator "${condition.operator}" cannot be used with "${condition.field}", which is declared as ${type} — ` +
        `it would never match. Valid operators for ${type}: ${OPERATORS_BY_TYPE[type].join(", ")}`
    );
  }
}

/** Resolve a field reference (including parameterised term.absent(BT-n)) against invoice facts. */
function resolveField(field: string, facts: InvoiceFacts): unknown {
  if (field.startsWith("term.absent(") && field.endsWith(")")) {
    const bt = field.slice("term.absent(".length, -1);
    return facts[bt] === undefined || facts[bt] === null;
  }
  return facts[field];
}

function evaluateCondition(condition: Condition, facts: InvoiceFacts): boolean {
  const actual = resolveField(condition.field, facts);
  const { operator, value } = condition;

  switch (operator) {
    case "is":
      return actual === value;
    case "is_not":
      return actual !== value;
    case "in":
      return Array.isArray(value) && value.includes(actual);
    case "not_in":
      return Array.isArray(value) && !value.includes(actual);
    case "greater_than":
      return typeof actual === "number" && typeof value === "number" && actual > value;
    case "less_than":
      return typeof actual === "number" && typeof value === "number" && actual < value;
    case "between": {
      if (typeof actual !== "number" || !Array.isArray(value) || value.length !== 2) return false;
      const [low, high] = value as [number, number];
      return actual >= low && actual <= high;
    }
    case "starts_with":
      return typeof actual === "string" && typeof value === "string" && actual.startsWith(value);
    case "contains":
      return typeof actual === "string" && typeof value === "string" && actual.includes(value);
    case "is_present":
      return actual !== undefined && actual !== null;
    case "is_empty":
      return actual === undefined || actual === null || actual === "";
    case "older_than_days": {
      if (typeof actual !== "string" || typeof value !== "number") return false;
      const ageMs = Date.now() - Date.parse(actual);
      return ageMs > value * 86_400_000;
    }
    case "within_days": {
      if (typeof actual !== "string" || typeof value !== "number") return false;
      const ageMs = Date.now() - Date.parse(actual);
      return ageMs >= 0 && ageMs <= value * 86_400_000;
    }
    default: {
      // Unreachable given validateRule ran first, but keeps the switch
      // exhaustive rather than silently falling through on a future
      // vocabulary addition that forgets to update this function.
      const exhaustive: never = operator as never;
      throw new RuleValidationError(`unhandled operator "${exhaustive}"`);
    }
  }
}

function evaluateNode(node: RuleNode, facts: InvoiceFacts): boolean {
  if ("all" in node) return node.all.every((child) => evaluateNode(child, facts));
  if ("any" in node) return node.any.some((child) => evaluateNode(child, facts));
  return evaluateCondition(node, facts);
}

/**
 * Evaluate one rule's conditions against a single set of facts,
 * independent of a full rule set. The compiler's example-generation
 * step (shared/compiler/examples.ts) uses this to verify a model's
 * claimed match/no-match outcome against the exact same logic that
 * runs in production — never trusting the model's own claim about
 * what its example does, checking it.
 */
export function evaluateConditions(conditions: RuleNode, facts: InvoiceFacts): boolean {
  return evaluateNode(conditions, facts);
}

/**
 * Run one rule set against one invoice's facts. Pure function: same
 * inputs, same outcome, every time — the property the Blueprint's
 * support argument depends on ("reproduces on your laptop from two
 * inputs: their rules and the invoice").
 */
export function evaluateRuleSet(
  ruleSet: CompiledRuleSet,
  facts: InvoiceFacts
): RuleSetOutcome {
  const trace: StepTrace[] = [];
  const matchedActions: RuleSetOutcome["actions"] = [];
  const attributedActions: RuleSetOutcome["attributedActions"] = [];

  for (const [index, rule] of ruleSet.rules.entries()) {
    const matched = evaluateNode(rule.conditions, facts);
    trace.push({ seq: index, ruleId: rule.id, ruleVersion: rule.version, matched });
    if (matched) {
      matchedActions.push(...rule.actions);
      for (const action of rule.actions) {
        attributedActions.push({ ruleId: rule.id, action });
      }
      if (ruleSet.mode === "first_match") {
        return { outcome: "matched", actions: matchedActions, attributedActions, trace };
      }
    }
  }

  return {
    outcome: matchedActions.length > 0 ? "matched" : "no_match",
    actions: matchedActions,
    attributedActions,
    trace,
  };
}
