# 0365 — .dashthird Grows to Fill, Rather Than Leaving Empty Tracks

**Status: built.** Reported live, with a screenshot: "the Waiting for
me card now sits isolated. I am unable to add more to that row."

---

## Root cause

Decision 0364's own `.dashthird` was a fixed `display: grid;
grid-template-columns: repeat(3, 1fr);`. With exactly one card in it —
`waiting_for_me` is currently the only card type that ever asks for
`weight: "third"` — that card occupies the grid's first column track,
and the other two tracks stay empty rather than being given up: CSS
grid does not stretch a lone item across unused tracks on its own.
The screenshot showed exactly this — the card sitting at roughly a
third of the row's own width, with a wide, empty gap beside it, which
read as the card being stranded rather than simply alone in a band
built for more.

**"Unable to add more to that row" is currently also literally true**,
independent of the layout fix: no other card type asks for
`weight: "third"` yet, so there is nothing in the catalogue to add
beside it. This decision fixes the visual isolation; it does not
invent a second card that could join it, which nobody has asked for.

## Fix

Switched `.dashthird` from a fixed grid to `display: flex; flex-wrap:
wrap;`, the exact mechanism `.dashstrip` already uses for its own
tiles, with each `.dashthird > .panel` given `flex: 1 1 280px;
min-width: 280px;` — a wider minimum than a tile's own 240px, since a
bar chart's labels crowd sooner than a single figure does. A lone card
now grows to fill the whole row rather than being pinned to a third of
it; three or more would still sit side by side once there is enough
width to hold them, and wrap to a new row below that, the same as
`.dashstrip` already does.

## What has coverage

Two tests, both checking the stylesheet's own exact text, the same
discipline the two tests decision 0364 already fixed use: that
`.dashthird` is genuinely `display: flex` with no
`grid-template-columns` left over from the old rule, and that each
card inside it carries its own `flex: 1 1 280px` basis. Both probed
directly — reverting the container back to a fixed grid, and
separately deleting the per-card flex-basis rule — each fails only its
own test.

`vf-ui`: 69 Worker (unchanged), 550 browser (was 549, +1: one test
replaced with two, net one new). `vf-app` and `vf-licence` untouched —
CSS only, no data or backend change.
