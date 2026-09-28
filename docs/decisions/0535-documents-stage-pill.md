# 0535 — The Documents screen's Stage column uses the Tasks list's coloured stage pill

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-app` and `vf-ui`, with no migration and no string change.

## What was asked

> Please can you replicate the pill-box colour for the stage, also in
> the Document screen as well.

> This is available in the Task screen, so just want the same in the
> Documents screen

## What was decided

- **One function, both screens.** `stagePill` (0522, `tasks.js`) is now
  exported, and the Documents screen's Stage column uses it. Before,
  that column showed the stage name in plain text.
- **The colour comes from the stage's place in its process, never its
  name**, as 0522 set out. So a stage is the same colour on Tasks and
  on Documents.
- **`GET /documents` now returns `stageSequence`**
  (`process_stages.sequence`, the value Tasks already gets).
- **The Stage column stays off by default** (0520). It is turned on
  from the column picker, as before.

## Verification

- **`vf-app` `documents.test.ts`**: each document carries its stage's
  `stageSequence`. It **failed** with `documents-route.ts` stashed.
- **`vf-ui` `documents.test.ts`**: with Stage turned on, the cell holds
  a `.stagepill` named "Matching", in `tone3` for sequence 3, as on
  Tasks. It **failed** with `documents.js` stashed. The Tasks list's own
  pill tests still pass.
- Browser 1241/1242 (the known `typography.test.ts` gap). Worker 75/75.
- **`vf-app`**, a full, unfiltered run: 128 files and 3122 tests, of
  which **3120 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
