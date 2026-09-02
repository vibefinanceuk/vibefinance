import { describe, expect, it } from "vitest";
import {
  validateInvoiceFacts,
  mergeValidationFacts,
  CURRENCY_TOLERANCE,
} from "../src/validation.js";

describe("validateInvoiceFacts — total_missing", () => {
  it("fails an invoice with no total at all — the gap this design was written to close", () => {
    // Before the extractor stopped calculating, a fabricated total
    // sailed straight through to payment-eligible. Now the absence is
    // visible.
    const result = validateInvoiceFacts({ "BT-1": "SKELS26003894" });
    expect(result.passed).toBe(false);
    expect(result.failures).toContain("total_missing");
  });

  it("passes an invoice that states one", () => {
    const result = validateInvoiceFacts({ "BT-112": 2518.8 });
    expect(result.failures).not.toContain("total_missing");
  });

  it("always runs this check — its absence is the whole point", () => {
    expect(validateInvoiceFacts({}).checked).toContain("total_missing");
  });
});

describe("validateInvoiceFacts — VAT arithmetic", () => {
  it("passes when net plus VAT equals the total", () => {
    // The real McDonald's invoice: 2099.00 + 419.80 = 2518.80.
    const result = validateInvoiceFacts({ "BT-106": 2099, "BT-110": 419.8, "BT-112": 2518.8 });
    expect(result.passed).toBe(true);
    expect(result.checked).toContain("vat_arithmetic");
  });

  it("fails when they do not", () => {
    const result = validateInvoiceFacts({ "BT-106": 2099, "BT-110": 419.8, "BT-112": 3000 });
    expect(result.failures).toContain("vat_arithmetic");
  });

  it("does not run when a component is missing — two of three proves nothing", () => {
    const result = validateInvoiceFacts({ "BT-106": 2099, "BT-112": 2518.8 });
    expect(result.checked).not.toContain("vat_arithmetic");
    expect(result.failures).not.toContain("vat_arithmetic");
  });

  it("tolerates floating-point drift rather than failing a correct invoice", () => {
    // 0.1 + 0.2 is famously not 0.3.
    const result = validateInvoiceFacts({ "BT-106": 0.1, "BT-110": 0.2, "BT-112": 0.3 });
    expect(result.failures).not.toContain("vat_arithmetic");
  });

  it("still catches a discrepancy just outside tolerance", () => {
    const result = validateInvoiceFacts({
      "BT-106": 100,
      "BT-110": 20,
      "BT-112": 120 + CURRENCY_TOLERANCE * 3,
    });
    expect(result.failures).toContain("vat_arithmetic");
  });
});

describe("validateInvoiceFacts — amount due", () => {
  it("passes when the amount due equals the total", () => {
    const result = validateInvoiceFacts({ "BT-112": 2518.8, "BT-115": 2518.8 });
    expect(result.failures).not.toContain("amount_due_mismatch");
  });

  it("flags a difference — which may be a legitimate part payment, so a rule decides", () => {
    const result = validateInvoiceFacts({ "BT-112": 2518.8, "BT-115": 1000 });
    expect(result.failures).toContain("amount_due_mismatch");
  });
});

describe("validateInvoiceFacts — date order", () => {
  it("passes when the invoice is issued before it is due", () => {
    const result = validateInvoiceFacts({ "BT-2": "2026-07-22", "BT-9": "2026-08-21", "BT-112": 1 });
    expect(result.passed).toBe(true);
  });

  it("fails when the due date precedes the issue date", () => {
    const result = validateInvoiceFacts({ "BT-2": "2026-08-21", "BT-9": "2026-07-22" });
    expect(result.failures).toContain("date_order");
  });

  it("allows same-day payment terms", () => {
    const result = validateInvoiceFacts({ "BT-2": "2026-07-22", "BT-9": "2026-07-22" });
    expect(result.failures).not.toContain("date_order");
  });

  it("does not run when either date is missing", () => {
    expect(validateInvoiceFacts({ "BT-2": "2026-07-22" }).checked).not.toContain("date_order");
  });
});

