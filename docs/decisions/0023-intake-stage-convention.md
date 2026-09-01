# 0023 — "Intake" as a recommended first stage, and real channel examples

Status: settled, 1 September 2026. A design conversation about
recording how something entered a process — surfaced two things
already sitting in this codebase (`mandate.channel`, and the fact
that `process_stages` never constrained stage names at all) rather
than requiring anything genuinely new to be built.

## "Intake" needs no new infrastructure

A process author can already create a stage literally named "Intake,"
first in sequence, today — `process_stages` has never constrained
stage names. What decision 0018/0019 already built is sufficient:
an automatic Intake stage records nothing and advances immediately;
a rule-bearing one could route based on channel once real document
ingestion exists. This decision records "Intake first" as a
**recommended convention**, not an enforced one — there is no closed
vocabulary of stage names in this system, and this decision doesn't
introduce one.

## A real, previously unflagged gap this surfaced, deliberately not closed here

Every closed-vocabulary check in this system validates *field names*
— never the *values* a condition compares against. `{field:
"mandate.channel", operator: "is", value: "Meilroom"}` — a typo —
would compile and validate cleanly today, then silently never match
anything. This is true for every field, including `direction` itself,
not something specific to channel fields. Raised explicitly and
**declined for now**: this decision keeps intake-channel fields as
free strings, the same "add now, unenforced, clearly flagged"
precedent already used for `invoice_lines.cost_centre`. Closed-value
enforcement — validating that a condition's *value*, not just its
*field*, belongs to a real defined set — remains a real, genuinely
new mechanism this codebase has never built, named here so the gap
isn't lost, not attempted.

## `mandate.channel` already was this field for AP and AR

Its description is enriched with real, concrete example values —
Email, Mailroom, EDI, Tax Authority, Supplier Portal (AP); Billing
System A, Billing System B, Order Fulfillment A, Order Fulfillment B
(AR) — rather than its previous generic "the e-invoicing
channel/mandate this document arrived through." Since the compiler's
prompt renders these descriptions verbatim, this is a genuinely
useful change on its own, independent of the Intake-stage
conversation that prompted it: the model now has real grounding for
what a realistic channel value looks like, without a closed list
constraining it. Confirmed directly, not assumed — a new test proves
`Mailroom` and `Billing System A` actually appear in the rendered
invoice prompt.

## Expense gets its own field, not a shared one

`mandate.channel` was not extended to Expense's vocabulary. Its own
name — "mandate" — is a specific e-invoicing term with no meaning for
an expense submission; reusing it across domains would be exactly the
sloppy, informal reuse `VOCABULARIES` (decision 0022) was built to
avoid. Expense gets its own analogous derived field, `intake.channel`
— Manual Entry, iPhone App, Corporate Card Feed — free string, same
non-enforcement. The iPhone App value is a real anticipated channel
with no ingestion mechanism behind it at all, listed now for the same
"add now, clearly flagged, unbacked" reason `AR_PERMISSIONS` and
`Expense.*` were both added before either had a real route — named
directly in the field's own description, not left implicit.

## What's still open

- Closed-value enforcement — the real gap named above, for any field,
  not just channel ones.
- Whether "Intake" should ever become an *enforced* convention (a
  standing invariant requiring sequence 1 to carry that name) rather
  than a recommended one — not proposed here, deliberately.
- The document ingestion path itself remains unbuilt (decisions
  0013/0015/0019's own long-standing gap) — an Intake stage is where
  it would eventually plug in, not a replacement for building it.
