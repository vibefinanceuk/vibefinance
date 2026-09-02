# 0044 — Validation, and making `validation.passed` real

Status: settled, 2 September 2026. The design is in
`docs/design/validation.md`; this records what was built and why the
shape is as it is.

## The failure that prompted it

A freight forwarding invoice, two pages, eight charge lines. Page one
prints no total — the totals are on page two, which the extraction
model never saw. It reported `BT-112: 2797.47` anyway. The lines
actually sum to 3,137.47. It calculated, got it wrong by exactly
340.00, and reported 0.9 confidence.

The extractor no longer calculates. But that fix, on its own, made
things arguably worse: an invoice with **no total at all** then ran
clean through `approval` to `payment-eligible`, unchallenged. A
fabricated total was at least being *evaluated*; a missing one was
being ignored.

This closes that.

## The boundary

The operator's own framing, and better than the first instinct:
**extraction transcribes, validation decides.**

| Step | Job | Nature |
|---|---|---|
| Extraction | Report what is printed | Inferred, best-effort |
| Validation | Decide whether the numbers hang together | Deterministic, exact |

Every check here is arithmetic or presence. No model, no inference,
no confidence score — there is nothing to be uncertain about, which
is the entire reason for doing it here rather than asking a model to
be careful.

That split is also what makes the extractor's "never calculate" rule
coherent rather than arbitrary: a fabricated value and a transcribed
one are indistinguishable downstream, so the transcription step has
to stay pure for the checking step to mean anything.

## A fact-producing agent, not a new concept

Decision 0015 already established the pattern: *"agents run first,
producing derived facts; the stage's rules then evaluate against
native plus derived facts."*

`validateInvoiceFacts` runs once at the start of a stage visit, and
its results become real facts every stage then sees. Computed once
per visit rather than per stage, so every stage evaluates against the
same validation state rather than a shifting one.

## `validation.passed` was declared and never set

It has been in the closed vocabulary since the first migration —
typed as a boolean, described as *"true if the document passed
standard validation"* — and nothing ever set it. Exactly the
situation `'warned'` was in before decision 0040. Two capabilities
now, fully plumbed and dormant, that turned out to need only a
producer.

## Three decisions worth recording

**`validation.failures` is a string, not an array.** A customer needs
to test for a *specific* failure — a date-order problem and a total
mismatch warrant different handling. Comma-joining the check names
means the interpreter's existing `contains` operator works directly:
*"if validation.failures contains total_missing, assign a task to the
AP team"*. An array would have needed a new operator and a new
concept for no real gain.

**`checked` is tracked separately from `failures`.** A check that
could not run is neither a pass nor a failure. The line-sum check
needs lines, and line-level extraction from an image is not built —
so today it usually cannot run at all. Conflating "we checked and it
was fine" with "we could not check" would make `validation.passed`
mean less than it appears to. Watched to fail: treating un-runnable
checks as runnable breaks seven tests.

**Tolerance is a validation concern and lives nowhere else.**
Floating-point sums of currency do not compare exactly — the eight
lines on the invoice that prompted this sum to `3137.4700000000003`,
and a naive equality check against a printed `3137.47` would fail a
perfectly correct document. `CURRENCY_TOLERANCE` is a penny, named
and exported rather than buried in a comparison. It is deliberately a
fixed platform constant: configuration can be added when a real
customer needs a different value, and inventing the knob first would
be guessing at a requirement nobody has stated.

## What a failure does

Nothing, by itself. This module records the result; a rule decides
what happens. That preserves the existing separation — the platform
computes facts, customers decide policy — and stops this becoming a
second, hidden rule engine with its own opinions about what should
block an invoice.

## What's still open

- **Line extraction from images.** The line-sum check exists and is
  tested, but cannot run on an image-extracted invoice because the
  lines are never captured. The UBL path supplies them today.
