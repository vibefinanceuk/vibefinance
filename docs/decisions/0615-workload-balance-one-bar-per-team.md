# 0615: Workload balance, one bar per team split by who has the work

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0258`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 3 October 2026, with a screenshot of the card: *"I'm not sure I like
or understand the purpose of the Workload balance chart … It takes up a
lot of space and shows teams with no items. Can we discuss how to
improve it?"*

## What was wrong with it

The card is for spotting one person carrying a team's queue while their
teammates have little (0428). It showed every team, each with a
full-width bar for each member and *±N tasks*, the standard deviation of
their counts. On Dan's data every team has one member, so:

- every team said **±0 tasks**: one person has no spread to measure;
- every bar was **full width**: a list of one is always 100%;
- seven teams took a block each, **four of them with nothing open**.

The number meant nothing to a reader, and the layout showed people where
the question is about teams.

Asked to choose between one bar per team, a compact table, removing the
card, or tidying it, Dan chose **one bar per team**.

## What was decided

- **One bar per team with open work**, split into a section per member,
  the name on the left and the total on the right, as Team queue depth
  draws (0611). **All teams share one scale**, so a team of 3 is shorter
  than a team of 8.
- **Beneath each bar, who is in the team and how many each has**,
  including anyone with none: a team where one person has 9 and another
  0 is the imbalance the card is for. Pointing at a section names it.
- **Teams with nothing open are left out** and counted in a line at the
  foot: *4 teams with nothing open are not shown*.
- **Most uneven first**, as the route already orders teams. *±N tasks*
  is gone; the subtitle says *Who has each team's open work, most uneven
  first*.
- Colours follow a member's place in their team, busiest first; past five
  members, the fifth onwards fold into **Others** (the palette's five,
  0242), which is not clickable.

### A click opens Documents

| Click | Opens Documents at |
|---|---|
| a member's **section**, or their **name in the key** (mouse or keyboard) | that person's open tasks **in that team's queue**: *Showing what is open for Wei in AP Processing's queue* |
| the **team's name or total** | the team's whole open queue, as from Team queue depth (0611) |

`GET /api/documents` gains **`openTeam`**, which with `openFor` (0614)
narrows to tasks that team owns; alone it is ignored. Another person's
still needs AP.Analysis. `stackedBarRows` gains `onSegment` and `max`;
`chartLegend` gains `onSelect`.

## Not built

- A sign of how uneven a team is in words or a badge: the ordering and
  the bar carry it.
- The route still returns `mean`, `variance` and `stdDev`; the card no
  longer shows them, and they still decide the order.

## Verification

- **`vf-app`** `documents.test.ts`, 1 new test: a person's open tasks in
  one team, not their other teams'; a team without a person ignored. It
  fails against the route before this change. Full run 3456, of which
  3454 pass (the two known failures).
- **`vf-ui`** browser `workload-balance.test.ts`, rewritten: one bar per
  team with open work in the route's order, its total, the quiet teams
  counted and no *±*; sections proportional on one scale across teams,
  each named; every member in the key including one with none; a sixth
  member folded into Others; a section and a key row (by keyboard) ask
  for `openFor` and `openTeam` and show the banner; the team's name asks
  for `team`. 7 fail against the card before this change. Full run 1471,
  of which 1470 pass (the known `typography.test.ts` 10px gap); worker
  111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 258.
