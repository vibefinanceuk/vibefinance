import { describe, expect, it } from "vitest";
import { validateRule } from "./evaluate.js";

/**
 * A condition's value, against the standard's own list —
 * decision 0148.
 *
 * **Decision 0041 made this argument for operators** and it is the same
 * one: a rule saying *"currency is EURO"* names a real field and a real
 * operator, compiles, activates, and silently never fires. The ISO code
 * is `EUR`.
 *
 * Nothing errors. An invoice that should have been held goes through,
 * and the only evidence is an absence — which decision 0113 calls the
 * worst kind of rule failure, because it looks correct in every
 * listing.
 */

function ruleWith(field: string, operator: string, value: unknown) {
  return {
    id: "r-1",
    name: "A rule",
    conditions: { all: [{ field, operator, value }] },
    actions: [{ type: "flag", params: {} }],
  } as never;
}

describe("a currency nobody issues", () => {
  it("refuses EURO, which is the mistake somebody makes", () => {
    expect(() => validateRule(ruleWith("BT-5", "is", "EURO"))).toThrow(/not a valid BT-5 code/);
  });

  it("accepts EUR, which is the code", () => {
    expect(() => validateRule(ruleWith("BT-5", "is", "EUR"))).not.toThrow();
  });

  it("says why it would never match", () => {
    // **The refusal has to explain itself.** "Invalid code" tells
    // somebody they are wrong; this tells them what would have
    // happened.
    expect(() => validateRule(ruleWith("BT-5", "is", "DOLLARS"))).toThrow(
      /never match anything/
    );
  });
});

describe("a list of values", () => {
  it("checks every member, not the first", () => {
    // **One bad code among four** makes a rule that matches three
    // things and looks like it matches four.
    expect(() =>
      validateRule(ruleWith("BT-5", "in", ["EUR", "GBP", "USD", "EURO"]))
    ).toThrow(/EURO/);
  });

  it("accepts a list where every member is real", () => {
    expect(() =>
      validateRule(ruleWith("BT-5", "in", ["EUR", "GBP", "USD"]))
    ).not.toThrow();
  });
});

describe("a list that is deliberately incomplete", () => {
  it("accepts a unit nobody seeded", () => {
    // **The UN/ECE list here is a subset** (decision 0113), so
    // refusing would make our incomplete list the customer's problem. A
    // customer with a legitimate unit must still be able to write a
    // rule about it.
    expect(() => validateRule(ruleWith("BT-130", "is", "XYZ"))).not.toThrow();
  });
});

describe("fields with no list at all", () => {
  it("leaves a free-text field alone", () => {
    // Most fields carry whatever a document says. Only the ones the
    // standard closes are checked.
    expect(() => validateRule(ruleWith("BT-27", "is", "Any Supplier Ltd"))).not.toThrow();
  });

  it("leaves a number alone", () => {
    expect(() => validateRule(ruleWith("BT-112", "greater_than", 1000))).not.toThrow();
  });
});

describe("what is not a bad code", () => {
  it("allows an empty value, which means nothing rather than wrong", () => {
    expect(() => validateRule(ruleWith("BT-5", "is", ""))).not.toThrow();
  });

  it("still refuses a missing value, as it always did", () => {
    // The previous check's business, and it must keep working.
    expect(() => validateRule(ruleWith("BT-5", "is", undefined))).toThrow(/requires a value/);
  });

  it("leaves is_present alone, which takes no value", () => {
    expect(() => validateRule(ruleWith("BT-5", "is_present", undefined))).not.toThrow();
  });
});

describe("the VAT category, which is also closed", () => {
  it("refuses a category the standard does not define", () => {
    expect(() => validateRule(ruleWith("BT-151", "is", "ZZ"))).toThrow(/not a valid BT-151/);
  });

  it("accepts one it does", () => {
    expect(() => validateRule(ruleWith("BT-151", "is", "S"))).not.toThrow();
  });
});
