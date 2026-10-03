# 0616: Handling time fits its card, and handling and cycle time open Documents

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0259`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026: *"Yes, please continue with the rest"*, the last two
Operational Performance cards to open Documents as the others now do
(0611–0615): **Average handling time** and **Claim-to-complete cycle
time**. His screenshot of 0613 also showed handling time's table cut off
at the card's edge, its task count hidden.

## What was decided

### Average handling time: a group per person, a bar per stage

The four-column table (stage, user, hours, tasks) did not fit a card
three to a row, about 290px: names wrapped and the count fell off the
edge. The card's question is *"which stage is slow for this person"*
(0428), so each person is now a group, slowest first as the route ranks
them, with a bar per stage sized by its average and *21.5 hours · 4
tasks* beside it, as the cycle time card already shows a person. Bars
share one scale across people.

### The clicks

Both cards average tasks a person **claimed and then completed** (0428),
over all time. A click opens Documents at the invoices behind them:

| Card | Click | Opens Documents at |
|---|---|---|
| Average handling time | a stage's bar | what the person claimed and completed **at that stage**: *Showing where Alice McDonald claimed and completed a task at Matching* |
| Average handling time | the person's name | all of it: *Showing where Alice McDonald claimed and completed a task* |
| Claim-to-complete cycle time | a person's bar | all of it, as above |

A bar at **0 hours** still opens, where there were tasks: an average of
nothing is tasks finished as soon as they were claimed. All of them open
from the keyboard too.

- `GET /api/documents` gains **`handledBy`**, with **`handledStage`**
  (ignored alone). Another person's needs **AP.Analysis**, as `doneBy`
  and `openFor` do. A task given to someone by name was never claimed,
  has no handling time, and is not included, as on the cards.
- `barList` gains `max` (one scale for lists drawn apart) and a row's
  `selectable`; a clickable row is now reachable from the keyboard.

## Not built

- A time window: the cards average all time, so Documents does too. A
  "last 30 days" choice would belong on the cards first.
- *1 tasks*: the task count's wording is not yet singular for one, as on
  the cycle time card before this change.

## Verification

- **`vf-app`** `documents.test.ts`, 2 new tests: a person's claimed and
  completed tasks over all time (one given by name, one still open and
  someone else's left out); narrowed to a stage, a stage alone ignored.
  `documents-analytics-filters.test.ts`: your own 200, another person's
  403 without AP.Analysis and 200 with it. 3 fail against the route
  before this change. Full run 3459, of which 3457 pass (the two known
  failures).
- **`vf-ui`** browser `workload-handling-time.test.ts`, rewritten: grouped
  by person in the route's order with no table; hours and count per
  stage on one scale; a stage's bar (at 0 hours) asks for `handledBy`
  and `handledStage` and shows the banner; the name by keyboard asks for
  `handledBy` alone; laid out with the real stylesheets at 290px, nothing
  past the card's edge. `workload-cycle-time.test.ts`, 2 new tests: a bar
  asks for `handledBy` and shows the banner; a 0-hour bar with tasks is
  clickable. 6 fail against the cards before this change. Full run 1476,
  of which 1475 pass (the known `typography.test.ts` 10px gap); worker
  111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 259.
