# 0177 — A name that meant two things

**Status: fixed.** The column picker has its own class, and the viewer's
layout works again.

---

## The process flow was touching the boxes below it

> Please can you also insert a break between the process flow and the
> seller and buyer boxes so they are not touching.

There is a break. Every panel carries `margin: 0 0 12px`, and the
viewer's two-column layout is a grid with a 16px gap.

**Neither was applying**, because `.columns` had come to mean two
things:

- The **two-column layout** in the viewer and the sources screen, since
  decision 0108.
- The **column picker** in the document manager, since decision 0164.

Mine came later in the stylesheet and won. So the viewer's layout was
being styled as a dropdown — `position: relative`, no grid, no gap — and
its panels collapsed against each other.

**A missing gap was the visible symptom of a broken layout**, which is
why adding spacing would have been the wrong fix.

---

## Renamed rather than made more specific

`.columnpicker`. The alternative — `details.columns`, or scoping the
rule to a screen — leaves the collision in place and waits for a third
use of the same word.

**A class name is a name.** Two things called the same thing in one
stylesheet is a bug waiting for whichever loads last.

### And it is checked

`.columns` must still be a grid, and the picker must still have a rule
of its own. Watched to fail: restoring the collision breaks both.

---

## What is not built

- **Nothing prevents the next collision.** These are hand-written class
  names in one stylesheet, and the check names two of them rather than
  the rule.
- **Only the viewer was visibly broken.** The sources screen uses
  `.columns` too and nobody reported it, so it was either less obvious
  or unnoticed.
