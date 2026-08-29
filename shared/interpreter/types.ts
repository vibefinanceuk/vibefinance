export interface Condition {
  field: string;
  operator: string;
  // Absent for is_present/is_empty; a single value, array (in/not_in),
  // or [low, high] pair (between).
  value?: unknown;
}

export interface AllCombinator {
  all: RuleNode[];
}

export interface AnyCombinator {
  any: RuleNode[];
}

export type RuleNode = Condition | AllCombinator | AnyCombinator;

export interface RuleAction {
  type: string;
  params?: Record<string, unknown>;
}

export interface CompiledRule {
  id: string;
  version: number;
  conditions: RuleNode;
  actions: RuleAction[];
}

export type RuleSetMode = "first_match" | "all_matches";

export interface CompiledRuleSet {
  id: string;
  mode: RuleSetMode;
  // Evaluation order is explicit, not insertion order — Blueprint,
  // rules.sort_order. Callers must supply rules already in this order.
  rules: CompiledRule[];
}

/**
 * The invoice as the interpreter sees it: BT-addressed fields plus the
 * platform-derived ones, already resolved. Building this projection from
 * the stored EN 16931/UBL document is a separate concern (Blueprint,
 * "Storage" — normalised relational projection in D1); the interpreter
 * only ever reads from this flat shape so it stays a pure function of
 * (invoice, rules) → outcome, per §7's "run against the real code path,
 * not a mock" and the support argument in the Blueprint: reproducible
 * from two inputs, nothing else.
 */
export type InvoiceFacts = Record<string, unknown>;

export interface StepTrace {
  seq: number;
  ruleId: string;
  ruleVersion: number;
  matched: boolean;
}

export interface RuleSetOutcome {
  outcome: "matched" | "no_match";
  actions: RuleAction[];
  trace: StepTrace[];
}
