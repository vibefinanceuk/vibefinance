# 0509 — Lone offered stages stay narrow

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

After decision 0508 was confirmed pushed and deployed, and after being
shown screenshots of the result on the real screen:

> the initial ask was to make the UI here look better. We created a
> design, and mock-ups.... This result is a regression from the
> original design.

## What was found

Decision 0508 fixed a real bug (a lone offered stage sitting in a
`repeat(3, ...)` grid, one column filled and two visibly empty) by
unwrapping a run of one to a plain full-width `.panel` — the same
shape as a transitionary stage's own row. That did remove the dead
columns, but it also quietly undid the entire reason this work
started: the original `/design` brief asked for cards "potentially...
1/3 screen width" specifically because seven full-width cards stacked
too deep. For the real org this screen was reported against, the two
stages that actually offer restrictions (Validation, Coding) are not
adjacent — so under 0508, both of them were back to full width, same
as before any of this began. The dead-space bug was gone, but so was
the improvement it was fixing in service of.

Confirmed directly with the user, given two consecutive misses on the
same screen: asked whether a lone offered stage should stay narrow and
left-aligned (matching the original design), or stay full width
(0508's current behaviour). Answer: narrow, left-aligned.

## What was decided

A run of exactly one offered stage gets its own single-column grid,
`.stagegrid.stagegrid-1`, rather than either of the two things already
tried:

- Not the bare three-column grid (0507) — that reserves two columns
  nothing will ever fill.
- Not a plain full-width panel (0508) — that abandons the "1/3 width"
  the design and the original brief both asked for.

`.stagegrid-1` is a single-track grid (`grid-template-columns:
minmax(0, 1fr)`) with its own `max-width`, capped to what one column
of the three-column grid would measure (`calc((100% - 28px) / 3)`,
matching the same 14px gap the three-column grid already uses) —
narrow, left-aligned, no track reserved beside it that nothing will
ever occupy. It widens in step with the other shapes at the existing
breakpoints — half-width to match the 1400px two-column collapse, then
drops the cap entirely at 900px, the same point every other grid shape
here already goes to one full-width column.

## What was built

- **`workers/vf-ui/public/ap-setup.js`**: the section-sizing map's
  `length === 1` case now applies the `stagegrid-1` modifier instead
  of returning the bare panel.
- **`workers/vf-ui/public/app.css`**: new `.stagegrid.stagegrid-1`
  rule plus its own lines inside the existing `1400px`/`900px` media
  queries.
- **`workers/vf-ui/test-browser/ap-setup.test.ts`**: the "isolated
  stage" test now asserts `.stagegrid.stagegrid-1` on Validation's and
  Coding's parent (and that each sits in a *different* grid from the
  other, not sharing one) instead of asserting no grid at all. New CSS
  text test for the `.stagegrid-1` rule and its two breakpoint
  overrides.

## What was not built

No change to which stages offer restrictions, the field checkboxes,
the toggles, or the return-target picker — decisions 0483/0485/0487
/0490/0502/0507/0508 all stand. The 2-item (`.stagegrid-2`) and 3+-item
(bare `.stagegrid`) cases from 0507/0508 are unchanged — this decision
only touches the 1-item case.

## Verification

- `workers/vf-ui`: `ap-setup.test.ts` (browser) — **78/78**, including
  1 new test for this decision (the isolated-stage test was rewritten
  in place rather than added to). Full browser suite **1194/1195** —
  the one failure is the same pre-existing, unrelated
  `typography.test.ts` hardcoded-`10px` gap (and the same 314-error
  unstubbed-`/collaborators` noise in `document-window.test.ts`), both
  reconfirmed to predate this change. Plain suite **75/75**, unchanged.
  `npx eslint` clean on `ap-setup.js` and the touched test file (the
  one pre-existing, unrelated unused-var error in `ap-setup.test.ts`,
  also reconfirmed to predate this change).
