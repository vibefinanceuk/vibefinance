# 0522 — The Tasks list: the stage as a coloured pill

**Status: pushed (`f631f3a`), deployed, and migration `0186` applied, as confirmed by the operator on 27 September.**

## What was asked

This arrived while 0521 was being built:

> Also, please can for the Task page, introduce pill boxes and colour
> for the stage also?

## What was decided

**The Stage column is a pill** (`stagePill` in `tasks.js`), the same
shape as the Documents status pill (0520).

**Colour comes from the stage's place in its process, not its name.**
Stages are the customer's own, so no colour is tied to a stage name.
Instead, `stageSequence` (added to each task by `task-list-route.ts`)
picks one of the five chart-palette colours (`--chart-1` to
`--chart-5`, decision 0242), cycling after five. As a result:

- Validation, Matching, Coding and Approval are all different colours;
- each stage keeps its colour on every row and after every reload;
- a customer who renames a stage keeps its colour.

The text is the palette colour, the fill a light tint of it and the edge
a stronger tint. The chart palette is already redefined for dark mode,
so dark mode needed no new colours.

## What was verified

- **`tasks.test.ts`:** stage pills carry the tone for their sequence
  (Approval at 5, Coding at 4). This test **failed** with `tasks.js`
  stashed.
- **`task-list-route.test.ts`:** each task carries `stageSequence`.
- **Screenshots:** the pills were rendered in Chromium, in light and
  dark.

## Known limitation

With more than five stages, the colours repeat. In the live seven-stage
process, AP Review (6) shares Intake's colour. Intake never holds a
task, so the two never appear together.

## Verification (0521 and 0522 together)

- **`vf-app`**, a full, unfiltered whole-suite run: 126 files and 3083
  tests, of which **3081 passed**. The two failures are the ones
  confirmed on untouched `origin/main` since 0511.
- **`vf-ui`**: Worker 75/75. Browser 1208/1209. The one failure is the
  known `typography.test.ts` `10px` gap.
- **`vf-licence`**: 320/320.
- **`npx eslint`** on every touched file: clean.
