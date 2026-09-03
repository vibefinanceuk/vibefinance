# 0050 — Exposing the other page's value

Status: built, 3 September 2026. Completes what 0048 and 0049 started.

## The gap, found by using it

Decision 0048 made conflicts visible as facts. Decision 0049 gave
rules a way to change a field. Together those should let a customer
resolve a page disagreement — and a live test showed they did not.

The rule written was *"if extraction conflicts contains BT-112, set
BT-112 to the net total before VAT"*, compiling to
`{ field: "BT-112", fromField: "BT-106" }`. Correct-looking, and
wrong: **`BT-106` was in conflict too**, and first-page-wins had given
it the same fabricated value. The rule would have replaced one
fabrication with itself.

It did not, because the no-op guard suppressed a change that changed
nothing — the invariant doing its job, and the only reason this was
visible at all rather than silently producing a wrong total.

The real gap: `extraction.conflicts` names **which** fields
disagreed and never **what the alternative was**. A rule could see
that a conflict existed and had no way to reach the value it was
supposed to resolve to.

This was flagged when placement was first discussed — *"conflict
resolution needs to see both candidate values and their pages, not
just a merged fact set"* — and then not solved, because framing it as
ordinary Validation-stage rule work made it feel like it needed
nothing new. It mostly did not. This is the one piece that did.

## What was added

`extraction.alternative(BT-112)` — a **parameterised** derived field,
reusing the mechanism `term.absent(BT-n)` already established rather
than widening the vocabulary with one entry per possible conflict.

Present only for fields that genuinely disagreed, absent otherwise.
That absence matters: a rule copying from it when the pages agreed
changes nothing, rather than clearing a value that was never in
doubt. So the rule is safe to leave permanently active.

The resolution rule becomes:

> *"If extraction conflicts contains BT-112, set BT-112 to
> extraction.alternative(BT-112)"*

## Two deliberate limits

**Only the first alternative is exposed.** Every real case so far is
two pages disagreeing. A rule needing to choose among three readings
would need to see all of them, and that is a harder question than
this design should answer speculatively.

**Each parameterised prefix now has its own description.** Mapping
them all to one line was correct while `term.absent` was the only
one, and became wrong the moment a second existed —
`extraction.alternative` is not a presence test, and describing it as
one would guarantee the model misuses it. A small change that would
have been a real bug.

## What this completes

The arc the operator set out that morning:

1. Two pages upload, each extracted in its own request (0047)
2. One page fabricates a total, the other reads the printed one
3. The merge keeps the first and **reports** the disagreement (0048)
4. A rule raises a task, so a human sees it
5. Having seen it enough times, they write a rule that resolves it
6. `set_field` applies the resolution and records the change (0049)
7. The rule reaches the right value through this (0050)

Step 5 is the one that mattered. A platform default at step 3 would
have skipped straight to a correct answer and made steps 4 through 7
unnecessary — and nobody would ever have learned that Morrison
Express invoices do this every time.

## What's still open

- **Untested live.** The mechanism is covered end to end by tests;
  whether the compiler produces `extraction.alternative(BT-112)` from
  a natural-language sentence is unknown until it runs.
- Three-way conflicts.
- **Capture rules** — the other half of what "extraction rules"
  originally meant. Still designed-not-built, and now clearly a
  separate concern.
