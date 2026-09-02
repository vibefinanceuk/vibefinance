# Design: Line Extraction and Validation

Status: **the validation stage is built and verified live** (decision
0044). Line extraction and multi-page input remain designed only.
Written 2 September 2026, prompted by a real extraction failure.

## 1. The failure that prompted this

A freight forwarding invoice — two pages, eight charge lines, a
header dense with shipment references — was extracted. Everything
readable on page one came back correct, including the genuinely hard
parts: the invoice number picked out from four similar-looking
reference codes, and the client VAT number correctly distinguished
from the supplier's.

But no total is printed on page one. The totals are on page two,
which the model never saw.

The model reported `BT-112: 2797.47` anyway. The charge lines
actually sum to **3,137.47**. It attempted arithmetic, got it wrong
by exactly 340.00, and reported 0.9 confidence.

A fabricated total is worse than a missing one. A missing total is
visible and actionable; a wrong one is neither.

## 2. The boundary, stated once

Two steps, two jobs, and keeping them apart is what makes both
tractable:

| Step | Job | Nature |
|---|---|---|
| Extraction | Report what is printed on the page | Inferred, best-effort |
| Validation | Decide whether those numbers hang together | Deterministic, exact |

Everything below follows from that split. The extractor never
calculates, never compares, and never judges — it transcribes.
Tolerances, arithmetic checks, and what counts as a failure all live
in validation, where they can be answered exactly and the same way
every time.

## 3. Where validation belongs

The instinct to make the extractor smarter is wrong, and the
operator's own framing is better: **the extractor transcribes, a
later stage validates.**

That is consistent with everything else here. Deterministic checks
belong in the platform, not in a model's judgement. Whether
`BT-106` equals the sum of its lines is arithmetic the system can do
exactly, every time, with no inference at all.

`validation.passed` has been in the closed vocabulary since the
beginning, typed as a boolean, described as *"true if the document
passed standard validation"* — and nothing has ever set it. Exactly
the situation `'warned'` was in before decision 0040.

## 4. But the extractor must stop guessing first

Validation needs something truthful to validate against. If the
extractor invents a total, validation compares a fabricated number
against lines that were never captured, and has no way to know the
number was never on the page.

So the change to the extractor is small but necessary, and the reason
is different from "the total is unreliable":

**A fabricated value and a transcribed one are indistinguishable
downstream.** Returning null when nothing is printed makes "no total
stated" a real, legible state. Returning a guess destroys that
distinction permanently.

The prompt currently says a printed total is *preferable* to a
calculated one. That is too weak. It should forbid calculation
outright: report only what is printed.

This is not the extractor taking on a validation role. It is the
opposite — the extractor doing *less*, and confining itself to
transcription. Deciding whether the numbers on a page hang together
is a separate question, asked later, by something that can answer it
exactly.

## 5. Line-level extraction

Validating a total against its lines requires the lines. Today only
document-level fields are extracted from an image.

`invoice_lines` already exists — `line_number`, `description`,
`amount`, `cost_centre`, `facts_json` — and is populated by the UBL
path. The storage needs nothing.

### The shape of the ask

An array in the same response, not a second model call. The model is
already looking at the table; asking separately would cost another
inference and risk the two disagreeing.

```
lines: [
  { description: "International Freight", amount: 1797.47 },
  { description: "Destination Terminal Handling", amount: 275.00 },
  ...
]
```

Deliberately minimal. Quantity and unit price are common on product
invoices and absent on this one; starting with description and amount
covers the validation case and can extend later.

### Open: how many lines is too many

An invoice with sixty lines would produce a long response and risk
truncation — the `max_tokens` failure decision 0002 already recorded
once. A cap with an explicit "there were more" signal is probably
right, but the threshold should come from measurement rather than a
guess.

## 6. The validation stage

A process stage whose job is checking internal consistency, running
after extraction and before approval.

### What it checks

| Check | Rule |
|---|---|
| Line sum | `BT-106` equals the sum of line amounts, within rounding tolerance |
| VAT arithmetic | `BT-106 + BT-110 = BT-112` |
| Amount due | `BT-115` equals `BT-112` unless a part payment is stated |
| Date order | `BT-2` is not after `BT-9` |
| Presence | The fields a customer considers mandatory are present |

Each is deterministic. None involves a model.

### How results reach rules

`validation.passed` becomes a real derived fact, set by this stage,
so customers write rules against it exactly as they do any other
field: *"if validation has not passed, assign a task to the AP
team"*.

A single boolean is not enough on its own, though. *Which* check
failed matters — a date-order problem and a total mismatch warrant
different handling. A parallel `validation.failures` field, listing
the failed check names, lets a rule test for a specific failure while
keeping the simple boolean for the common case.

### Tolerance

Floating-point sums of currency values do not compare exactly:
`1797.47 + 275.00 + ...` yields `3137.4700000000003`, and a naive
equality check against a stated `3137.47` fails on a document that is
perfectly correct.

Tolerance belongs here and nowhere else. It is a property of the
*check*, not of the reading — the extractor has no business knowing
what counts as close enough, and building that knowledge into it
would smear a validation concern across a transcription step.

Explicit and named, not a magic number inside a comparison.

### What a failure does

Nothing, by itself. The stage records the result; a rule decides what
happens. That preserves the existing separation — the platform
computes facts, customers decide policy — and avoids this stage
quietly becoming a second, hidden rule engine.

## 7. Multi-page documents

The invoice that prompted this is page 1 of 2, and its totals are on
page 2. Nothing in the system acknowledges that a document might have
more pages.

Worth stating plainly: **this design does not solve it.** Line
extraction and validation both operate on what was captured, and if
page two was never submitted, the lines are incomplete and validation
will correctly report a mismatch it cannot explain.

That is still better than today — a mismatch is visible where a
fabricated total is not — but the real fix is accepting multi-page
input, which needs its own design. The honest interim behaviour is
for validation failures to be legible enough that "you only sent us
half the invoice" is a conclusion a human can reach quickly.

## 8. Build order

1. **Extractor stops calculating.** Smallest change, immediate
   benefit: no more fabricated totals. Independent of everything
   else.
2. **Line extraction.** Populates `invoice_lines` from images.
3. **The validation stage.** Needs 2 for the line-sum check; the
   other checks work without it.
4. **Multi-page input.** Its own design.

Step 1 is worth doing on its own regardless of whether the rest
follows.

## 9. Open questions

1. Line cap, and what a truncated line list should report.
2. Tolerance: a fixed platform constant, or per-customer
   configuration? Fixed is simpler and probably right to start, and
   either way it lives in the validation stage.
3. Should `validation.failures` be a list of check names, or
   something richer? A list is simpler and rule-friendly; anything
   richer risks becoming a second vocabulary.
4. Does the validation stage need its own worked-example discipline?
   Probably not — every check is deterministic, so the argument that
   justified it for compiled rules does not apply here.
5. Should validation run automatically at intake, or only as an
   explicit process stage? Automatic is convenient; explicit is
   consistent with how every other stage works.
