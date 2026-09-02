import type { InvoiceFacts } from "@vibefinance/shared";

/**
 * Deterministic validation — the design in docs/design/validation.md.
 *
 * The boundary this exists to hold: extraction reports what is
 * printed on a page, and validation decides whether those numbers
 * hang together. The first is inferred and best-effort; the second is
 * exact, and runs the same way every time.
 *
 * Prompted by a real failure. A freight invoice printed no total on
 * page one, and the extraction model invented one — off by 340.00,
 * reported at 0.9 confidence. The extractor no longer calculates
 * (it returns null instead), which makes "no total stated" a real,
 * legible state. This is what then notices that state and says so.
 *
 * Every check here is arithmetic or presence. No model, no
 * inference, no confidence score — there is nothing to be uncertain
 * about, which is the entire point of doing it here rather than
 * asking a model to be careful.
 *
 * A fact-producing agent in decision 0015's sense: it runs before a
 * stage's rules evaluate, contributes facts, and finishes. Rules then
 * decide what a failure means — this module never blocks, holds, or
 * routes anything itself. The platform computes facts; customers
 * decide policy.
 */

/**
 * Currency comparison tolerance, in the invoice's own units.
 *
 * Floating-point sums of currency do not compare exactly: the eight
 * charge lines on the invoice that prompted this design sum to
 * 3137.4700000000003, and a naive equality check against a printed
 * 3137.47 would fail on a perfectly correct document.
 *
 * A penny covers per-line rounding on invoices of realistic length.
 * Named and exported deliberately rather than buried in a comparison,
 * because it is a real decision: too tight and correct invoices fail,
 * too loose and a genuine error slips through.
 *
 * Deliberately a fixed platform constant rather than per-customer
 * configuration for now. Configuration can be added when a real
 * customer needs a different value; inventing the knob first would be
 * guessing at a requirement nobody has stated.
 */
export const CURRENCY_TOLERANCE = 0.01;

/** The closed set of checks. Named, because "validation failed" is
 *  far less useful to a rule author than knowing WHICH check failed —
 *  a date-order problem and a total mismatch warrant different
 *  handling. */
export const VALIDATION_CHECKS = [
  "total_missing",
  "vat_arithmetic",
  "amount_due_mismatch",
  "date_order",
  "line_sum",
] as const;
export type ValidationCheck = (typeof VALIDATION_CHECKS)[number];

export interface ValidationResult {
  passed: boolean;
  failures: ValidationCheck[];
  /** Every check that was genuinely evaluated. A check skipped for
   *  want of data is neither a pass nor a failure, and conflating
   *  "we checked and it was fine" with "we could not check" would
   *  make validation.passed mean less than it appears to. */
  checked: ValidationCheck[];
}

/** A line as the workflow engine actually holds it: invoice facts
 *  plus a line number, so the line amount is BT-131 — the closed
 *  vocabulary's own term — not a bare `amount` property. */
export type LineForValidation = InvoiceFacts;

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= CURRENCY_TOLERANCE;
}

/**
 * Runs every check that has enough data to run.
 *
 * `lines` is optional, and the line-sum check simply does not run
 * without it. That matters today because line-level extraction from
 * an image is not built — the UBL path supplies real lines, the image
 * path does not — and a check that cannot run must not masquerade as
 * one that passed.
 */
export function validateInvoiceFacts(
  facts: InvoiceFacts,
  lines?: readonly LineForValidation[]
): ValidationResult {
  const failures: ValidationCheck[] = [];
  const checked: ValidationCheck[] = [];

  const net = num(facts["BT-106"]);
  const vat = num(facts["BT-110"]);
  const total = num(facts["BT-112"]);
  const due = num(facts["BT-115"]);

  // A document with no total at all. Always checkable — its absence
  // is exactly what makes it a failure — and the gap this design was
  // written to close: before the extractor stopped calculating, a
  // fabricated total sailed through; now a missing one is visible
  // rather than silently absent.
  checked.push("total_missing");
  if (total === null) {
    failures.push("total_missing");
  }

  // net + VAT should equal the total. Skipped unless all three are
  // present, since two of three proves nothing.
  if (net !== null && vat !== null && total !== null) {
    checked.push("vat_arithmetic");
    if (!close(net + vat, total)) failures.push("vat_arithmetic");
  }

  // The amount due normally equals the total. A legitimate part
  // payment or credit makes them differ, so this is reported as a
  // discrepancy worth a human's attention, never as proof of an
  // error — which is precisely why this module flags and a rule
  // decides.
  if (due !== null && total !== null) {
    checked.push("amount_due_mismatch");
    if (!close(due, total)) failures.push("amount_due_mismatch");
  }

  // An issue date after its own due date is always wrong.
  const issued = typeof facts["BT-2"] === "string" ? Date.parse(facts["BT-2"]) : NaN;
  const dueDate = typeof facts["BT-9"] === "string" ? Date.parse(facts["BT-9"]) : NaN;
  if (!Number.isNaN(issued) && !Number.isNaN(dueDate)) {
    checked.push("date_order");
    if (issued > dueDate) failures.push("date_order");
  }

  // The lines should sum to the stated net. Only runs when lines were
  // genuinely supplied AND every one of them carries an amount — a
  // partial set would produce a mismatch that says nothing about the
  // document, only about what was captured from it.
  if (lines && lines.length > 0) {
    const amounts = lines.map((line) => num(line["BT-131"]));
    if (amounts.every((a) => a !== null)) {
      const sum = (amounts as number[]).reduce((acc, a) => acc + a, 0);
      const against = net ?? total;
      if (against !== null) {
        checked.push("line_sum");
        if (!close(sum, against)) failures.push("line_sum");
      }
    }
  }

  return { passed: failures.length === 0, failures, checked };
}

/**
 * Merges a validation result into facts, as real derived fields.
 *
 * `validation.passed` has been in the closed vocabulary since the
 * first migration — typed, described, and never once set by
 * anything. This is what finally makes it real, exactly as decision
 * 0040 did for the 'warned' licence status.
 *
 * `validation.failures` is a comma-joined string rather than an
 * array, deliberately: the interpreter's `contains` operator works on
 * strings, so a customer can write "if validation failures contains
 * total_missing, assign a task to the AP team" using vocabulary that
 * already exists. An array would need a new operator and a new
 * concept for no real gain.
 */
export function mergeValidationFacts(facts: InvoiceFacts, result: ValidationResult): InvoiceFacts {
  return {
    ...facts,
    "validation.passed": result.passed,
    "validation.failures": result.failures.join(","),
  };
}
