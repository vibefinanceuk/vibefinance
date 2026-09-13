# 0287 — Documents rows open the same way the dashboard's already do

**Status: built.**

---

## What was asked

> Please could we update the Document list, in a similar way to the
> behaviour in the Dashboard, where a row is highlighted in the On my
> clock list, by highlighting the row, when it has focus. Upon
> clicking the row it launches the document viewer... so that the
> Expand button can therefore be removed.

## The pattern already existed

The dashboard's "On my clock" list solved this exact problem under
decision 0250, whose own reasoning applies unchanged here: *"a row
that reads like a link and does nothing is worse than one that does
not, because somebody clicks it twice before believing."* `tr.clickable`
and its hover highlight are already shared, global CSS — nothing new
was needed there, only reusing it.

## What removing Expand actually required

Not just deleting a button. The `expand` column was `always: true` in
`COLUMNS` — the same standing as the document number — so it was
removed from the list entirely rather than merely stopped from
rendering, which also removes it from the column picker's own
consideration without a separate change there.

**A real bug caught before it shipped, not after.** The document
number cell already had its own clickable `button.rulelink`, itself
calling the same `expand(doc)` the new row handler now calls too. Left
as it was, clicking the number specifically would have fired both —
the button's own `onclick`, then the row's own handler again once the
click bubbled up to it. Simplified to plain text instead, matching how
the dashboard's own "On my clock" list already renders its own primary
cell (the supplier name) as plain text, relying entirely on the row's
own affordance rather than a second clickable element duplicating it.

**Dead CSS removed alongside the dead JS.** `button.expand`'s own
rule is gone — nothing else in the app used that class. `.rulelink`
was checked before assuming the same and kept, since `rules.js` still
uses it for a genuinely different screen.

## What has coverage

Six existing tests referenced `button.expand` or `button.rulelink`
directly; all six now click the row itself. One test's own premise no
longer applied — "opens from the document number too" tested a second,
separate entry point that decision 0287 deliberately removed — and was
replaced rather than deleted, now proving the more general and more
relevant claim: a click lands correctly wherever it happens to fall on
the row, not only on one specific cell. Probed by removing the row's
own click handler entirely and confirming that specific test fails.

vf-ui: 49 Worker, 342 browser. No migration.
