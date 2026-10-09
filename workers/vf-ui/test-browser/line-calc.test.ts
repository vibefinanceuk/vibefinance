import { describe, expect, it } from "vitest";
import { lineNetSuggestion } from "/line-calc.js";

/** What a line's net amount should be — decision 0708. */
describe("lineNetSuggestion", () => {
  it("offers quantity × price when the net amount is empty", () => {
    expect(lineNetSuggestion({ "BT-129": 21, "BT-146": 2.9 })).toEqual({ kind: "calc", amount: 60.9, qty: 21, price: 2.9 });
  });

  it("says nothing when the net amount is quantity × price", () => {
    expect(lineNetSuggestion({ "BT-129": 21, "BT-146": 2.9, "BT-131": 60.9 })).toBeNull();
    expect(lineNetSuggestion({ "BT-129": "21", "BT-146": "2.90", "BT-131": "60.90" })).toBeNull();
  });

  it("recognises an amount that included VAT at the line's rate, and offers the net", () => {
    expect(lineNetSuggestion({ "BT-129": 21, "BT-146": 2.9, "BT-152": 20, "BT-131": 73.08 })).toEqual({ kind: "gross", amount: 60.9, rate: 20 });
  });

  it("flags an amount that is neither, offering quantity × price", () => {
    expect(lineNetSuggestion({ "BT-129": 21, "BT-146": 2.9, "BT-152": 20, "BT-131": 55 })).toEqual({ kind: "calc", amount: 60.9, qty: 21, price: 2.9, mismatch: true });
  });

  it("divides by the price's base quantity", () => {
    expect(lineNetSuggestion({ "BT-129": 250, "BT-146": 12, "BT-149": 100 })).toMatchObject({ amount: 30 });
  });

  it("says nothing without both a quantity and a price", () => {
    expect(lineNetSuggestion({ "BT-129": 21 })).toBeNull();
    expect(lineNetSuggestion({ "BT-146": 2.9, "BT-131": 60.9 })).toBeNull();
    expect(lineNetSuggestion({ "BT-129": "", "BT-146": 2.9 })).toBeNull();
  });
});
