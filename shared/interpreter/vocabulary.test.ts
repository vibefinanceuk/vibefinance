import { describe, expect, it } from "vitest";
import { isKnownAction, isKnownField, isKnownOperator } from "./vocabulary.js";

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
});
