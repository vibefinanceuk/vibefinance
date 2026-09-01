import { describe, expect, it } from "vitest";
import {
  MAX_COMBINATOR_DEPTH,
  RuleValidationError,
  evaluateConditions,
  evaluateRuleSet,
  validateRule,
} from "./evaluate.js";
import type { CompiledRule, CompiledRuleSet, InvoiceFacts, RuleNode } from "./types.js";

function nestedAll(depth: number): RuleNode {
  let node: RuleNode = { field: "BT-3", operator: "is", value: "380" };
  for (let i = 0; i < depth; i++) {
    node = { all: [node] };
  }
  return node;
}

describe("validateRule — the refusal boundary", () => {
  it("accepts a well-formed rule", () => {
    const rule: CompiledRule = {
      id: "r1",
      version: 1,
      conditions: { field: "BT-48", operator: "is_empty" },
      actions: [{ type: "route_to", params: { queue: "tax_review" } }],
    };
    expect(() => validateRule(rule)).not.toThrow();
  });

  it("rejects an unknown field", () => {
    const rule: CompiledRule = {
      id: "r2",
      version: 1,
      conditions: { field: "supplier.reputation", operator: "is", value: "bad" },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule)).toThrow(RuleValidationError);
  });

  it("rejects an unknown operator", () => {
    const rule: CompiledRule = {
      id: "r3",
      version: 1,
      conditions: { field: "BT-112", operator: "roughly_equals", value: 100 },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule)).toThrow(RuleValidationError);
  });

  it("rejects an unknown action — the model's refusal case", () => {
    const rule: CompiledRule = {
      id: "r4",
      version: 1,
      conditions: { field: "BT-3", operator: "is_present" },
      actions: [{ type: "run_arbitrary_script" }],
    };
    expect(() => validateRule(rule)).toThrow(RuleValidationError);
  });

  it("rejects a rule with no actions", () => {
    const rule: CompiledRule = {
      id: "r5",
      version: 1,
      conditions: { field: "BT-3", operator: "is_present" },
      actions: [],
    };
    expect(() => validateRule(rule)).toThrow(RuleValidationError);
  });

  it("accepts nesting up to MAX_COMBINATOR_DEPTH", () => {
    const rule: CompiledRule = {
      id: "r6",
      version: 1,
      conditions: nestedAll(MAX_COMBINATOR_DEPTH),
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule)).not.toThrow();
  });

  it("rejects nesting beyond MAX_COMBINATOR_DEPTH", () => {
    const rule: CompiledRule = {
      id: "r7",
      version: 1,
      conditions: nestedAll(MAX_COMBINATOR_DEPTH + 1),
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule)).toThrow(RuleValidationError);
  });

  it("rejects a condition missing a required value", () => {
    const rule: CompiledRule = {
      id: "r8",
      version: 1,
      conditions: { field: "BT-112", operator: "greater_than" },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule)).toThrow(RuleValidationError);
  });

  it("defaults to the invoice vocabulary — an existing caller passing no third argument sees unchanged behaviour", () => {
    const rule: CompiledRule = {
      id: "r9",
      version: 1,
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule)).not.toThrow();
  });

  it("accepts an expense field when the expense vocabulary is explicitly requested", () => {
    const rule: CompiledRule = {
      id: "r10",
      version: 1,
      conditions: { field: "category", operator: "is", value: "Travel" },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(rule, "expense")).not.toThrow();
  });

  it("the critical isolation property: an invoice field is refused under the expense vocabulary, and vice versa", () => {
    const invoiceFieldRule: CompiledRule = {
      id: "r11",
      version: 1,
      conditions: { field: "BT-112", operator: "greater_than", value: 1000 },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(invoiceFieldRule, "expense")).toThrow(RuleValidationError);

    const expenseFieldRule: CompiledRule = {
      id: "r12",
      version: 1,
      conditions: { field: "category", operator: "is", value: "Travel" },
      actions: [{ type: "flag" }],
    };
    expect(() => validateRule(expenseFieldRule, "invoice")).toThrow(RuleValidationError);
  });
});

