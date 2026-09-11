# 0245 — A chart that fills its card

**Status: built.** Charts size to their container, and a single value is
not a chart.

---

## The chart floated

`svg()` set a fixed pixel height with the aspect ratio preserved, so a
300-wide drawing in an 840px card rendered **300px wide and centred** —
adrift in the middle of a panel three times its width.

**`height: auto`** lets the viewBox decide the shape and the container
decide the size: a wide card gets a wide chart, a narrow one a short
chart, and the text stays upright either way.

**A ring keeps its pixels**, because a circle that fills a wide card is
a circle the height of the card.

---

## The tiles left holes

A one-column tile followed by the full-width worklist left **three
columns empty**, and the dashboard read as half unfinished.

---

## And one row is not a proportion

*Needs somebody* with a single entry was a full-width amber bar, which
**reads as 100% and means nothing.**

The same argument as decision 0244's single bar: a figure says it, and
the drawing adds a claim the data does not support.
