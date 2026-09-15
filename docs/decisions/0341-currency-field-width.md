# 0341 — The Currency Field, Wide Enough to Read

**Status: built.** "Would there be the option to widen the currency
field, so you can see what you have actually selected?" — reported
live, with a real screenshot: the approval and spend limit currency
dropdown rendered as a sliver, only its own chevron visible.

---

## The actual cause

`.memberpickerrow select { flex: 1; }` was written for this row's own
original shape — a person picker and an "Add" button, decision 0332's
own team-member row. `flex: 1` is shorthand for a `flex-basis` of
`0%`: the element's own starting size is treated as nothing, and it
only grows into whatever space its siblings do not take first.

Decision 0334 put a different pair of fields into the same row shape
— a currency select and an amount input, for the approval and spend
limit editors. The amount input carried no width rule of its own, so
it took its own natural, unconstrained width first; with `flex-basis`
starting at zero, the currency select was left only whatever space
remained; a real screenshot shows what that leaves.

**A second, related gap, found while looking rather than assumed
fixed already.** `.editgrid > input { width: 100%; }` — the rule
giving every text field in this app's own edit forms a full-width,
predictable size — has never covered `<select>`. Every picker in
these forms (org, manager, cost centre, and now currency) has run on
whatever a browser's own intrinsic sizing for a `<select>` happens to
produce, not on anything this project ever decided. Harmless while
every option list was short; visibly wrong once one runs to 178
entries of very different lengths (decision 0340).

## The fix

Two CSS rules, not one, once both gaps were found: `.memberpickerrow
select` keeps its own `flex: 1` — still growing to fill the row when
nothing else needs the space, the team-member picker's own case,
unchanged — with a `min-width` added as a floor for when something
else does. The amount input gets a fixed, narrow `flex` of its own,
since a number never needed to compete for room in the first place.
`.editgrid > select` gets the same `width: 100%` its own sibling
`input` rule already gives every text field, closing the second gap
the same way rather than leaving it for the next `<select>` this
project adds to quietly inherit.

## What has coverage

None added. JSDOM, this project's own browser test environment, does
not compute real CSS layout — no actual flexbox or intrinsic-sizing
calculation happens in it, so no automated test here could verify
what a screenshot verified directly. Every existing test still passes
unchanged, confirming this was purely a visual fix with no behavior
to break.

`vf-app`: unchanged. `vf-ui`: 63 Worker (unchanged), 498 browser
(unchanged) — CSS only.
