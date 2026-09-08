# 0158 — A rule that is one condition

**Status: fixed.** The read-back renders a rule with no combinator, and
every action has a word.

---

## Three things in one screenshot

A real rule, written through the interface:

> *"If the invoice duplicate probability is over 60%, please assign to
> the AP team."*

The screen showed **"When any of these is true:"** with nothing beneath
it, and **`action.assign_org`** as its own key.

---

## The read-back was wrong, and that is the serious one

What compiled was a **bare condition**, with no combinator at all:

```json
{"field":"invoice.duplicate_confidence","operator":"greater_than","value":0.6}
```

**The interpreter has always allowed that.** `validateNode` falls
through to a single condition when there is no `all` or `any`, and a
one-clause sentence compiles to exactly that.

The read-back assumed a combinator, found no `all`, **defaulted to
`any`**, and rendered an empty list.

**So the screen showed a rule with no conditions when the rule had
one.** That is precisely the trap decision 0153 exists to prevent:
somebody confirming worked examples of a rule they cannot correctly
read. The rule was valid and would have fired; the screen simply lied
about it.

---

## And an action with no word

`action.assign_org` rendered as its own key. Decision 0111 added the
action and **nobody wrote the label** — and until decision 0153 nothing
displayed an action's name, so nobody saw.

**The check is now derived from the vocabulary**, not from a list
somebody keeps: every action in `ACTIONS` and every operator in
`OPERATORS` must have a label in every seeded language.

A hand-kept list would have had the same gap, which is the shape
decision 0107 already records — its field-label test decayed until it
derived its expectations from the code.

Twelve actions and thirteen operators, seeded.

---

## The third thing is not a bug

The model chose **`assign_org`** for *"assign to the AP team"* — assign
an **operating unit** (decision 0111), which has nothing to do with who
works an invoice. `assign_task` is the action that means that.

**Same shape as the `hold_until` finding earlier the same day.** The
vocabulary has two actions that sound like *"assign"*, and the sentence
a person naturally writes lands on the wrong one.

That is a prompt problem or a naming problem, not a defect, and it is
recorded in the handover beside *"hold it for review"* as the same
question: **does the compiler's prompt teach the difference, or does the
vocabulary stop sounding ambiguous?**

---

## What is not built

- **The read-back cannot show what a rule does not have.** A rule whose
  action params are empty renders the action alone, which is right for
  `flag` and thin for `assign_task`.
- **Nothing checks a compiled action against what a sentence asked
  for.** The worked examples prove the rule matches the right invoices;
  nothing proves it does the right thing to them.
