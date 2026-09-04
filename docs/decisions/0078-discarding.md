# 0078 — Discarding

**Status: built.** The third outcome decision 0055 section 5.2 named, and
the last one missing.

---

## Not the same as returning to a supplier

Decision 0055 section 5.4 defined **two** terminal states, and was
explicit about why:

| State | Means |
| --- | --- |
| `returned_manually` | A person has taken responsibility and contacted the sender |
| `archived` | The matter is closed; nobody needs to look again |

Decision 0075 built the first. This is the second.

Collapsing them would lose the distinction between *"somebody is dealing
with this"* and *"nothing further is needed"* — which is precisely the
open-items question a queue exists to answer. A duplicate, a statement
that is not an invoice, a scan of somebody's lunch receipt: these are
closed, not pending contact with anybody.

---

## Its own permission

`AP.Discard`, the same shape as `AP.Return` and `AP.ReturnToSupplier` —
the capability, plus the stage's own permission, plus holding the task,
with `AP.ReturnAny` overriding ownership only.

Decision 0055 section 5.5 argued for this and it still holds: **keying
introduces facts, discarding closes the matter.** Somebody trusted to
transcribe an amount is not automatically somebody who decides an
invoice never needs looking at again.

A reason is required for a sharper version of the usual argument:
*"nobody needs to look at this again"* is a claim that should carry an
explanation, precisely because nobody will.

---

## Nothing is deleted

The invoice, its facts, its retained original, every task that touched
it and every stage visit all remain. Only the instance stops being
somebody's problem.

**A regulated system that lets a person delete a document has lost the
argument before it starts.** A test asserts the row counts are unchanged
afterwards.

---

## The mistake this record exists to correct

The first version reused the `returned` task state, because discarding
shares the code path that ends a task and cancels its siblings.

**Nothing goes back when a document is discarded.** A task marked
`returned` whose document was archived tells whoever reads it later that
somebody sent the invoice somewhere, and nobody did.

Worse: the test written alongside it **asserted the wrong behaviour**,
which is worse than no test — it would have defended the mistake against
anyone who later noticed and tried to fix it.

Migration 0033 adds `discarded` as a fifth task state. The instance
status already distinguishes the two outcomes, but a task is the
operator-facing unit, and *"why did this task end without being
completed"* should be answerable from the task.

### The rebuild

SQLite cannot alter a `CHECK` in place, so `tasks` was rebuilt. That is
the riskiest operation in this project so far, and it was verified
directly rather than trusted: a populated database was run through the
migration and every column, both foreign keys and the constraint were
checked on the far side.

The standing invariants from 0031 and 0008 are **restated** in 0033,
because the rebuild replaced the table they were written against. An
invariant that quietly stops applying is worse than one that never
existed — it reads as protection while protecting nothing.

---

## What this leaves

- **No un-archiving.** A discarded instance is terminal, and reversing
  it would need a decision about what that means for the tasks already
  ended. Nobody has asked yet.
- **`archived` and `returned_manually` are both terminal**, and nothing
  distinguishes them in a queue view — because there is no queue view.
  The distinction exists in the data, ready for one.