describe("evaluateRuleSet — the worked example from the Blueprint", () => {
  // "when BT-48 is absent and BT-40 is outside the EU, route to tax review"
  const euCountries = ["DE", "FR", "NL", "IE", "ES", "IT"];
  const rule: CompiledRule = {
    id: "tax-review-non-eu",
    version: 1,
    conditions: {
      all: [
        { field: "BT-48", operator: "is_empty" },
        { field: "BT-40", operator: "not_in", value: euCountries },
      ],
    },
    actions: [{ type: "route_to", params: { queue: "tax_review" } }],
  };
  const ruleSet: CompiledRuleSet = { id: "rs1", mode: "first_match", rules: [rule] };

  it("fires when both conditions hold", () => {
    const facts: InvoiceFacts = { "BT-40": "US" }; // BT-48 absent entirely
    const result = evaluateRuleSet(ruleSet, facts);
    expect(result.outcome).toBe("matched");
    expect(result.actions).toEqual([{ type: "route_to", params: { queue: "tax_review" } }]);
  });

  it("does not fire when the buyer VAT id is present", () => {
    const facts: InvoiceFacts = { "BT-40": "US", "BT-48": "US123456789" };
    const result = evaluateRuleSet(ruleSet, facts);
    expect(result.outcome).toBe("no_match");
  });

  it("does not fire when the seller country is inside the EU", () => {
    const facts: InvoiceFacts = { "BT-40": "DE" };
    const result = evaluateRuleSet(ruleSet, facts);
    expect(result.outcome).toBe("no_match");
  });

  it("records a trace entry even for a rule that did not fire — Blueprint: rules that did not fire are as important as those that did", () => {
    const facts: InvoiceFacts = { "BT-40": "DE" };
    const result = evaluateRuleSet(ruleSet, facts);
    expect(result.trace).toEqual([
      { seq: 0, ruleId: "tax-review-non-eu", ruleVersion: 1, matched: false },
    ]);
  });

  it("is deterministic: identical inputs produce an identical outcome across repeated runs", () => {
    const facts: InvoiceFacts = { "BT-40": "US" };
    const first = evaluateRuleSet(ruleSet, facts);
    const second = evaluateRuleSet(ruleSet, facts);
    expect(second).toEqual(first);
  });
});

describe("evaluateRuleSet — mode semantics", () => {
  const rules: CompiledRule[] = [
    {
      id: "always-flag",
      version: 1,
      conditions: { field: "BT-3", operator: "is_present" },
      actions: [{ type: "flag", params: { reason: "first" } }],
    },
    {
      id: "always-tag",
      version: 1,
      conditions: { field: "BT-3", operator: "is_present" },
      actions: [{ type: "tag", params: { reason: "second" } }],
    },
  ];
  const facts: InvoiceFacts = { "BT-3": "380" };

  it("first_match stops after the first matching rule", () => {
    const ruleSet: CompiledRuleSet = { id: "rs-fm", mode: "first_match", rules };
    const result = evaluateRuleSet(ruleSet, facts);
    expect(result.actions).toEqual([{ type: "flag", params: { reason: "first" } }]);
    expect(result.trace).toHaveLength(1);
  });

  it("all_matches evaluates every rule and unions the actions", () => {
    const ruleSet: CompiledRuleSet = { id: "rs-am", mode: "all_matches", rules };
    const result = evaluateRuleSet(ruleSet, facts);
    expect(result.actions).toEqual([
      { type: "flag", params: { reason: "first" } },
      { type: "tag", params: { reason: "second" } },
    ]);
    expect(result.trace).toHaveLength(2);
  });
});

