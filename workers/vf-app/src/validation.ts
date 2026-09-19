import { FIELD_CODE_LISTS, isClosedList, isValidCode } from "@vibefinance/shared";
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
 * **`severity` distinguishes two different claims — decision 0400.**
 * "These numbers disagree" (`warning`, every check but one) is not the
 * same claim as "this disagrees with an external source of truth"
 * (`danger`, `po_mismatch` alone, so far) — see `ValidationSeverity`.
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

/** Tolerance is configurable per channel (decision 0053), so the
 *  checks take it rather than reading a constant. Defaults to
 *  CURRENCY_TOLERANCE, so every existing caller is unchanged. */
export interface ValidationSettings {
  currencyTolerance: number;
}

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
  // Decision 0116 — a value the standard closes. Named separately from
  // the arithmetic checks because it says something different: not
  // "these numbers disagree" but "this is not a code the specification
  // recognises".
  "code_list",
  // Decision 0400 — a field that genuinely disagrees with a linked
  // purchase order. Reads po.matched/po.variance_pct (header) and
  // po.line_matched/po.line_variance_pct/po.line_quantity_variance_pct
  // (per line) off the facts this module is given; it never computes
  // them itself (no DB access here) — the caller merges them in via
  // po-matching.ts's mergePoMatchFacts before calling this function,
  // the same way every other fact this module reads is already on
  // `facts`/`lines` by the time it runs.
  "po_mismatch",
] as const;
export type ValidationCheck = (typeof VALIDATION_CHECKS)[number];

/**
 * How urgent a failure is — decision 0400.
 *
 * Added when `--bg-danger`/`--text-danger`/`--border-danger` (decision
 * 0395) were still unconsumed and every check here read alike, "though
 * a missing total and an unfamiliar code are not equally urgent"
 * (decision 0119's own "What is not built"). `danger` is reserved for
 * a claim checked against an external source of truth — today, only a
 * purchase order — and found to disagree. Every other check here is
 * `warning`: arithmetic or presence over the document's own numbers,
 * worth a human's attention but not proof that anything is wrong
 * (`amount_due_mismatch`'s own long-standing comment already said this
 * of itself before severity existed to name it).
 */
export type ValidationSeverity = "danger" | "warning";

/**
 * A failure, with enough for a screen to act on — decision 0119.
 *
 * The screen highlights `fields`, and shows the check's own label when
 * somebody hovers one of them.
 */
export interface ValidationFailure {
  check: ValidationCheck;
  /** The fields this check compared. What to highlight. */
  fields: string[];
  /** Set when the failure is on a line rather than the header. */
  line?: number;
  /** The offending value, where there is one: `"EURO"`. */
  value?: string;
  /** decision 0400 — see `ValidationSeverity`. */
  severity: ValidationSeverity;
}

/**
 * The positive twin of `ValidationFailure` — decision 0400.
 *
 * A check that ran and found nothing wrong for these fields. Kept
 * deliberately separate from `ValidationFailure` rather than a
 * `passed: boolean` on the same shape: `severity` only means something
 * for a failure, and a field this document never carried was never
 * "confirmed" anything — it was skipped, the same distinction `checked`
 * already draws for the check as a whole. No `value`, for the same
 * reason: there is no offending value to show.
 */
export interface ValidationConfirmation {
  check: ValidationCheck;
  fields: string[];
  line?: number;
}

