# 0500 — Return Reasons' own row, given a layout built for it

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Not a new feature — an interface-design follow-up, reported live from
screenshots right after decision 0499's own checkbox-sizing fix had
already landed: "do you have any capacity for interface design?"
followed, on confirmation, by "yes, please" to a concrete offer: turn
each reason's row into one clean line — label, checkbox with its
"Active" text beside it, Save aligned to the right — rather than the
two-line layout the screenshots still showed.

## What was found

Decision 0499 fixed the checkbox's own size, and the checkbox was
never the only problem: each reason's row put four unrelated controls
— a text input, a label, a checkbox, an action — directly inside
`.editgrid`, a **two-column pairing grid** built for label-above-value
pairs (`.editgrid > label { align-self: end; }` is its whole reason
for existing). Four children in two columns wrap: the label input and
the word "Active" landed on one visual line, and the checkbox and Save
link dropped to a second, mostly-empty line beneath it — visible in
both screenshots even after the checkbox itself shrank to a normal
size.

The "add a new reason" row had the identical shape for the identical
reason — three children (an ID field, a label field, Create) in a
two-column grid, wrapping the same way.

## What was decided

Give the row its own class rather than reusing a grid that was never
shaped for it — the same choice this screen already made once for
`.assignmentrow` (a label on the left, one action on the right, one
row per list item). `.returnreasonrow`: a plain flex row, wide enough
for the extra checkbox in the middle that `.assignmentrow` doesn't
need. The checkbox and its own "Active" text become one `<label>`
rather than two elements joined by `for`/`id`, matching the shape the
Return To Supplier picker's own AP-team checkbox already uses
(`viewer.js`, decision 0498) — clicking the word toggles the box.

The AP team email panel's own row (two items in a two-column grid)
was never broken — two children fill two columns exactly, one line,
no wrap — so it was left on `.editgrid` unchanged.

## What was built

- **`workers/vf-ui/public/ap-setup.js`**: `returnReasonRow()` extracted
  as its own function, rendering `.returnreasonrow` instead of
  `.editgrid`, with the checkbox and its label combined into one
  `<label class="returnreasonactive">`. The reason list wrapped in a
  `.returnreasonlist` container (mirroring `.assignmentlist`). The
  "add a new reason" row given the same `.returnreasonrow` class, plus
  `.returnreasonnew` for its own narrower first field.
- **`workers/vf-ui/public/app.css`**: `.returnreasonlist`,
  `.returnreasonrow` (flex, bottom border between rows, the same
  visual separator `.assignmentrow` already uses), `.returnreasonactive`
  (the combined checkbox+label, 14px checkbox matching 0499's own
  value), `.returnreasonnew > input:first-child` (a fixed, narrower
  width for the ID field beside the full-width label field).
- **Tests**: `test-browser/ap-setup.test.ts` gained a new describe
  block — 7 tests — covering that each reason renders as one row (not
  split across two), that each row's checkbox reflects its own
  `active` value, that the combined label toggles its checkbox on
  click, that Save posts the edited label and active flag for the
  correct reason only, that the add-row is its own single line with
  the narrower ID field, that adding a reason posts and reloads the
  list, and that the AP team email panel is unaffected. No coverage
  existed for this tab before this segment.

## What was not built

No change to the underlying routes, data model, or save logic — every
field still posts exactly what it did under decision 0498, only where
and how it's laid out changed. No change to any other `.editgrid`
caller; the pairing-grid rules `.editgrid` was built for are untouched.

## Verification

- `workers/vf-ui`: `test-browser/ap-setup.test.ts` **64/64** (57
  carried forward, 7 new). `npx eslint` clean on both touched files
  (one pre-existing, unrelated finding in the same test file —
  `'puts' is assigned a value but never used` — confirmed via `git
  diff origin/main` to predate this change). Full browser suite
  **1172/1173** — the one failure remains the pre-existing, unrelated
  `typography.test.ts` gap (this change touches no `font-size` rule).
  Plain suite **75/75**, unchanged.

## Still to do, operator side

Push, then redeploy **`vf-ui` only** (CSS/JS-only change, no `vf-app`
or `vf-licence` involvement, no migration) and reload the Return
Reasons tab — each reason, and the add-row beneath them, should now
render as one clean line.
