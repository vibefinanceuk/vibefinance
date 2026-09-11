# 0210 — A permission the stage would have supplied

**Status: fixed.** A rule that names no permission compiles, and the
compiler knows what the stage requires.

---

## The worst of both, found by writing a rule

> This cannot be expressed. `assign_task` action requires a permission
> parameter, which is not provided in the sentence.

**Decision 0200 taught the engine to fill a missing permission from the
stage** and said so plainly:

> Where a rule names **no** permission, the stage's is used — which is
> the shape a rule should have once a stage declares one.

**And nobody taught the compiler that one could be missing.** So the
shape that record called *the better one* was the shape the compiler
refused.

A customer therefore had to type a value the stage would have supplied —
**and could type the wrong one**, at which point decision 0200's other
half refuses it for disagreeing.

**Demanded by one end and second-guessed by the other.**

---

## The refusal was the model's, not a validator's

The message is nowhere in the codebase. **The model wrote it**, reading
`ACTION_DESCRIPTIONS.assign_task` in its prompt — *"plus { permission }"*
— and correctly concluding the sentence was incomplete.

Which is decision 0031's design working: the vocabulary documentation
**is** the specification, and the model enforces it. So the fix belongs
in the documentation rather than in a check.

---

## And the compiler can do better than permit it

A rule set belongs to a stage, so the compiler can be **told what that
stage requires** rather than merely allowing silence.

The prompt now carries it, with an instruction in three parts:

- **Use it** where the sentence names no permission.
- **A different one is a contradiction** the author should be told
  about, not a value to override — decision 0033's argument that
  silently preferring one is how a rule comes to mean something other
  than it says.
- **Say nothing at all** where the stage declares nothing, which is
  every stage today. The ordinary case must not grow a section about a
  rule that does not apply.

---

## What is not built

- **No stage declares a permission**, so the new prompt section never
  appears in practice yet. Decision 0200 built the column and setting
  one is an `UPDATE` per stage.
- **A rule set shared by two stages** takes the first stage's
  permission. Nothing today shares one, and nothing prevents it — so
  the query has a `LIMIT 1` that is correct by accident rather than by
  constraint.
- **Nothing tells an author that a stage has a permission** until their
  rule is refused or silently completed.
