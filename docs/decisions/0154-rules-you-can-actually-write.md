# 0154 — Rules you can actually write

**Status: built.** The first five observations from using the rules
screen. **The rule detail screen is not built** — see the end.

---

## The button appeared only where it was not needed

> Some stages do not show the "Write a new rule" button. Intake,
> Matching, Coding, AP Review, Payment Eligible do not show it.
> Coincidentally these are stages with no rules, perhaps related?

**Exactly related, and it was a chicken and egg.** Decision 0153 showed
the button only where a stage had a `rule_set_id`, on the reasoning that
a stage without one has nowhere to put a rule — which is true, and makes
the feature unusable: **rules could be added only where rules already
existed.**

**Nothing has ever created a rule set.** Every one came from a migration
or by hand, which is why nobody had noticed — the operator seeded the
ones they needed.

Writing the first rule at a stage now creates the set, on the way in.
**On demand rather than up front**: a stage with no rules needs no rule
set, and seeding one everywhere leaves empty sets nothing references —
the shape decision 0060 records about intake channels outliving their
purpose.

### And it matches all rules, not the first

`first_match` would let the order rules happen to be in decide which
ones counted, which is a surprise nobody asked for. A stage where
several rules apply should apply them all.

---

## Four smaller things, and why each

**The icon was cumbersome.** Decision 0122 stacked icons above labels
for the action row, where a column of them is the point. In a
sentence-shaped button a 20px icon reads as heavy — 15px, beside the
text.

**"Write a new rule" became "Create rule."** The first describes the
act; the second names the thing, and matches the buttons beside it. The
same reasoning that made *"Open in new window"* into *"Expand"*
(decision 0122).

**Each rule is a card.** A list of sentences separated by a hairline
reads as prose; **somebody scanning for one rule among ten needs them to
be objects.**

**And the box has room to write in.** Three rows made a rule look like a
search box, and a rule is a sentence somebody thinks about.

---

## What was asked for and is not built

**A rule cannot be opened.** The list shows what exists and nothing
leads anywhere — asked for as *"drilling into a rule should allow
Activate, Deactivate, Compile New Version, and show a rule version
number"*.

Every part of that exists as a route except **deactivate**, which
nothing offers: `rules.enabled` is a column and no route sets it.

**And "Save draft" needs a decision, not just a button.** Compiling
already saves a draft — an unapproved version, which is what
`rulestate.draft` reports. But saving the *sentence* without compiling
would need somewhere to put it, and nothing has one.

Worth asking which was meant: *"keep this rule, unactivated"* is already
what happens, and *"keep this sentence, uncompiled"* is a new thing.
