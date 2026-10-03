# 0612: Open tasks by user, a person chosen and a ring of their stages

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0256`** (one string). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026, after 0611: Open tasks by user *"could get pretty
big depending on the number of users"*. Instead, **a drop-down on the
left of the card to choose the user**, and **a pie chart on the right of
their open tasks by stage, a slice per stage**; limited to the org chosen
at the top of the page; the drop-down **showing only users with open
tasks**.

## What was decided

- **The drop-down** lists the people with an open task they own or have
  claimed, in the org chosen at the top of the page (the route was
  already scoped by it, 0428), by name, each with their count:
  *Wei Chen (6)*. The busiest person is chosen first. A choice is kept
  while the screen is open, and falls back to the busiest when the org
  changes and that person is not in it.
- **The ring** (the dashboard's own `donutChart`, its total in the
  middle and a legend of stages and counts beside it) has **a slice per
  real stage**, in process order. Not 0415's colour buckets, which fold
  stages together: one person's open work rarely spans more than five
  stages, and where it does `donutChart` shows four and a rest, as on
  the dashboard.
- **A stage keeps its colour from one person to the next** while five or
  fewer stages hold anyone's open work (the palette's five colours,
  0242). With more, the ring colours by position, as every other ring
  does; its legend still names each slice. `donutChart` now takes a
  segment's colour where given.
- **Unclaimed tasks** stay the card's note line (*7 unclaimed*): they
  belong to nobody, so they are neither a person nor a slice. With only
  unclaimed tasks open, the note shows and there is no drop-down.
- `GET /api/workload/open-tasks` gives each user `stages` (`stageId`,
  `stageName`, `n`), and the report `stages`, every stage anyone has open
  work at, in order.

**A ring, not a filled pie:** it is how the dashboard's *Where things
are* already shows stages, and the hole holds the total.

## Not built

- A click on a stage in the legend opening Documents at that person's
  open tasks there, as 0611 did for the bars.
- A search box in the drop-down, for an org with very many people.

## Verification

- **`vf-app`** `workload-open-tasks.test.ts`: the two existing shapes
  now carry `stages`; 1 new test: a person's open tasks counted at each
  stage in process order, a claimed team task credited to its claimer,
  an unclaimed one counted as available and nobody's, and the stages
  anyone has work at listed in order. 10 of 10. Full run 3451, of which
  3449 pass (the two known failures).
- **`vf-ui`** browser `workload-open-tasks.test.ts`, rewritten for the
  card: only people with open tasks offered, by name with counts, the
  busiest chosen, the picker left of the ring; a slice per stage with the
  total; the ring redrawn on a choice, a stage keeping its colour; the
  unclaimed note, and no picker with only unclaimed tasks. 3 fail against
  the interface before this change. Full run 1462, of which 1461 pass
  (the known `typography.test.ts` 10px gap); worker 111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 256.
