# 0611: AP Analytics' stacked bars lie on their side and open Documents

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0255`** (strings). Deploy vf-licence, vf-app and vf-ui. No
`vf-app` migration.

## What was asked

Dan, 2 October 2026, on AP Analytics' Operational Performance tab:

1. *Throughput by user*: the stacked bar chart **horizontal rather than
   vertical, with the user's name on the left**;
2. **a click on a bar opens that user's items in Documents**;
3. the same for **Team Queue Depth**, also a stacked bar chart.

## What was decided

### Bars on their side

`charts.js`'s vertical SVG `stackedBarChart` (0415) is replaced by
**`stackedBarRows`**, in HTML, as `barList` already is for supplier
names: one row per person or team, **the name on the left**, the stacked
bar in the middle, **the total on the right**. Every bar starts at the
same place whatever the name's length; a long name wraps in its column.
Bars are proportional to the largest total. A segment's colour still
travels with what it is (a stage bucket, or available/locked), never its
position, and pointing at a segment names it (*Approval: 3*).

Upright, each name sat beneath its bar in 9px type and ran into its
neighbour's; ten people made each bar too narrow to read.

### A click opens Documents

A row with something in it is clickable, by mouse or keyboard (Enter or
Space), as `barList`'s rows are (0411); an empty row leads nowhere.

| Card | Opens Documents at | Banner |
|---|---|---|
| Throughput by user | the invoices that person **completed a task on in the last 7 days**, the window the card counts | *Showing what Wei Chen completed in the last 7 days* |
| Team queue depth | the invoices with a task **open in that team's queue**, claimed or not | *Showing what is open in AP Processing's queue* |

Both are new filters on `GET /api/documents`: **`doneBy=<user id>`** and
**`team=<team id>`**, the same conditions the two cards count by
(`workload-route.ts`, `workload-queue-depth-route.ts`). Clear filter
clears them; opening Documents from any card now clears every other
card's filter first (`clearFilters()`), where before some openers left
one behind.

**Another person's work needs AP.Analysis.** `doneBy` naming someone
other than the person asking is refused (403) unless they hold
AP.Analysis, as the card itself requires. Asking for your own is open to
anyone, as *Done* on the dashboard already is (0265).

### Why the counts can differ

The cards count **tasks**; Documents lists **invoices**. Someone who
completed three tasks on one invoice this week shows 3 on the card and
one invoice in Documents; a team queue holding two open tasks for one
invoice the same. Documents' own unit choice and search are cleared on
arrival, as for every card (0259).

## Not built

- The same click on the other Operational Performance cards (open tasks
  by user, workload balance, cycle and handling times).
- Opening Documents at **one segment** (a person's Approval work only);
  the row opens all of it.

## Verification

- **`vf-app`**: `documents.test.ts`, 3 new tests: a person's week (a
  task 8 days ago and someone else's left out), paged with its total; a
  team's open queue, claimed or not (another team's and a completed task
  left out); paging unchanged when neither is asked for.
  `documents-analytics-filters.test.ts`, new: your own week 200, another
  person's 403 without AP.Analysis and 200 with it, a team 200. Full
  run 3450, of which 3447 pass (the three known failures).
- **`vf-ui`** browser: `workload.test.ts` and
  `workload-queue-depth.test.ts` now assert the rows (name left, bar,
  total right, proportional widths, segment colours and names) and, new,
  that a click (and Enter) asks Documents for `doneBy` / `team` and shows
  the banner; no click on an empty row. 9 of them fail against the
  interface before this change. Full run 1460, of which 1459 pass (the
  known `typography.test.ts` 10px gap); worker 111 of 111.
- **`vf-licence`** 358 of 358. **Migrations** replay: `vf-licence` 255.
