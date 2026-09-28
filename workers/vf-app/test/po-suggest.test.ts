import { describe, expect, it } from "vitest";
import { bestSuggestion, scorePair, words, SUGGEST_THRESHOLD, type SuggestInvoiceLine, type SuggestPoLine } from "../src/po-suggest.js";

/** Suggesting a PO line for an invoice line — decision 0534. */

const inv = (o: Partial<SuggestInvoiceLine> = {}): SuggestInvoiceLine => ({
  name: "Organiser", description: null, sellerItemId: null, standardItemId: null,
  quantity: 5, unit: "EA", amount: 90, price: 18, ...o,
});
const po = (n: number, o: Partial<SuggestPoLine> = {}): SuggestPoLine => ({
  lineNumber: n, name: "Desk organiser", description: null, sellerItemId: null, standardItemId: null,
  quantity: 8, unit: "EA", amount: 144, price: 18, leftQuantity: 8, ...o,
});

describe("scoring one pair", () => {
  it("weighs description, price, fit and unit, and says which counted", () => {
    // Words {organiser} vs {desk, organiser}: 2/3. 0.6×2/3 + 0.25 + 0.1 + 0.05 = 80.
    expect(scorePair(inv(), po(4))).toEqual({ poLineNumber: 4, score: 80, reasons: ["description", "price", "fits"] });
  });

  it("treats the same item code as near-certain, whatever the words", () => {
    const s = scorePair(inv({ name: "Widget", sellerItemId: "SKU-9" }), po(2, { name: "Something else", sellerItemId: "sku-9" }));
    expect(s.score).toBeGreaterThanOrEqual(95);
    expect(s.reasons).toContain("itemcode");
  });

  it("gives half the price weight within 10%, none beyond, and no fit past what is left", () => {
    expect(scorePair(inv({ price: 19 }), po(1)).reasons).not.toContain("price");
    expect(scorePair(inv({ price: 19 }), po(1)).score).toBe(Math.round(100 * (0.4 + 0.125 + 0.1 + 0.05)));
    expect(scorePair(inv({ quantity: 9 }), po(1)).reasons).not.toContain("fits");
  });

  it("derives a unit price from amount and quantity when none is given", () => {
    expect(scorePair(inv({ price: null }), po(1, { price: null })).reasons).toContain("price");
  });
});

describe("the best suggestion", () => {
  it("picks the closest PO line", () => {
    const lines = [po(1, { name: "Toner cartridge, black", price: 42 }), po(2, { name: "A4 copier paper", price: 23.5 }), po(4)];
    expect(bestSuggestion(inv(), lines)?.poLineNumber).toBe(4);
    expect(bestSuggestion(inv({ name: "Toner black", price: 42, amount: 420, quantity: 10 }), lines)?.poLineNumber).toBe(1);
  });

  it("suggests nothing below the threshold", () => {
    expect(SUGGEST_THRESHOLD).toBe(50);
    expect(bestSuggestion(inv({ name: "Consulting services", price: 900 }), [po(1, { name: "Toner cartridge", price: 42 })])).toBeNull();
    expect(bestSuggestion(inv(), [])).toBeNull();
  });
});

describe("words", () => {
  it("lower-cases, drops short words, stopwords and a plural s", () => {
    expect([...words("Paper, A4 80gsm — boxes of 5", null)].sort()).toEqual(["80gsm", "a4", "boxe", "paper"].sort());
  });
});