describe("validateInvoiceFacts — line sum", () => {
  const MORRISON_LINES = [
    { "BT-131": 1797.47 },
    { "BT-131": 275.0 },
    { "BT-131": 35.0 },
    { "BT-131": 75.0 },
    { "BT-131": 25.0 },
    { "BT-131": 585.0 },
    { "BT-131": 85.0 },
    { "BT-131": 260.0 },
  ];

  it("passes when the lines sum to the stated net", () => {
    // The real freight invoice: these eight lines sum to 3137.47, and
    // in floating point to 3137.4700000000003 — which is why the
    // tolerance exists.
    const result = validateInvoiceFacts({ "BT-106": 3137.47, "BT-112": 3137.47 }, MORRISON_LINES);
    expect(result.checked).toContain("line_sum");
    expect(result.failures).not.toContain("line_sum");
  });

  it("catches the fabricated total that prompted this whole design", () => {
    // The model invented 2797.47 against lines summing to 3137.47.
    const result = validateInvoiceFacts({ "BT-106": 2797.47, "BT-112": 2797.47 }, MORRISON_LINES);
    expect(result.failures).toContain("line_sum");
  });

  it("does not run without lines — a check that cannot run must not look like one that passed", () => {
    // Line-level extraction from an image is not built, so this is
    // the common case today.
    const result = validateInvoiceFacts({ "BT-106": 2797.47, "BT-112": 2797.47 });
    expect(result.checked).not.toContain("line_sum");
    expect(result.failures).not.toContain("line_sum");
  });

  it("does not run when any line lacks an amount — a partial sum says nothing about the document", () => {
    const partial = [{ "BT-131": 100 }, { description: "no amount captured" }];
    const result = validateInvoiceFacts({ "BT-106": 100, "BT-112": 100 }, partial);
    expect(result.checked).not.toContain("line_sum");
  });

  it("falls back to the total when no net is stated", () => {
    const result = validateInvoiceFacts({ "BT-112": 3137.47 }, MORRISON_LINES);
    expect(result.checked).toContain("line_sum");
    expect(result.failures).not.toContain("line_sum");
  });
});

describe("validateInvoiceFacts — checked versus passed", () => {
  it("distinguishes 'we checked and it was fine' from 'we could not check'", () => {
    // Conflating the two would make validation.passed mean less than
    // it appears to.
    const result = validateInvoiceFacts({ "BT-112": 100 });
    expect(result.passed).toBe(true);
    expect(result.checked).toEqual(["total_missing"]);
  });

  it("reports every failure, not just the first", () => {
    const result = validateInvoiceFacts({
      "BT-106": 100,
      "BT-110": 20,
      "BT-112": 999,
      "BT-115": 1,
      "BT-2": "2026-12-01",
      "BT-9": "2026-01-01",
    });
    expect(result.failures.length).toBeGreaterThan(2);
    expect(result.failures).toContain("vat_arithmetic");
    expect(result.failures).toContain("date_order");
  });
});

describe("mergeValidationFacts", () => {
  it("sets validation.passed as a real fact — finally, after being in the vocabulary from the start", () => {
    const facts = mergeValidationFacts({ "BT-1": "X" }, validateInvoiceFacts({ "BT-112": 100 }));
    expect(facts["validation.passed"]).toBe(true);
    expect(facts["BT-1"]).toBe("X");
  });

  it("joins failures into a string, so the existing contains operator works on it", () => {
    // An array would need a new operator and a new concept; a string
    // lets a customer write "validation.failures contains
    // total_missing" using vocabulary that already exists.
    const facts = mergeValidationFacts({}, validateInvoiceFacts({}));
    expect(typeof facts["validation.failures"]).toBe("string");
    expect(String(facts["validation.failures"])).toContain("total_missing");
  });

  it("reports an empty failure string when everything passed", () => {
    const facts = mergeValidationFacts({}, validateInvoiceFacts({ "BT-112": 100 }));
    expect(facts["validation.failures"]).toBe("");
  });

  it("never overwrites a real invoice fact", () => {
    const facts = mergeValidationFacts({ "BT-112": 100, "BT-1": "INV-1" }, validateInvoiceFacts({ "BT-112": 100 }));
    expect(facts["BT-112"]).toBe(100);
    expect(facts["BT-1"]).toBe("INV-1");
  });
});
