# 0048 — A page conflict raises a task, it does not resolve itself

Status: built, 3 September 2026.

## What happened

The first working multi-page run produced a real disagreement:

```
BT-112: chosen 2272.47 (page 1), other 3137.47 (page 2)
```

Page 1 **fabricated** a total printed nowhere on it. Page 2 read the
real 3,137.47 from the totals block. The merge's "first page wins"
rule kept the fabrication, and reported the conflict.

Page 2 also returned one line item where it has no line table at all,
concatenated onto page 1's eight — the same inconsistent
instruction-following recorded in 0045.

## The fix that was rejected

A defensible platform default was available: where lines exist and one
candidate value matches their sum, prefer it. Page 2's 3,137.47 matches
the extracted lines exactly; page 1's 2,272.47 does not. That is
arithmetic, not policy, and it would have picked correctly here.

**It was rejected, and the operator's reasoning is better than the
fix.** Resolving the conflict silently would hide the signal
entirely. Nobody would ever see that two pages disagreed, so nobody
would ever configure a rule for a supplier whose documents do this
every time.

> *"This would be their trigger to talk to the business analyst / IT
> team and add another configuration / extraction rule for this
> invoice type."*

The manual task is not a workaround for a missing rule. **It is the
mechanism by which the need for a rule becomes visible.** A person
resolving the same conflict a third time is the prompt to go and
configure it properly.

## What was built

Two new derived facts, following exactly the pattern
`validation.failures` established:

- **`extraction.conflicts`** — a comma-separated list of fields whose
  pages disagreed, empty when none did. A string rather than an array
  so the interpreter's existing `contains` operator works:
  *"if extraction.conflicts contains BT-112, assign a task to the AP
  team"*. No new operator, no new concept.
- **`extraction.pagesFailed`** — how many pages could not be read at
  all. A missing page is often exactly why a total does not match its
  lines.

The merge itself is unchanged. It still keeps the first page's value
and still reports the disagreement; what is new is that a rule can now
see it.

Tested end to end: a rule fires on any conflict, on a *specific*
conflicting field, and on a failed page — and correctly does not fire
when the pages agreed.

## Why this is the right shape

It needed no new machinery. Conflicts become facts, rules test facts,
rules raise tasks — the architecture already in place, doing what it
was designed for.

And it preserves the separation that runs through the whole system:
the platform computes facts, customers decide policy. "Prefer the
value matching the line sum" is a reasonable policy, and it is
*theirs* to choose, not the platform's to assume.

## What's still open

- **Extraction rules** would let a customer express the resolution
  directly — *"for invoices from Morrison Express, use the total that
  sums the lines"*. That is the largest unbuilt piece of the
  extraction design, and conflict resolution has a shape the current
  rule engine does not: it needs to see both candidate values and
  their pages, not just a merged fact set.
- The underlying cause is unfixed: the model calculates totals it was
  told not to, inconsistently. 0045 records that a prompt instruction
  is not a safety property; this is the same finding producing a
  different symptom.