- **Multi-page documents.** The invoice that prompted this is page 1
  of 2. Validation will correctly report a mismatch it cannot
  explain, which is better than a fabricated total but is not a
  solution. Accepting multi-page input needs its own design.
- **Mandatory-field checks.** Named in the design, not built —
  "mandatory" is per-customer configuration that does not exist yet.
- **Whether validation should also run at intake**, rather than only
  during a stage visit. Explicit is consistent with how every other
  stage works; automatic would be convenient. Unresolved.

---

## Addendum — persisting the result

Found the moment it mattered, live. Establishing whether a real
invoice had passed validation required joining `stage_visits` to
`stage_visit_steps`, reading which rule id had matched, and looking
that rule up to infer what it must have tested.

That is detective work. For a regulatory product, *"why was this
invoice held?"* should be answerable directly from the record.

Validation results were computed at the start of a stage visit,
handed to rule evaluation as derived facts, and discarded. The rules
saw them; nothing else ever did.

`stage_visits` now carries `validation_passed`,
`validation_failures` and `validation_checked`.

**On the visit, not the invoice.** Validation describes a *moment* of
evaluation, not a permanent property of a document. The same invoice
re-visited after a correction produces a second row with its own
result, and both survive — which is exactly the history an audit
needs, and exactly what writing onto `invoice_headers` would destroy
by overwriting. Tested directly: two visits, two verdicts, both
retained.

**Recorded only for rule-evaluating stages.** An automatic stage
never consults validation, so claiming a result there would assert
something that did not happen. Those rows stay NULL.

**All three columns are nullable, and NULL means "not recorded".**
Every row predating this migration has no honest value to backfill,
and NULL is genuinely different from "passed". Inventing a value
would be the same fabrication this whole decision exists to prevent.

Four standing invariants, each watched to fail: the columns move
together, the verdict is a real boolean, a failure list never appears
without a verdict, and a passing verdict never carries failures. The
last would catch a genuine bug — verdict and list come from the same
result object, so any disagreement means they were written from
different sources.

---

## Addendum 2 — line extraction, and the check that could finally run

The `line_sum` check existed and was tested from the start, but could
not run on an image-captured invoice: only document-level fields were
extracted, so there were no lines to sum. It was live code that had
never executed against real input.

Lines are now asked for in the same model call as everything else —
not a second one. The model is already looking at the table, and a
separate inference would cost another round trip and risk the two
disagreeing about the same document.

**In the canonical shape, deliberately.** A line is
`InvoiceFacts & { lineNumber }` with the amount under `BT-131` —
exactly what the UBL path produces. The codebase already carries a
comment recording that passing raw, differently-shaped lines around
caused a real bug once, so inventing a bespoke `{description,
amount}` shape here would have been repeating it.

**No Business Term for the description.** `BT-153` exists in EN
16931, but adding it to the closed vocabulary purely to carry text no
rule tests would widen the vocabulary for nothing — and
`invoice_lines` already has its own `description` column. Kept under
a plain key, which flows to storage without pretending to be a
Business Term.

That surfaced a small pre-existing gap: `toStorageLine` never mapped
the description to its column, so it sat in `facts_json` while the
column stayed null. Fixed, and left in the fact set too, so what a
rule sees is unchanged.

**A partial line list is discarded entirely.** If any line's amount
cannot be coerced, no lines are stored. The line-sum check compares
against a stated total, and a partial sum would produce a
confident-looking mismatch that reflects only what was captured, not
the document. Better no lines than misleading ones.

**Truncation is reported, never silent.** `MAX_EXTRACTED_LINES` is 50
— a deliberate guess, recorded as such rather than presented as
measured. It comfortably covers the invoices seen so far while
staying inside the token budget, and should be revisited against a
genuinely long invoice rather than trusted because it is written
down. Exceeding it sets `linesTruncated` on the response.

The original failure now has a test that reconstructs it directly: a
fabricated `2797.47` against eight lines summing to `3137.47`, caught
as a `line_sum` failure and recorded on the stage visit.