describe("evaluateRuleSet — operators", () => {
  function runCondition(field: string, operator: string, value: unknown, facts: InvoiceFacts) {
    const rule: CompiledRule = {
      id: "op-test",
      version: 1,
      conditions: value === undefined ? { field, operator } : { field, operator, value },
      actions: [{ type: "flag" }],
    };
    const ruleSet: CompiledRuleSet = { id: "rs-op", mode: "first_match", rules: [rule] };
    return evaluateRuleSet(ruleSet, facts).outcome === "matched";
  }

  it("older_than_days matches an old date and not a recent one", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
    expect(runCondition("BT-9", "older_than_days", 30, { "BT-9": old })).toBe(true);
    expect(runCondition("BT-9", "older_than_days", 30, { "BT-9": recent })).toBe(false);
  });

  it("within_days matches a recent date and not an old one", () => {
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 1 * 86_400_000).toISOString();
    expect(runCondition("BT-9", "within_days", 30, { "BT-9": recent })).toBe(true);
    expect(runCondition("BT-9", "within_days", 30, { "BT-9": old })).toBe(false);
  });

  it("between is inclusive at both ends", () => {
    expect(runCondition("BT-152", "between", [0, 25], { "BT-152": 0 })).toBe(true);
    expect(runCondition("BT-152", "between", [0, 25], { "BT-152": 25 })).toBe(true);
    expect(runCondition("BT-152", "between", [0, 25], { "BT-152": 25.01 })).toBe(false);
  });

  it("term.absent(BT-n) reads through to the referenced field's absence", () => {
    expect(runCondition("term.absent(BT-13)", "is", true, {})).toBe(true);
    expect(runCondition("term.absent(BT-13)", "is", true, { "BT-13": "PO-1" })).toBe(false);
  });
});

describe("evaluateConditions — single-rule evaluation independent of a rule set", () => {
  it("returns true when the conditions match", () => {
    const conditions: RuleNode = { field: "BT-48", operator: "is_empty" };
    expect(evaluateConditions(conditions, {})).toBe(true);
  });

  it("returns false when the conditions don't match", () => {
    const conditions: RuleNode = { field: "BT-48", operator: "is_empty" };
    expect(evaluateConditions(conditions, { "BT-48": "DE123456789" })).toBe(false);
  });

  it("agrees with evaluateRuleSet for the exact same rule and facts", () => {
    // The property that actually matters for reusing this in example
    // verification: evaluateConditions must not be a parallel
    // reimplementation that could silently drift from what production
    // evaluation actually does.
    const conditions: RuleNode = {
      all: [
        { field: "BT-48", operator: "is_empty" },
        { field: "BT-40", operator: "not_in", value: ["DE", "FR"] },
      ],
    };
    const rule: CompiledRule = { id: "r1", version: 1, conditions, actions: [{ type: "flag" }] };
    const ruleSet: CompiledRuleSet = { id: "rs1", mode: "first_match", rules: [rule] };

    const matchingFacts: InvoiceFacts = { "BT-40": "US" };
    const nonMatchingFacts: InvoiceFacts = { "BT-40": "DE" };

    expect(evaluateConditions(conditions, matchingFacts)).toBe(
      evaluateRuleSet(ruleSet, matchingFacts).outcome === "matched"
    );
    expect(evaluateConditions(conditions, nonMatchingFacts)).toBe(
      evaluateRuleSet(ruleSet, nonMatchingFacts).outcome === "matched"
    );
  });

  it("respects combinator nesting the same way evaluateRuleSet does", () => {
    const conditions: RuleNode = {
      any: [
        { field: "BT-3", operator: "is", value: "381" },
        { all: [{ field: "BT-112", operator: "greater_than", value: 10000 }] },
      ],
    };
    expect(evaluateConditions(conditions, { "BT-3": "381" })).toBe(true);
    expect(evaluateConditions(conditions, { "BT-112": 15000 })).toBe(true);
    expect(evaluateConditions(conditions, { "BT-112": 500 })).toBe(false);
  });
});
