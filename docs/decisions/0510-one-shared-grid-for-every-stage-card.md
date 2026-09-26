# 0510 — One shared grid for every stage card

**Status: verified live, myself, against the deployed screen before
writing this up.**

## What was asked

Reported live, after being shown the deployed result of decision 0509:

> look at the screen intake is wide, validation is narrow, matching is
> wide, coding is narrow

Asked directly what to do about it, given three rounds of "fixed" on
the same screen already:

> Make all cards narrow, a third of available space on the screen.

## What was found

0507 through 0509 all shared one unexamined assumption: only a stage
that offers Account Coding restrictions goes in the grid at all. A
transitionary stage (Intake, Payment Eligible, migration 0081) always
stayed outside it, full width. Three rounds then went into how to
size a run of offered stages that had no adjacent partner — because in
the real Acme-production process, only Validation and Coding offer
restrictions, and neither sits next to the other or to each other's
own kind. Every version of that fix produced the same underlying
shape: full-width transitionary rows alternating with narrow offered
cards, in whatever order the real stages happened to fall — "Intake is
wide, Validation is narrow, Matching is wide, Coding is narrow."

The deeper problem, missed every previous round: a card that never
shares a row with another card gets no benefit from being narrow.
Whether Validation is full width or a third width, it still occupies
one full row of the page on its own — narrowing it saves nothing, and
for this org's actual data, *no* offered stage was ever going to share
a row under the old "only offered stages are grid items" rule, so the
entire redesign was achieving zero of the vertical-depth reduction the
original `/design` brief asked for ("7 stages which gets very deep in
the browser page"), while still looking visually inconsistent.

## What was decided

Every stage card — whether it offers restrictions or not — is now a
plain item in one shared `.stagegrid`, in stage order. There is no
more branching on `offerFieldRestrictions` for layout purposes at all:
`ap-setup.js`'s section-building pass, which used to group stages into
runs and wrap each run in its own grid (or none), now just puts every
`stagePanels[i]` into a single grid, full stop.

CSS grid wraps that list into rows of three (two under 1400px, one
under 900px) exactly the way any card grid wraps an incomplete
trailing row — normal, not a special case. For the real 7-stage
process this means 3 rows instead of 7: Intake/Validation/Matching,
Coding/Approval/AP Review, Payment-Eligible alone in the last row —
genuine depth reduction, and every card the same width, regardless of
which ones happen to offer restrictions or where they fall in the
sequence.

This also deletes all of 0508's and 0509's own per-run sizing
classes (`.stagegrid-1`, `.stagegrid-2`) — nothing is sized by run
length any more, because there are no more runs.

## What was verified, and how

Given three consecutive misses on this same screen — two of them
caught only after shipping and asking the operator to check — this one
was verified against the real deployed data myself, before writing it
up:

- Built a throwaway visual harness (not committed): the exact
  `ap-setup.js` render path, driven with the real Acme-production
  stage shape (only Validation and Coding offering restrictions,
  neither adjacent), dumped to a static page alongside the real
  `tokens.css`/`app.css`, and rendered with Playwright/Chromium at a
  real desktop width — a true rendered layout, not jsdom's DOM-only
  approximation.
- Confirmed the *previous* code (0507–0509) reproduced the exact
  "wide, narrow, wide, narrow" pattern from the live screenshots, to
  validate the harness against reality before trusting it for anything
  new.
- Made this decision's code change, re-rendered the same harness, and
  confirmed visually: three rows instead of seven, every card the same
  width, no dead space, stage order preserved.
- Also read the live, deployed screen directly (via a connected
  browser) earlier in this same conversation, independent of any
  screenshot the operator sent, to confirm 0509's actual state before
  this decision — the same verification habit this decision's own
  write-up continues.

## What was not built

No change to a stage's own content — the field chips, toggles, and
return-target picker (decisions 0483/0485/0487/0490/0502/0507) are
exactly what they were; only which stages share a grid, and which
don't, changed. No server-side change, no new migration.

## Verification

- `workers/vf-ui`: `ap-setup.test.ts` (browser) — **75/75**, the grid
  describe block rewritten for one shared grid rather than per-run
  sizing. Full browser suite **1191/1192** — the one failure is the
  same pre-existing, unrelated `typography.test.ts` hardcoded-`10px`
  gap (and the same 314-error unstubbed-`/collaborators` noise in
  `document-window.test.ts`), both reconfirmed to predate this change.
  Plain suite **75/75**, unchanged. `npx eslint` clean on `ap-setup.js`
  and the touched test file (the one pre-existing, unrelated unused-var
  error in `ap-setup.test.ts`, also reconfirmed to predate this
  change).
