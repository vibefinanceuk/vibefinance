# 0148 — A condition's value, not just its field

**Status: built.** A rule naming a code the standard does not define is
refused, where the standard's list is closed.

---

## The failure it prevents

A rule saying *"if currency is EURO"* names a real field (`BT-5`) and a
real operator (`is`). It compiles. It passes validation. It activates.

**And it silently never fires**, because the ISO code is `EUR`.

Nothing errors. The rule sits in a listing looking correct. An invoice
that should have been held goes through, and **the only evidence is an
absence** — which decision 0113 calls the worst kind of rule failure.

---

## The same argument decision 0041 already made

That record refused an operator that could not possibly match a field's
type, and said why:

> No error, no refusal, just a rule that quietly does nothing. Refusing
> at compile time turns the worst failure mode this engine has into a
> real message.

**Values are the same shape**, and were left out. Decision 0113 built
the lists — `ISO_4217`, `UNCL5305`, the UN/ECE units — and decision 0116
used them to check **documents**. This is the third of the three:

- A **dropdown** stops a person entering a bad code (0113).
- **Validation** stops a document carrying one (0116).
- And this stops a **rule looking** for one.

---

## Only closed lists refuse

The UN/ECE unit list is deliberately a subset with `isClosedList: false`
(decision 0113).

**Refusing there would make our incomplete list the customer's
problem.** A customer whose supplier bills in a legitimate unit nobody
seeded must still be able to write a rule about it. Watched to fail:
dropping the `isClosedList` check refuses a unit that is perfectly
valid.

---

## Every member of a list, not the first

`in` and `not_in` take an array. **One bad code among four** makes a
rule that matches three things and looks like it matches four — which is
the original failure in miniature and harder to spot.

---

## What it does not touch

**A stored rule is evaluated without revalidation.** So a rule already
activated with a bad code keeps behaving exactly as it did — badly, and
unchanged.

That boundary is deliberate: **refusing at evaluation time would break a
customer's live process** to enforce a rule about how it was written.
The compile path and the inline evaluate path refuse; the stored path
runs what it was given.

The consequence is that this catches new rules and not old ones, and
**nothing tells a customer they have an old one.**

---

## What is not built

- **No sweep of existing rules.** A rule written before this, naming a
  code that does not exist, is invisible — and the only way to find one
  is to check every stored rule against the lists, which nothing does.
- **The refusal is in English.** `RuleValidationError` predates decision
  0008's locale-aware messages, and the compile route already notes that
  its own message is *"left in English deliberately, not silently
  glossed over"*.
- **Nothing checks a value's *shape*.** A date field compared against
  `"next Tuesday"` is still accepted, because no list closes it.
