# 0261 — The other half of decision 0246

**Status: fixed.** The gap inside `.dashgrid`, and a donut anchored to
the wrong end of its card.

---

## Reported live

> The space between the bottom two cards and the invoice list — On my
> clock is different from above. The height of the Where things are is
> different from the card to the right.

---

## Decision 0246 recorded fixing this, and only fixed half of it

That record's own words: *"the strip, the grid and a panel's own
margin were 12px, 12px and 14px, and the margin added to the gap:
twenty-six between rows"* — and *"one `--dash-gap`, and a panel's own
margin off inside a dashboard."*

**The override was written for `.dashstrip` and never for
`.dashgrid`.** Checked against the file's own history: no version of
this stylesheet has ever given `.dashgrid > .panel` a `margin: 0`. Every
panel inside the grid has carried the base panel's 14px bottom margin
on top of the grid's own 12px gap since decision 0246 was written —
**26px below "On my clock," and a correct 12px above it**, because the
strip's half of the fix was real and the grid's half never existed
outside the record describing it.

**Unnoticed until now** because nothing before had a tall enough
neighbour in that exact position to make the mismatch visible against
a correct gap sitting right above it.

---

## The donut and the bar chart, anchored to opposite ends

`.dashgrid > .panel > svg { margin-top: auto }` pins a bar chart to the
bottom of a stretched card, so extra row height (when a sibling is
taller) shows up as space above the chart rather than splitting the
card unevenly.

**`donutChart()` returns a `.donutwrap`, not a raw `svg`.** The rule
never matched it, so a donut sat at the top of its card with the extra
space sitting visibly below it — while its row sibling's bar chart sat
pinned to the bottom. **The two cards' borders were already equal
height, by the grid's own `align-items: stretch`** — what read as a
height difference was the content inside them anchored to opposite
ends.

Given the same treatment now: `.dashgrid > .panel > svg,
.dashgrid > .panel > .donutwrap { margin-top: auto; }`.

---

## The second test, and why the first version of it was worthless

The margin test was probed and caught the regression on the first try.
**The donut test did not.** Renaming the selector to something that
targets nothing real (`.dashgrid_removed > .panel > .donutwrap`) still
passed, because the test only checked that the text `.donutwrap`
appeared somewhere in a 200-character window — true whether or not the
selector actually matched anything.

**Rewritten to check the exact compound selector string**, not a
fragment of it. The fourth time this project has found a test that
passes regardless of whether the thing it claims to check is real
(decisions 0223, 0235, 0248, 0254 being the others) — and, as with
0254, found by the discipline of probing rather than by reading the
test and trusting it.

vf-ui: 49 Worker, 279 browser.
