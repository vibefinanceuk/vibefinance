# 0343 — Overcorrected: A Fixed Width, Not a Greedy One

**Status: built.** "Also the currency field is now too wide..." —
reported live, with a real screenshot, immediately after decision
0341's own fix for the opposite problem.

---

## Why the fix for one problem became a new one

`.memberpickerrow select { flex: 1; min-width: 12em; }` (decision
0341) fixed the currency field being squeezed to a sliver by giving
it room to grow. `flex: 1` means exactly that: grow to fill whatever
space its siblings do not take. Once decision 0341 also gave the
amount field its own fixed, narrow width, there was nothing left
competing for room — the currency field grew to fill essentially the
entire row, leaving a long stretch of empty space beside a short
currency name. Correct for the row this rule was originally written
for (decision 0332's own team-member picker, where nothing else in
the row needs space); wrong for the currency picker sharing the same
generic rule.

## The fix

A dedicated class, `currencypicker`, specific enough on its own to
override the generic `.memberpickerrow select` rule by CSS
specificity alone — nothing about the team-member picker's own
markup or styling changes. `flex: 0 0 auto` replaces "grow to fill"
with a fixed, considered width (20em, chosen by checking the actual
length of every name in the filtered, 156-entry list rather than
guessed): comfortable for the large majority of this list's own
entries. `text-overflow: ellipsis` handles the rare outlier —
Venezuela's own currency, mid-rename — rather than wrapping the row
or letting the text overflow past the field's own edge.

## What has coverage

A new test locks in the mechanism the fix actually depends on — that
the currency picker carries its own, distinct class, not merely that
a CSS rule targeting that class exists somewhere in the stylesheet.
Probed directly: removing the class from the element failed exactly
this test. No test verifies the resulting width or truncation
directly, the same limitation decision 0341 named — JSDOM does not
compute real CSS layout, so nothing here could be verified by an
automated test the way the screenshot verified it.

`vf-app`: unchanged. `vf-ui`: 63 Worker (unchanged), 500 browser (was
499).
