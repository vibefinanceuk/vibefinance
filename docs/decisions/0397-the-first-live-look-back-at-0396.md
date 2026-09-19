# 0397 — The first live look back at 0396

**Status: built, not yet pushed.** Two corrections to decision 0396,
found by the operator looking at the real, deployed app rather than
the mock-up — the first live review either of the two global pieces
had gotten.

---

## What was asked

Two separate reports, in one pass over the deployed app:

1. A screenshot of Purchase Orders' "Load Purchase Orders" card: *"when
   we have icons in the top right of a card, the heading becomes
   large. See attached example. Could the height be compressed, so as
   to not consume so much heading space? Could the title on the left
   be aligned at the bottom of the space, just above the horizontal
   line?"*
2. *"The card titles in the Dashboard are inconsistent. Some have been
   updated, such as 'On my clock' - but others have not, such as
   'Waiting for me', 'Where things are', 'Possible Duplicates', etc."*

The second one was not simply a bug — the Dashboard's own tiles
(`card-narrow`/`card-graphic`, built through `dashboard.js`'s own
`panel()` helper) had been *deliberately* left out of 0396's own
selector, reasoning that a KPI tile's plain count already had decision
0242's own "no verdict" treatment and should stay quiet. Rather than
guess which way to resolve the resulting inconsistency, three options
were rendered against the real stylesheet and shown side by side: keep
today's split, extend the new heading to every tile, or revert "On my
clock" to match the quiet tiles instead. **Chosen directly: extend it
to every tile, with a rule beneath "Possible Duplicates" too** — the
same rule every other card now gets, not a tile-specific variant of
it.

---

## What was built

**The heading row bottom-aligns itself, decision 0396's own `.panel >
.cardhead` now carries `align-items: flex-end`.** The cause, traced
rather than guessed: `actionLink()`'s icon-above-label shape (decision
0122) is taller than a title's own line, and `.cardhead > .actionlink`
already had a small upward pull (`margin: -6px -4px 0 0`, decision
0300) to compensate — but only for an action that is a *direct* child
of `.cardhead`. Purchase Orders' CSV Template/Load CSV pair sits one
level deeper, inside `.statebuttons` (needed so the two buttons wrap
and gap correctly), which that selector's own `>` never reaches. With
`align-items: flex-start` — the row's default, inherited from bare
`.cardhead` — the row's height still followed the taller action, and
the title, pinned to the top, left a bare gap above 0396's new rule
rather than sitting on it. `flex-end` puts every title on the row's
own bottom edge instead, regardless of what shape the action beside it
takes — direct child, `.statebuttons`-wrapped, or none at all.

**The action itself, compacted.** `.panel > .cardhead > .actionlink`
and `.panel > .cardhead .statebuttons .actionlink` get their own
`padding: 4px 6px; gap: 3px;` and an 18px icon (down from the base
`.actionlink`'s `9px 6px`/`5px`/20px), scoped to a card's own heading
so nothing outside it — the control row, the pagination arrows' own
row — changes size. A corner control does not need the room a control
sitting in a row of its own gets.

Both fixes were rendered against the real, unmodified `tokens.css`/
`app.css` (Playwright, a static page reusing the exact markup
`purchase-orders.js`/`icons.js` build) before being called done —
Day and Night both, and a second card with no action at all
("Line items") to confirm nothing without a tall neighbour moved.

**The Dashboard's tiles get 0396's own selector extended one level,
`.panel > .tilefg > .cardhead > h3` and `.panel > .tilefg >
.cardhead`** — the exact shape `dashboard.js`'s `panel()` helper
builds for every `card-narrow`/`card-graphic` tile. `.card-narrow >
.cardhead > h3`, the quiet override 0396's own record inherited from
decision 0242, is removed: it never actually matched anything (the
same `.tilefg` nesting is why, a gap this file itself flagged while
scoping 0396 without joining up that the override sitting a few
hundred lines above had the identical problem), and keeping dead CSS
that now also contradicts a real rule beside it is worse than deleting
it. `card-list` ("On my clock") needed no change — its own `.cardhead`
already sits as a direct child of `.panel`, which is why it was the
one tile that picked up 0396's treatment on its own and looked, on a
real dashboard, like the odd one out rather than the one that was
right.

---

## Tests

`test-browser/typography.test.ts` — two of 0396's own tests updated
for the selector's new third line, and two new `describe` blocks: one
for the alignment/compaction fix (checks `.panel > .cardhead`'s own
`align-items: flex-end`, that the cardhead-scoped `.actionlink`
override is smaller than the base `.actionlink` rule elsewhere in the
file, and that the base rule's own padding is untouched), one for the
dashboard extension (checks the selector reaches `.tilefg`, that the
same rule draws the same border, and that the removed dead selector
stays removed).

Watched to fail first: `app.css` stashed, test file kept, suite run
against the pre-change file — 7 of 35 typography tests failed (5 new
assertions, plus the two 0396 tests whose selector text no longer
matched the old two-line rule). Restored, reran, 35/35.

Full suites: vf-ui 74 Worker + 696 browser (691 pre-existing + 5 new),
both passing. `dashboard.test.ts`'s own unhandled-rejection noise
(`tasks.js`'s `render()` reading `me.name` off a stub with no `me`)
confirmed present against `app.css` stashed back to its pre-change
state too — not introduced here, the same kind of pre-existing noise
`document-window.test.ts` already carries. `eslint` clean.
`scripts/check-citations.py` clean (397 records).

Touches `vf-ui` only (`public/app.css`, `test-browser/typography.test.ts`)
— no change to `vf-app`, `vf-admin` or `vf-licence`, and no change to
`tokens.css` or the font file: this record spends no new token, it
only reaches the two already shipped by 0395/0396 into places 0396
itself had not yet reached.

---

## What is not built

The document tab row (piece three) and the red/amber/green severity
work (piece four) are still unchanged, same as 0396 left them. This
was the first real look at 0396 live rather than in the mock-up, and
it produced exactly two corrections rather than a wider list — worth
recording as a data point on how well a canvas mock-up, reviewed by
the operator, predicts what a real screen full of the app's own actual
content and markup will look like: not perfectly, but close enough
that both gaps were narrow, specific, and fixed in one pass rather
than reopening the design.
