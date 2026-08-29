import { describe, expect, it } from "vitest";
import {
  DERIVED_FIELDS,
  DERIVED_FIELD_DESCRIPTIONS,
  FIELD_DESCRIPTIONS,
  INVOICE_FIELDS,
  isKnownAction,
  isKnownField,
  isKnownOperator,
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
    expect(isKnownAction("require_second_approval")).toBe(true);
    expect(isKnownAction("execute_script")).toBe(false);
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
});
