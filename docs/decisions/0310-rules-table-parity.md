# 0310 — The Rules list, rebuilt as a real table

**Status: built.**

---

## What was asked

> Can you update the Rules table, so that the look and feel is the
> same as other tables in the solution. For example, in the
> Documents, and Tasks pages?

## What was built

Decision 0154 gave the rules list its own, deliberate shape: a card
each, "a list of sentences separated by a hairline reads as prose."
Reasonable at the time, and genuinely different from what this screen
now needs to match — Documents and Tasks each render a real `<table>`
inside `.tablewrap`, with the whole row as the click target (decisions
0287, 0288). Rebuilt to the same shape: `ruleRow()` now returns a
`<tr class="clickable">` with two `<td>`s, wrapped in `.tablewrap` with
a real `<thead>` naming its own two columns, Rule and Status.

**The click target moved from a link inside a cell to the whole row.**
Decision 0155's own reasoning — opening a rule is the first thing
anybody wants to do with it — is unchanged; only the gesture changed,
matching the row-click convention Documents and Tasks already
established rather than the sentence-as-link approach this screen
built before that convention existed.

**One new string, one reused.** `column.status` already exists in the
shared column-header namespace the Documents screen introduced;
`column.rule` is new, added to the same namespace rather than a
rules-specific one, since a column header is exactly the kind of thing
that namespace exists to share.

**The old card CSS, genuinely dead, removed rather than left behind.**
`.rule`, `.rule .what`, and `button.rulelink` were checked against
every other screen before removal — none of them appear outside
`rules.js`'s own, now-replaced markup.

## What has coverage

Three existing tests referenced the removed `.rulelink`/`.rule`
classes directly and were rewritten against the new structure rather
than left broken: two now read the rule's own headline from its table
cell, and one confirms each rule renders as its own row rather than
its own card — its own name updated to say so, since decision 0154's
"a card each" is exactly what this change reverses. Two new tests
confirm the shape itself: a real `<table>` inside `.tablewrap` with
the correct two column headers, and that each row carries `.clickable`
the same way Documents and Tasks rows do. Both probed directly —
removing the table/`.tablewrap` structure and removing `.clickable`
from the row each fail exactly the test written to catch it.

vf-ui: 49 Worker, 398 browser (was 396). vf-licence: 320. One
migration, one new string in two locales.
