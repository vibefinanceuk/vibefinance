import { describe, expect, it } from "vitest";
import {
  ACTIONS,
  ACTION_DESCRIPTIONS,
  DERIVED_FIELDS,
  DERIVED_FIELD_DESCRIPTIONS,
  EXPENSE_DERIVED_FIELDS,
  EXPENSE_DERIVED_FIELD_DESCRIPTIONS,
  EXPENSE_FIELDS,
  EXPENSE_FIELD_DESCRIPTIONS,
  FIELD_DESCRIPTIONS,
  INVOICE_FIELDS,
  VOCABULARIES,
  VOCABULARY_NAMES,
  isKnownAction,
  isKnownField,
  isKnownOperator,
  isKnownVocabulary,
} from "./vocabulary.js";

describe("closed vocabulary", () => {
  it("accepts a BT-addressed invoice field", () => {
    expect(isKnownField("BT-48")).toBe(true);
  });

  it("accepts a derived field", () => {
    expect(isKnownField("po.matched")).toBe(true);
  });

  it("accepts a parameterised term.absent field", () => {
    expect(isKnownField("term.absent(BT-10)")).toBe(true);
  });

  it("rejects an unparameterised term.absent (no BT code)", () => {
    // Guards against a field like "term.absent()" or "term.absent" being
    // treated as valid just because it matches the prefix.
    expect(isKnownField("term.absent(")).toBe(false);
  });

  it("rejects a field not in either catalogue", () => {
    expect(isKnownField("BT-999")).toBe(false);
    expect(isKnownField("supplier.name")).toBe(false);
  });

  it("accepts every documented operator and rejects an invented one", () => {
    expect(isKnownOperator("older_than_days")).toBe(true);
    expect(isKnownOperator("matches_regex")).toBe(false);
  });

  it("accepts every documented action and rejects an invented one", () => {
    expect(isKnownAction("escalate_after")).toBe(true);
    expect(isKnownAction("execute_script")).toBe(false);
  });

  it("no longer accepts require_second_approval — decision 0074", () => {
    // Removed rather than built. Parallel tasks on one stage visit
    // already give multiple approvers; a rule at Review already decides
    // when further review is needed; and separation of duties is an
    // RBAC concern. Nothing was left for it to mean, and an action that
    // compiles and does nothing is worse than one action fewer.
    expect(isKnownAction("require_second_approval")).toBe(false);
  });

  it("accepts assign_task — added for decision 0018's task ownership model", () => {
    expect(isKnownAction("assign_task")).toBe(true);
  });

  it("has a description for every invoice field — a check, not a comment, so a field added without one is caught", () => {
    for (const field of INVOICE_FIELDS) {
      expect(FIELD_DESCRIPTIONS[field], `missing description for ${field}`).toBeTruthy();
    }
  });

  it("has a description for every derived field", () => {
    for (const field of DERIVED_FIELDS) {
      expect(DERIVED_FIELD_DESCRIPTIONS[field], `missing description for ${field}`).toBeTruthy();
    }
  });

  it("has a description for every action — the exact gap that let assign_task's params drift from what the workflow engine expects", () => {
    for (const action of ACTIONS) {
      expect(ACTION_DESCRIPTIONS[action], `missing description for ${action}`).toBeTruthy();
    }
  });
});

describe("multi-vocabulary support (decision 0022) — the real prerequisite decision 0015 flagged before a second domain could exist", () => {
  it("has a description for every expense field — the same completeness discipline as invoice fields", () => {
    for (const field of EXPENSE_FIELDS) {
      expect(EXPENSE_FIELD_DESCRIPTIONS[field], `missing description for ${field}`).toBeTruthy();
    }
  });

  it("has a description for every expense derived field", () => {
    for (const field of EXPENSE_DERIVED_FIELDS) {
      expect(EXPENSE_DERIVED_FIELD_DESCRIPTIONS[field], `missing description for ${field}`).toBeTruthy();
    }
  });

  it("isKnownField defaults to the invoice vocabulary — every pre-existing caller sees unchanged behaviour", () => {
    expect(isKnownField("BT-112")).toBe(true); // an invoice field, no vocabulary argument at all
    expect(isKnownField("category")).toBe(false); // an expense field must NOT leak into the default
  });

  it("isKnownField('category', 'expense') is true, but isKnownField('category', 'invoice') is false — real isolation, not just presence", () => {
    expect(isKnownField("category", "expense")).toBe(true);
    expect(isKnownField("category", "invoice")).toBe(false);
  });

  it("the reverse holds too — an invoice field is not known under the expense vocabulary", () => {
    expect(isKnownField("BT-112", "invoice")).toBe(true);
    expect(isKnownField("BT-112", "expense")).toBe(false);
  });

  it("isKnownVocabulary and VOCABULARY_NAMES agree with the real registry", () => {
    expect(isKnownVocabulary("invoice")).toBe(true);
    expect(isKnownVocabulary("expense")).toBe(true);
    expect(isKnownVocabulary("not_a_real_vocabulary")).toBe(false);
    expect(VOCABULARY_NAMES.sort()).toEqual(Object.keys(VOCABULARIES).sort());
  });
});
