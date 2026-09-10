# 0200 — A stage declares its permission

**Status: built.** A stage may say who works there, and a rule
disagreeing with it is refused.

---

## The vocabulary was already right

> Roles and permissions might be well served assigned to stages. AP
> Validation, AP Matching, AP Coding, AP Review... each tied to an org.

**Decision 0010 named permissions after business activities rather than
routes** — `AP.Validate`, `AP.Match`, `AP.Code`, `AP.Approve`,
`AP.Review` — and the activities **are** the stages.

`AP.Match` and `AP.Code` have sat in that list since, recorded as *"not
built at all yet."* A Matching stage and a Coding stage are what they
were waiting for.

---

## What was missing is the connection

`assign_task` takes a permission the **rule author types**. So a rule at
Validation could demand `AP.Review` and nothing objected, because both
are valid strings.

**That is not hypothetical.** It happened, and a working day of invoices
sat in a queue nobody could see — Alice held the permission and the
tasks demanded a different one.

A stage that declares its own permission makes the mistake **unsayable
rather than merely unlikely**, which is decision 0031's argument about
the rule vocabulary applied one level along: *"the vocabulary is closed,
and that is the feature."*

---

## Refused, not quietly corrected

A rule asking for something the stage does not require is **refused**.

**Silently preferring the stage's is how a rule comes to mean something
other than it says.** Decision 0033 made refusal a first-class output
for exactly this reason: a rule that fails a check *"becomes a refusal
reported back to the person who wrote the sentence, never something
silently stored or silently dropped."*

Where a rule names **no** permission, the stage's is used — which is the
shape a rule should have once a stage declares one.

---

## A hand-copied list drifts, and this one did

SQLite cannot import a TypeScript constant, so the migration names every
permission to keep the column closed.

**Writing that list, I invented five permissions that do not exist and
omitted five that do** — then, correcting it, missed an entire
namespace. `Expense.*` exists and my pattern matched four prefixes.

Caught both times by comparing the two lists rather than reading them.
**A test now does that on every run**, because a closed set maintained
in two places is a closed set until somebody edits one.

---

## What is not built

- **No stage declares one.** The column is null everywhere, so every
  rule still supplies its own and nothing has changed. Setting one is
  an `UPDATE` per stage.
- **The permission is not yet checked against the org.** The operator
  asked for *"each tied to an org"*, and decision 0199 built the
  machinery — `hasPermission(user, permission, unitId)` — while the
  task routes still call it without a unit.

  **So a stage declares who may work there, and not where.** That is the
  next piece, and decision 0199's honest gap is unchanged: fourteen
  permission checks, one of them unit-aware.
- **No screen sets a stage's permission**, and no rule author is told
  a stage has one until their rule is refused.
