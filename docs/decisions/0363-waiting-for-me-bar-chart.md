# 0363 — A Bar Chart for Waiting for Me, by Queue

**Status: built.** Reported live: "update the dashboard, specifically
the Waiting for me card, to include a bar chart, indicating which
queues, and queue count that items exist in?"

---

## What was there before

`waiting_for_me` showed a single, big total — "12, across 4 stages" —
with no way to see which of those four stages actually held the work.
The backend's own `waitingForMe()` already knew the distinct stage
count (`count(DISTINCT t.stage_id)`), but never carried the breakdown
itself past the query, only the count of it.

## Backend

Rewrote the query to group by `t.stage_id` directly — the same column
`task-list-route.ts` already joins `process_stages` through — rather
than counting distinctly. `count` and `stages` are now derived from
the grouped rows themselves (`byStage.reduce(...)`, `byStage.length`)
rather than a second, separate aggregate query: everything the old
response carried is still there, now alongside the breakdown it was
always implicitly built from. Ordered by each stage's own `sequence`,
the same convention `whereThingsAre()` already established for "count
by stage," so the two cards on one dashboard read queues in the same,
consistent order — the order work actually moves through them, not
alphabetical or busiest-first.

## Frontend

Laid out the way `done` already combines a total with its own bar
chart, rather than inventing a second shape for the same idea: the
total figure stays, with the bar chart beneath it, one bar per queue.
Kept the plain, single-figure tile for 0 or 1 queue — the same "a bar
chart of one bar is a rectangle" rule `where_things_are` already
follows, applied here for the identical reason. The whole card stays
clickable to the unfiltered "everything waiting for me" view, matching
the card's own long-standing definition (decision 0264): no stage
filter on the click, since the card's own count never had one either.

## What has coverage

Backend: the breakdown itself, ordered correctly; that the total and
stage count are genuinely derived from it rather than duplicated by
a second query; the empty case (an empty array, not a single zero
row); and that org-unit scoping applies to the breakdown itself, not
only the total a restricted person would otherwise still see summed
across units they cannot see into. Frontend: the tile-or-chart switch
for this card specifically, that the bars carry the right labels and
values, and that the card stays clickable once charted. Every new
test probed directly by reverting the specific piece of logic it
covers.

**A test-fixture fix along the way, not a production one.** `work()`,
this file's own task-seeding helper, only ever seeded a single, fixed
stage — no existing test had ever needed two. Extended it with an
optional `stage` parameter, defaulting to the original behaviour, so
every existing caller is unchanged.

`vf-app`: dashboard tests 59 (was 55, +4). `vf-ui`: 547 browser (was
544, +3), 69 Worker (unchanged). `vf-licence` untouched.
