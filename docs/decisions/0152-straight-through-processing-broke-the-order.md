# 0152 — Straight-through processing broke the order

**Status: fixed.** Visits are read in the order they happened, and
recorded precisely enough for that order to survive.

---

## What was seen

An invoice showing **Intake** as *"here since"*, Validation, Matching
and Coding empty, and **Approval** as *"under a minute"* — with Approval
marked as the current stage.

Reasonably asked as *"is this just bad data from early seeded items?"*

**No. A real bug, and straight-through processing is what exposes it.**

---

## One-second resolution

`stage_visits.created_at` defaults to `datetime('now')`, which records
**whole seconds**.

An invoice arriving by email passes Intake automatically and reaches
Approval in the same second. Both visits carry an identical timestamp:

```
24 | received | automatic | 2026-09-02 16:22:06
25 | approval | matched   | 2026-09-02 16:22:06
```

And the query read them `ORDER BY created_at, id` — so with the
timestamps equal, **it fell back to ordering by a UUID.** At random.

Half the time that gives the right answer. The other half, Approval is
read first: Approval is timed against Intake and gets *"under a
minute"*, Intake has nothing after it and reads *"here since"*.

**Exactly what was on the screen.**

---

## `rowid` is the order things happened

SQLite assigns it on insert, and **that is the actual sequence of
visits.** The timestamp is an approximation of it, and this is where the
approximation fails.

Ordering by `rowid` fixes every invoice already recorded, not just new
ones — which matters, because the visits above are real history that
nothing is going to re-run.

---

## And the timestamps are now precise enough to mean something

Insertion order fixes the sequence. It does not fix the **durations**: a
stage entered and left within one second reports *"under a minute"*,
which is true and says nothing.

All four inserts now supply `strftime('%Y-%m-%d %H:%M:%f', 'now')`
rather than taking the default — milliseconds, so an automatic path can
report what it actually cost.

Visits recorded before this carry second resolution and parse exactly as
well; the fractional part is simply absent.

---

## Why no test caught it

**Every existing test used distinct timestamps**, which is not how an
automatic path behaves. They described an invoice moving through stages
minutes apart, because that is how a person imagines a process — and the
system's own straight-through case never appeared.

The new test inserts two visits with **identical timestamps and ids
whose alphabetical order is the reverse of the visit order**, which is
what a UUID gives you half the time. Watched to fail: restoring the old
ordering reproduces the reported screen.

**A test that only describes the slow path proves nothing about the fast
one**, and the fast path is the one the product is for.

---

## What is not built

- **Nothing else orders by `created_at`.** Two other queries read
  `stage_visits`, both filtered to one stage, so the ordering does not
  arise — but neither is protected against it either.
- **`invoice_runs` and `stage_visit_steps` have the same default**, and
  the same one-second resolution, and nothing has asked them for an
  order yet.
- **The durations already recorded stay imprecise.** Millisecond
  timestamps apply from here; every visit before this is accurate to the
  second and will keep saying *"under a minute"*.
