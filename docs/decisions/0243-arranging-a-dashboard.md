# 0243 — Arranging a dashboard

**Status: built.** A person chooses their own cards.

---

## The whole set, not one card

Adding, removing and reordering are **three verbs over one list**, and
three endpoints would each have to renumber the positions afterwards —
which is exactly where migration 0056's one-position-per-person
invariant would break.

So the browser sends what it wants the dashboard to be, and the route
writes it.

**Replace, not merge**, which decision 0211 chose for the supplier load
and for the same reason: **a person who removed a card expects it gone**,
and merging would make removal the one act the interface could not
perform.

---

## Deleting is the reset

Decision 0240 gives a person with no rows the default set **without
writing it**, so removing everything is exactly *"start again"*.

**A separate reset that wrote the default back would freeze today's
one into their account** — the thing that record avoided.

---

## Arranging is a mode, not a screen

The cards stay where they are and gain a handle.

**A separate settings page would make a person choose blind**, and the
whole question is *"do I want this one here."*

**No handles until asked**, which is decision 0161's argument about the
unreadable notice: a control with nothing to do should not be there.

---

## A stage that never existed is refused

The card copes with a stage that **disappears later** — decision 0240
reports `missing` and says so on screen rather than showing a zero.

**That is a different thing from one that never existed**, and saving it
would mean reporting the same fault on every load for a mistake made
once.

---

## And the picker shows what each card does

Nine names in a list say nothing about which one somebody wants, so
every type has two strings: **what it is called, and what it shows.**

**The stages come from the database.** Decision 0239's whole argument
was that a hardcoded six would be wrong for the second customer, and a
picker offering *Validation* and *Approval* by name would have put it
back.

---

## What is not built

- **No drag.** Up and down arrows, which work and are not what anybody
  expects of a dashboard in 2026.
- **No shared defaults.** Decision 0239 deferred a per-role dashboard as
  a second concept, and it still is.
- **A ceiling of twenty cards**, which is not an answer to decision
  0239's question — *how many before it stops helping* — so much as a
  refusal to let it be unbounded.
- **Still no history and no flow metrics**, which are the same two gaps
  decision 0242 recorded.
