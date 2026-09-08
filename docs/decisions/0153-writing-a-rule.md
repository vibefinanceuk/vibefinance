# 0153 — Writing a rule

**Status: built.** Compile a sentence, read the rule back in words,
confirm every worked example, activate.

---

## The product's actual claim

A customer writes *"hold invoices over ten thousand from new
suppliers"* and gets an enforced rule. Until now that was a `curl`,
which meant **only the operator could do it** — and the whole argument
for the closed vocabulary (decision 0031) is that it is **safe to hand
to a customer.**

Every route existed. Compiling, listing examples, confirming one,
activating. None had a face.

---

## Reading the rule back is the hard part

Somebody wrote a sentence and has to check the system understood it. What
it produced is:

```json
{"field":"BT-112","operator":"greater_than","value":10000}
```

**Showing that asks them to learn EN 16931 to check their own English.**

So the rule renders as a sentence — *"the total with VAT is more than
10000"* — with the Business Term on hover rather than in their face. An
auditor and an ERP vendor both use `BT-112`; the person writing the rule
does not have to.

**A customer who cannot read the rule back cannot confirm it**, and the
activation gate is worth nothing if the thing being confirmed is
unreadable.

### The operators are grammar, and grammar is translated

Rendering `is_not` as *"is not"* in code would put **English grammar in
a screen whose nouns come from D1**. A German customer would read *"die
Gesamtsumme is not 1000"* — worse than either language alone.

So every operator, every combinator and every join is a key. Twenty-one
of them, in both seeded languages.

### And the field names come from the same place the keying screen uses

`/field-visibility` already serves a description per field, so the
read-back needs no second vocabulary — the property decision 0031
protected by keeping one source of truth. Without it the read-back falls
back to Business Term ids, **which is worse and not wrong.**

---

## A refusal is an answer

Decision 0033 made refusal a first-class output: the model declining is
**the vocabulary boundary doing its job.** A screen that treats it as an
error teaches somebody to distrust a working system.

So it is warning-coloured rather than red, says what cannot be
expressed, and says **nothing was saved** — because the next question is
always *"what happened to my rule"*.

No examples and no gate appear, since there is nothing to confirm.

---

## The gate makes somebody read

Decision 0034: a rule cannot be activated until every worked example has
been confirmed, by a named person derived from the authenticated caller.

The button is disabled and says **how many are left** — *"Confirm 1 more
first"* — because a count is what decides whether somebody finishes now.

**The examples say what happens in plain terms.** *"Fires"* and *"Stays
quiet"*, not `expectMatch: true`: somebody confirming is being asked to
agree that an outcome is right, and **a boolean is not something anybody
can agree with.**

### And the read-back sits above them

With a line telling somebody to check it first. **If the sentence was
misunderstood, confirming three correct examples of the wrong rule is
exactly the trap** the gate exists to prevent.

---

## Where the button appears

Only at a stage that **has a rule set**. A stage without one has nowhere
to put a rule, and offering the button there would be offering a dead
end — which is why `hasRuleSet` was already on the stage list.

---

## What the first real sentence found

*"Hold any invoice over 10,000 euros from a supplier we have not seen
before"* was **refused**, and correctly:

> The vocabulary only provides a `hold_until` action that accepts a
> specific date, not a condition based on user validation.

The model read the vocabulary right. `hold_until` holds until a
**date**; there is no action meaning *"stop here and have a person
decide"*.

**The refusal did its job**, and it surfaced a gap rather than a mistake
— which is the whole argument decision 0033 makes for refusal being a
first-class output.

### The gap is real

*"Hold it for review"* is the most ordinary thing an accounts-payable
rule wants to say. The vocabulary makes somebody say **`assign_task`**
instead — a term from the workflow engine rather than from accounts
payable, and one a customer has no reason to know.

`assign_task` and `route_to` both express it. Neither is what anybody
would type.

**Two ways to close it**, and it is worth deciding rather than leaving
every customer to discover it:

- **A `hold_for_review` action**, which is `assign_task` with a
  sensible default — and another entry in a vocabulary decision 0031
  keeps small on purpose.
- **Or the compiler's prompt teaches the translation**, so *"hold for
  review"* compiles to `assign_task` without a new action. Cheaper, and
  it puts the knowledge in a prompt rather than in the closed set.

The second is more in keeping with decision 0031: **the vocabulary is
closed and that is the feature**, so growing it should cost more than
teaching the model to speak it.

---

## What is not built

- **No backtest.** Testing a rule against invoices already captured is
  cheap — decision 0003's interpreter is a pure function and the facts
  are stored — and no route offers it. The mockup argues for it.
- **Nothing checks a rule against its stage.** A rule testing a cost
  centre at Validation matches nothing, every time, without erroring.
- **A rule cannot be opened from the list**, so a second version is
  written by starting again rather than from what exists.
- **The self-verification mismatch has no screen.** Decision 0034
  refuses a whole batch when one example disagrees; the response says
  so and this shows it as an ordinary failure.
- **Compiling gives no sense of progress.** A model call takes seconds
  and the screen says *"working out what you mean"* once, then nothing.
