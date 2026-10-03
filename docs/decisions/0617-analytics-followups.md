# 0617: AP Analytics follow-ups — "1 task", a period, and a search

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0260`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026: *"Yes, please can you implement the Smaller
follow-ups"*, the three named after 0616:

1. *"1 tasks"* on the handling and cycle time cards;
2. a time window on those two cards, which averaged all time;
3. a search in *Open tasks by user*'s drop-down, for an org with many
   people.

## What was decided

### "1 task"

`strings.js` gains **`tCount(key, n)`**: for exactly one it uses
`<key>.one` where the strings have it (*1 task*, *1 Aufgabe*), the key
otherwise (*3 tasks*). Used for both cards' task counts.

### A period on Average handling time and Claim-to-complete cycle time

A small choice beside each card's title: **All time** (the default, as
before), **Last 90 days**, **Last 30 days**, **Last 7 days**, by when the
task was completed. Choosing one fetches again and redraws the card in
place; an empty period says *Nothing claimed and completed in this
period*, with the choice still there. Each card keeps its own choice
while the screen is open.

**Documents opened from the card keeps the period**: *Showing where
Alice McDonald claimed and completed a task at Validation in the last 30
days*.

- `GET /api/workload/handling-time` and `/cycle-time` take **`days`**;
  `GET /api/documents` takes **`handledDays`** with `handledBy`. Only 7,
  30 or 90 are honoured (`windowDays`); anything else is all time.
- The choice is `window-picker.js`, for any card that wants one later.

### A search in Open tasks by user

**With more than eight people**, a *Find a person* box sits above the
drop-down. Typing narrows the drop-down to names holding what is typed,
in any case, and the first match is shown at once; nothing matching
says *No one matches*; clearing it brings everyone back, keeping whoever
was last shown. Eight or fewer: the drop-down alone, as before.

## Verification

- **`vf-app`** `workload-handling-time.test.ts`, 2 new tests: tasks
  completed 3, 20 and 200 days ago averaged over 7, 30 days and all
  time; only 7, 30 or 90 honoured. `workload-cycle-time.test.ts`, 1 new:
  the same for cycle time. `documents.test.ts`, 1 new: `handledDays` 7,
  30, none, and an unhonoured 12. 4 of them fail against the routes
  before this change (with one unrelated pre-existing test, *finds by
  sender*, failing in that run and passing in every other: its email and
  document are both stamped *now* and compared `<=`, so a second's tick
  between them fails it). Full run 3463, of which 3460 pass (the three
  known failures).
- **`vf-ui`** browser: handling time, 3 new tests: the four periods, all
  time first and no `days` asked; a period chosen refetches with `days`,
  redraws in place, and a bar opens Documents with `handledDays` and the
  banner's *in the last 30 days*; an empty period says so and keeps the
  choice; *1 task*. Cycle time, 1 new: the same through to Documents.
  Open tasks, 2 new: no search for eight; with nine, narrowing, the first
  match shown, *No one matches*, and back. 6 fail against the interface
  before this change. Full run 1482, of which 1481 pass (the known
  `typography.test.ts` 10px gap); worker 111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 260.
