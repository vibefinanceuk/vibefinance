# 0364 — A Third Band, for Cards That Fit Three Across

**Status: built, as a first try.** Reported live: "previously it sat
in a row of three cards at the top, but has now moved to the bottom.
Attempts to move up seem to reject being in its previous location...
the chart cards could potentially fit into the title bar, or indeed
carry a weight: 'third' to allow three in a row. Could we try
initially permitting three cards in a row?"

---

## Root cause, confirmed before building anything

The dashboard's own render splits every card into bands purely by its
current `weight` class — `card-tile` into `.dashstrip` at the top,
everything else into `.dashgrid` beneath — regardless of the card's
own stored position (decision 0246). Before decision 0363,
`waiting_for_me` was always `weight: "tile"`, so it always landed in
the top strip. Once it could become `weight: "half"` for more than one
queue, it unconditionally moved to `.dashgrid`, however it was
reordered: the move buttons genuinely worked — the stored position
changed and saved correctly — but the band a card renders in has never
depended on that position, so nothing visible changed. This exact
"tile or half" split already existed for `where_things_are` too;
`waiting_for_me` simply hadn't been able to flip between the two
states before now.

## What was tried

A genuine third weight, `weight: "third"`, needed no change to
`panel()` itself — it already builds `card-${weight}` generically.
`render()` now splits cards three ways instead of two: `card-tile`
into `.dashstrip`, `card-third` into a new `.dashthird`, everything
else into `.dashgrid` — inserted between the two existing bands, as
close to the card's own former position as a real, honest band can
get. `.dashthird` is a 3-column grid, the same "equal heights within a
row" reasoning `.dashgrid` already uses at two columns, extended to
three. `waiting_for_me` now asks for `weight: "third"` instead of
`weight: "half"` once it has more than one queue to chart.

**A real CSS gap found while extending it.** Two existing tests
checked the dashboard's own stylesheet as exact text — one of them
explicitly reasoned, in its own comment, that a substring check would
let a broken or renamed selector still pass. Both needed updating for
the new, correctly-extended selector strings, not because they were
wrong, but because they were doing precisely the job they were written
to do.

## What has coverage

Two new tests: that a charted `waiting_for_me` renders inside
`.dashthird` rather than `.dashgrid` at all, and that the band itself
is genuinely a three-column grid, not a relabelled two-column one.
Both probed directly — reverting the weight, and separately reverting
the column count, each fail only their own test. The two existing
CSS-text tests, updated to the new selector strings, still pass and
still check the exact compound selector rather than a substring, the
same discipline they were written with.

## Deliberately not solved here

The move buttons can still appear to do nothing for a card whose band
a move keeps it inside — this decision only shortens the distance
between where a chart-bearing card can land and where a tile-bearing
one already does, for the specific case reported. Making the reorder
UI itself band-aware, or graduating "third" beyond this first try, is
open, separate work.

`vf-ui`: 69 Worker (unchanged), 549 browser (was 547, +2). `vf-app`
and `vf-licence` untouched — this was a layout question, not a data
one.
