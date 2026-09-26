# 0508 — Stage grids sized to their actual run length

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Reported live against the real production screen (org
"Acme-production"), with six screenshots attached:

> some cards are wide, some are full width

then, moments later:

> some are narrow

This is a regression report against decision 0507, delivered minutes
earlier, which grouped consecutive stages that offer Account Coding
restrictions into a fixed 3-column `.stagegrid`.

## What was found

Decision 0507 assumed the real Standard AP process's *intended* split
— five configurable stages (Validation, Matching, Coding, Approval, AP
Review) adjacent to one another, bookended by two transitionary stages
(Intake, Payment Eligible) — and built the grouping logic to walk
stage order and open/close a 3-column grid around whichever run of
offered stages it found.

The screenshots show real production data does not match that
intended split. In org "Acme-production," only two of the seven
stages — Validation and Coding — actually have
`offerFieldRestrictions: true`; Matching, Approval, and AP Review have
each been switched off per-org via the existing `offerToggleRow`
control (decision 0485), which is legitimate configuration, not bad
data. Because Validation and Coding are not adjacent, each landed
alone in its own run of length 1 — and `.stagegrid`'s
`grid-template-columns: repeat(3, minmax(0, 1fr))` always reserves
three tracks regardless of how many items are actually in it. A lone
offered stage rendered in the first of three columns, occupying a
third of the row's width with two-thirds left visibly empty beside the
full-width slim bars either side of it — which is exactly "some cards
are wide, some are narrow" from the six screenshots: the grid never
adapted to how many stages actually landed in a given run, only to
whether a run existed at all.

## What was decided

A grid's column count follows the number of stages actually in its
run, not a fixed assumption of three:

- **A run of 1** gets no grid wrapper at all — it renders exactly like
  a standalone slim (not-offered) stage does: a full-width `.panel`,
  sharing its parent with the transitionary stages either side of it.
  There is nothing to arrange into columns when there's only one card,
  so it takes the row the way every other single card on this screen
  already does.
- **A run of 2** gets a new `.stagegrid-2` modifier — two columns, not
  three with one always empty.
- **A run of 3 or more** keeps decision 0507's original `.stagegrid` —
  three columns, with a trailing incomplete row read the same way any
  card grid's last row is read anywhere else: normal, not broken.

This is a sizing fix only. Nothing about *which* stages offer
restrictions, what a checkbox or toggle does, or the return-target
picker (all decision 0507) changes here — a per-org configuration this
screen already respects (0485) was simply never exercised by decision
0507's own tests, which only covered the intended-shape case.

## What was built

- **`workers/vf-ui/public/ap-setup.js`**: the section-building pass
  that used to unconditionally wrap any array of offered-stage panels
  in `.stagegrid` now checks the array's length first — 1 item returns
  the panel itself (no wrapper), 2 items get `.stagegrid stagegrid-2`,
  3+ keep the original `.stagegrid`.
- **`workers/vf-ui/public/app.css`**: new `.stagegrid.stagegrid-2 {
  grid-template-columns: repeat(2, minmax(0, 1fr)); }` alongside the
  existing rules, with a comment noting the bug it fixes. The 900px
  narrow-screen collapse-to-one-column rule now explicitly lists both
  `.stagegrid` and `.stagegrid.stagegrid-2` — two classes outrank one,
  so without this the 2-column variant would never have collapsed on a
  narrow screen.
- **`workers/vf-ui/test-browser/ap-setup.test.ts`**: renamed the
  describe block from "The 3-column grid" to "The grid — decision
  0507" to cover both shapes; the existing mixed-stage test now also
  asserts the 2-item case renders `.stagegrid-2`. New
  `SCATTERED_STAGES_DETAIL` fixture reproducing the exact real-world
  shape from the bug report (Intake off, Validation on, Matching off,
  Coding on, Approval off — non-adjacent offered stages) with a new
  test confirming Validation and Coding each render full width, with
  no `.stagegrid` ancestor at all, sharing their parent with the
  standalone slim stages around them. The CSS-text describe block gets
  a new test for the `.stagegrid-2` rule and the updated 900px query
  text.

## What was not built

No change to `offerFieldRestrictions`, the field-visibility route, any
return-target route, or the picker itself — decisions 0483/0485/0487
/0490/0502/0507 all stand exactly as they were built. No new migration
— this is layout logic reacting to configuration the server already
sends.

## Verification

- `workers/vf-ui`: `ap-setup.test.ts` (browser) — **77/77**, including
  2 new tests for this decision. Full browser suite **1193/1194** —
  the one failure is the same pre-existing, unrelated
  `typography.test.ts` hardcoded-`10px` gap, reconfirmed via `git
  stash` to predate this change (as does the 314-error
  `document-window.test.ts` unstubbed-`/collaborators` noise). Plain
  suite **75/75**, unchanged. `npx eslint` clean on `ap-setup.js` and
  the touched test file (the one pre-existing, unrelated unused-var
  error in `ap-setup.test.ts`, also reconfirmed via `git stash` to
  predate this change).
