# 0167 — A document is not always work

**Status: fixed.** The viewer opens for an invoice nobody has a task
for.

---

## A blank page

> On the documents page, if I click expand, it does not open the view,
> but a completely blank page.

Decision 0165 made the panes swap. **This is what was behind them.**

The viewer was written for a **task**, and reads four things from one:
the subject, the stage, `createdAt` and `ownership`. The document
manager hands it an invoice nobody is working on, which has the first
two and neither of the last.

`waited(undefined)` calls `.replace` on nothing and throws. The render
stopped mid-way, so the pane swapped and showed nothing.

---

## Omitted, not filled in

*"Waiting 0h"* about a document nobody is waiting on would be **a fact
invented to fill a row**, and *"Owner: unassigned"* is worse — it
implies somebody should be.

A document that is not work simply does not report how long it has been
waiting or who owns it, because neither is true of it.

---

## The third time this shape has appeared today

Decision 0164 assumed `openViewer` could be called; decision 0165 found
it needs its panes shown; this one finds it needs a task's own fields.

**Each was invisible until a second caller existed.** A function with
one caller cannot distinguish what it requires from what that caller
happens to provide, and every assumption looks like a fact.

The right answer is still the one decision 0165 named: `openViewer`
should own its visibility, and should take **a document and an optional
task** rather than a task that might not be one.

---

## What is not built

- **The viewer's contract is still implicit.** Nothing declares which
  fields it requires, so a fourth caller will find the fourth
  assumption.
- **A document with no task shows the keying form**, read-only where
  the stage says so and read-only everywhere once it has left its
  process (decision 0164) — but the form is still the shape of work
  somebody is doing rather than a record somebody is reading.