export interface ValidationResult {
  passed: boolean;
  failures: ValidationCheck[];
  /**
   * Which codes were wrong, and where — decision 0116.
   *
   * `code_list` in `failures` says a code is invalid; this says
   * **which one**, because "BT-5=EURO" is actionable and "code_list"
   * is not.
   */
  invalidCodes?: string[];
  /**
   * Which **fields** each failure involves — decision 0119.
   *
   * `failures` is a list of check names, which is what a rule tests.
   * This is what a screen needs: `vat_arithmetic` cannot be pointed at,
   * but BT-106, BT-110 and BT-112 can be highlighted and explained.
   *
   * **Reported by each check rather than mapped afterwards.** A static
   * table of check-to-fields would be a second place the same knowledge
   * lived, and would drift the first time a check changed what it
   * compared.
   */
  involves?: ValidationFailure[];
  /**
   * Which **fields** a check ran against and found to agree — decision
   * 0400. The green tier needs the same "reported by the check itself"
   * discipline `involves` already has: a field is only ever marked
   * confirmed because the specific check that examined it said so, not
   * because nothing happened to flag it. Deliberately narrower than
   * `checked`: `total_missing` runs on every document and belongs in
   * `checked` the moment a total exists, but presence alone confirms
   * nothing about whether the value is *right* — so it produces no
   * confirmation, only the checks that compare a value against
   * something (another field, a code list, a linked purchase order) do.
   */
  confirms?: ValidationConfirmation[];
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

/**
 * Every coded field carrying a value the standard does not know —
 * decision 0116 — **plus the good ones**, decision 0400.
 *
 * **Only closed lists.** `isClosedList` distinguishes the standard in
 * full from a working subset (decision 0113): UN/ECE Recommendation 20
 * runs to hundreds of units and the vocabulary carries the common ones,
 * so a document using an unusual one is **unfamiliar, not
 * non-conformant**. Refusing it would reject valid invoices for using a
 * unit nobody anticipated.
 *
 * A field the document did not supply is not checked at all — absence
 * is a different failure, and `total_missing` already has it. One
 * entry per field rather than one for the check as a whole, so a
 * screen can highlight the right box and — new at decision 0400 — a
 * closed-list field present and valid is a genuine, per-field
 * confirmation: this check, unlike the arithmetic ones, examines every
 * coded field individually, so the green tier can be exactly as
 * precise as the warning one already is.
 */
function codeCheckDetails(
  facts: InvoiceFacts,
  lines?: readonly LineForValidation[]
): { bad: ValidationFailure[]; good: ValidationConfirmation[] } {
  const bad: ValidationFailure[] = [];
  const good: ValidationConfirmation[] = [];

  const check = (source: Record<string, unknown>, line?: number) => {
    for (const field of Object.keys(FIELD_CODE_LISTS)) {
      if (!isClosedList(field)) continue;
      const value = source[field];
      if (value === undefined || value === null || value === "") continue;
      if (!isValidCode(field, value)) {
        bad.push({ check: "code_list", fields: [field], value: String(value), severity: "warning", ...(line ? { line } : {}) });
      } else {
        good.push({ check: "code_list", fields: [field], ...(line ? { line } : {}) });
      }
    }
  };

  check(facts as Record<string, unknown>);
  for (const [index, line] of (lines ?? []).entries()) {
    check(line as Record<string, unknown>, index + 1);
  }
  return { bad, good };
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function close(a: number, b: number, tolerance: number): boolean {
  return Math.abs(a - b) <= tolerance;
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
  lines?: readonly LineForValidation[],
  settings: ValidationSettings = { currencyTolerance: CURRENCY_TOLERANCE },
  // True when more lines existed than were captured. The line-sum
  // check must not run against a deliberately capped list: the
  // shortfall is expected, and comparing it to a stated total would
  // report a mismatch that says nothing about the document.
  linesTruncated = false
): ValidationResult {
  const tol = settings.currencyTolerance;
  const failures: ValidationCheck[] = [];
  const checked: ValidationCheck[] = [];

  /**
   * Each failure with the fields it compared — decision 0119.
   *
   * Recorded **beside** the check that produced it, so the two cannot
   * disagree about what was looked at.
   */
  const involves: ValidationFailure[] = [];
  /** The positive twin, decision 0400 — see `ValidationConfirmation`. */
  const confirms: ValidationConfirmation[] = [];
  const fail = (
    check: ValidationCheck,
    fields: string[],
    severity: ValidationSeverity,
    extra: Partial<Omit<ValidationFailure, "check" | "fields" | "severity">> = {}
  ) => {
    failures.push(check);
    involves.push({ check, fields, severity, ...extra });
  };
  const confirm = (check: ValidationCheck, fields: string[], extra: Partial<Omit<ValidationConfirmation, "check" | "fields">> = {}) => {
    confirms.push({ check, fields, ...extra });
  };

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
    // The total is the field that is absent; the amount due is the one
    // somebody might supply instead.
    fail("total_missing", ["BT-112", "BT-115"], "warning");
  }
  // No confirm() on pass — presence is not agreement. This check never
  // compares BT-112 against anything else, so a total being there says
  // nothing about whether it is *right*, only that it is not absent.

  // net + VAT should equal the total. Skipped unless all three are
  // present, since two of three proves nothing.
  if (net !== null && vat !== null && total !== null) {
    checked.push("vat_arithmetic");
    // All three, because any one of them could be the wrong one and
    // the check cannot know which.
    if (!close(net + vat, total, tol)) fail("vat_arithmetic", ["BT-106", "BT-110", "BT-112"], "warning");
    else confirm("vat_arithmetic", ["BT-106", "BT-110", "BT-112"]);
  }

  // The amount due normally equals the total. A legitimate part
  // payment or credit makes them differ, so this is reported as a
  // discrepancy worth a human's attention, never as proof of an
  // error — which is precisely why this module flags and a rule
  // decides.
  if (due !== null && total !== null) {
    checked.push("amount_due_mismatch");
    if (!close(due, total, tol)) fail("amount_due_mismatch", ["BT-115", "BT-112"], "warning");
    // A pass here is a genuine agreement between the two numbers,
    // whatever the caveat above says about what a *failure* proves —
    // that caveat is about the false-positive risk of a legitimate
    // part payment, not about whether two equal numbers really agree.
    else confirm("amount_due_mismatch", ["BT-115", "BT-112"]);
  }

  // An issue date after its own due date is always wrong.
  const issued = typeof facts["BT-2"] === "string" ? Date.parse(facts["BT-2"]) : NaN;
  const dueDate = typeof facts["BT-9"] === "string" ? Date.parse(facts["BT-9"]) : NaN;
  if (!Number.isNaN(issued) && !Number.isNaN(dueDate)) {
    checked.push("date_order");
    if (issued > dueDate) fail("date_order", ["BT-2", "BT-9"], "warning");
    else confirm("date_order", ["BT-2", "BT-9"]);
  }

  // The lines should sum to the stated net. Only runs when lines were
  // genuinely supplied AND every one of them carries an amount — a
  // partial set would produce a mismatch that says nothing about the
  // document, only about what was captured from it.
  if (lines && lines.length > 0 && !linesTruncated) {
    const amounts = lines.map((line) => num(line["BT-131"]));
    if (amounts.every((a) => a !== null)) {
      const sum = (amounts as number[]).reduce((acc, a) => acc + a, 0);
      const against = net ?? total;
      if (against !== null) {
        checked.push("line_sum");
        // The header total the lines disagree with, and the line
        // amounts themselves — highlighted on every line, since any of
        // them could be wrong.
        const sumFields = [net !== null ? "BT-106" : "BT-112", "BT-131"];
        if (!close(sum, against, tol)) fail("line_sum", sumFields, "warning");
        else confirm("line_sum", sumFields);
      }
    }
  }

  /**
   * The coded fields — decision 0116, plus the confirmed ones,
   * decision 0400.
   *
   * **Always checked**, unlike the arithmetic: those need data the
   * document may not carry, and this one runs whether or not a coded
   * field is present. A document with no coded fields at all passes it
   * honestly, having genuinely been checked.
   */
  checked.push("code_list");
  const { bad: badCodeEntries, good: goodCodeEntries } = codeCheckDetails(facts, lines);
  if (badCodeEntries.length > 0) {
    failures.push("code_list");
    // One entry per bad code rather than one for the check, so a
    // document with two of them highlights two fields and explains
    // each — "code_list" once would point at neither.
    for (const bad of badCodeEntries) involves.push(bad);
  }
  for (const good of goodCodeEntries) confirms.push(good);
  const invalidCodes = badCodeEntries.map((entry) => {
    const where = entry.line ? `line ${entry.line}: ` : "";
    return `${where}${entry.fields[0]}=${entry.value}`;
  });

  /**
   * A field that disagrees with a linked purchase order — decision
   * 0400. Reads po.matched/po.variance_pct (header) and
   * po.line_matched/po.line_variance_pct/po.line_quantity_variance_pct
   * (per line) off what this function was given; both are already
   * computed and merged in by the caller (`mergePoMatchFacts`) before
   * this runs, the same way `supplier.amountTolerancePct` already is
   * by the time po-matching.ts reads it.
   *
   * **Checked only when a real order was actually compared against.**
   * `po.matched` is `false` for "no order was ever named" exactly as
   * much as for "a named order genuinely disagrees" (po-matching.ts's
   * own deliberate choice) — treating every `po.matched === false` as
   * a failure would flag almost every invoice, since most carry no
   * purchase order at all. `po.variance_pct` is only ever set once a
   * real order was found and a real number compared, so its presence
   * is what distinguishes "nothing to check" from "checked and
   * disagreed" — the same shape every other check here already skips
   * on when its own data is missing.
   */
  const poFailures: ValidationFailure[] = [];
  const poConfirms: ValidationConfirmation[] = [];
  let poChecked = false;

  const headerVariance = num(facts["po.variance_pct"]);
  if (headerVariance !== null && typeof facts["po.matched"] === "boolean") {
    poChecked = true;
    const fields = ["BT-13", "BT-112"];
    const value = `${headerVariance.toFixed(2)}%`;
    if (!facts["po.matched"]) poFailures.push({ check: "po_mismatch", fields, value, severity: "danger" });
    else poConfirms.push({ check: "po_mismatch", fields });
  }

  for (const [index, line] of (lines ?? []).entries()) {
    const lineVariance = num(line["po.line_variance_pct"]);
    if (lineVariance === null || typeof line["po.line_matched"] !== "boolean") continue;
    poChecked = true;
    // Both fields, when quantity was genuinely part of the comparison
    // — either could be the one that disagreed, the same "any of them
    // could be wrong" reasoning vat_arithmetic already uses for its
    // own three fields.
    const fields = num(line["po.line_quantity_variance_pct"]) !== null ? ["BT-131", "BT-129"] : ["BT-131"];
    const lineNumber = index + 1;
    if (!line["po.line_matched"]) {
      poFailures.push({ check: "po_mismatch", fields, line: lineNumber, value: `${lineVariance.toFixed(2)}%`, severity: "danger" });
    } else {
      poConfirms.push({ check: "po_mismatch", fields, line: lineNumber });
    }
  }

  if (poChecked) checked.push("po_mismatch");
  if (poFailures.length > 0) {
    failures.push("po_mismatch");
    for (const entry of poFailures) involves.push(entry);
  }
  for (const entry of poConfirms) confirms.push(entry);

  return {
    passed: failures.length === 0,
    failures,
    checked,
    // Omitted when empty, so a caller sees the field only when there is
    // something to read in it.
    ...(invalidCodes.length > 0 ? { invalidCodes } : {}),
    ...(involves.length > 0 ? { involves } : {}),
    ...(confirms.length > 0 ? { confirms } : {}),
  };
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


/**
 * Merges a SECOND validation result — the state after rules have
 * corrected the facts — decision 0051.
 *
 * Kept alongside the original rather than replacing it. Both
 * questions are worth answering and they are different questions:
 * "did this document arrive sound?" is what an auditor asks about
 * the supplier, and "is what we stored sound?" is what the finance
 * team acts on. Replacing the first with the second would lose the
 * fact that a document arrived broken, which for a regulatory system
 * is the more consequential of the two.
 *
 * Only present when a rule actually changed something. An invoice no
 * rule touched has one validation state, not two saying the same
 * thing — and a field that exists only sometimes is more honest than
 * one that duplicates its neighbour whenever nothing happened.
 */
export function mergeRevalidationFacts(facts: InvoiceFacts, result: ValidationResult): InvoiceFacts {
  return {
    ...facts,
    "validation.passedAfterRules": result.passed,
    "validation.failuresAfterRules": result.failures.join(","),
  };
}
