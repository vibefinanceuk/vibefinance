# 0051 — Validation before and after rules

Status: built, 3 September 2026.

## The problem, seen live

A rule corrected a fabricated total from 2,272.47 to 3,137.47. The
stored invoice was right; `validation.passed` still said `false`,
citing a failure the correction had addressed.

Validation runs at the start of a stage visit, before any rule fires.
So the verdict described the document as it *arrived*, and the invoice
on file was no longer that document. Any rule testing
`validation.passed` downstream would see stale information about a
value that had since changed.

## Both states are kept

The operator's call, and the right one. Two readings were available
and both are defensible:

- **What arrived** — honest about provenance, but the stored invoice
  ends up valid while flagged invalid.
- **What we ended up with** — useful downstream, but loses the fact
  that the document arrived broken.

Keeping both discards nothing. `validation.passed` describes the
document as received and never changes. `validation.passedAfterRules`
describes what was actually stored.

They answer genuinely different questions: *"did this document arrive
sound?"* is what an auditor asks about a supplier, and *"is what we
stored sound?"* is what the finance team acts on. Collapsing them
would answer one at the cost of the other — and for a regulatory
system, losing the record that a document arrived broken is the more
consequential loss.

Watched to fail: replacing the arrival verdict instead of adding to it
breaks its test.

## Three details

**Present only when a rule changed something.** An invoice nothing
touched has one validation state, not two saying the same thing. A
field that exists only sometimes is more honest than one duplicating
its neighbour whenever nothing happened — and `NULL` is a real answer
here, not a gap.

**Recorded, never re-evaluated.** The second validation produces facts
and does not trigger another rule pass. Allowing that would let rules
change facts that change validation that triggers rules — an ordering
problem with no obvious end, and the same reasoning that keeps
`set_field` from feeding back into its own evaluation.

**Header scope only.** A per-line evaluation's facts are one line's,
not the invoice's.

Four standing invariants on `stage_visits`, three watched to fail: the
after-columns move together, the verdict is a real boolean, a passing
verdict carries no failures, and an after-verdict never exists without
an original.

## What it showed immediately

On the real Morrison invoice, the second verdict still fails —
correcting `BT-112` left `BT-106` and `BT-115` untouched, and the
lines still carry a phantom row.

That is the mechanism working: a rule did exactly what it was told,
and validation reports honestly that the result does not yet hang
together. A single-field resolution rule is rarely enough, and now
that is visible rather than assumed.

## What's still open

- **The phantom line.** Page 2 has no line table and reports one row
  carrying the document total. `lineCount: 9` against eight real
  charges, so `line_sum` cannot pass regardless of the totals.
- Whether a rule should be able to test `validation.passedAfterRules`
  in the *same* visit that produced it. Currently it cannot, by
  design — the fact exists only after evaluation has finished.
