# 0246 — One gap, and two bands

**Status: built.** The dashboard's alignment.

---

## Tiles and charts were fighting

One grid with `align-items: start` gives every row a ragged bottom, so a
short tile beside a tall chart left **a void the height of the chart**.

**A figure and a chart are different heights by nature.** A strip of
figures across the top and the wider cards beneath is what every
dashboard worth looking at does, and it is not a style choice — a grid
that lets them fight produces holes.

### The strip is flex, not grid

`auto-fit` sizes tracks to a minimum and collapses the empty ones, which
is right for a gallery and wrong for a row of figures: **three tiles
took three narrow columns and left the rest of the row empty.**

Flex with `grow` shares the whole row — three take thirds, four take
quarters — and `min-width` decides when they wrap rather than a column
count.

---

## Three spacing values, two pixels apart

The strip, the grid and a panel's own margin were **12px, 12px and
14px**, and the margin added to the gap: twenty-six between rows and
twelve between columns.

**The eye measures the space between rectangles against itself**, and
two values two pixels apart is the worst case — it looks wrong and
nobody can say why.

One `--dash-gap`, and a panel's own margin off inside a dashboard.

**The tiles also had tighter padding than the cards**, so the strip sat
on a different grid from the row beneath — visible as headings that did
not line up.

---

## A caption is not a page intro

`.sub` carries a **34px** bottom margin from the topbar it was written
for, which put a third of an inch of nothing between *"All open work"*
and the chart it describes.

---

## And a heading that sat above nothing

`th` centres by default, so *Supplier* floated over the middle of a wide
column while the names beneath began at the left.

**A heading that does not sit above its column is a heading for
something else.**
