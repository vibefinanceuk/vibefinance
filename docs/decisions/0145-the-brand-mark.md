# 0145 — The brand mark

**Status: built.** The logo at the foot of the navigation column, in two
variants.

---

## Where it goes, and where it does not

Asked for at the **foot of the left column**, and that is the better
place.

**The top of a sidebar is where somebody looks to move.** A logo there
competes with the navigation entries beside it for the same glance, on a
screen somebody uses all day. At the foot it is present without asking
for attention, which is what a mark on a working tool should do.

The nav already carried a 30×3 dash as a placeholder mark at the top
since decision 0108. It stays: it separates the frame from the entries
and asks for nothing.

---

## Two variants, because one does not read

The wordmark is `#001842`. The night surface is `#0d1626` (decision
0139).

**That is a difference of value nobody can read.** Composited to check,
the wordmark becomes an outline and the mark reads as a `V` beside some
shapes.

A light variant recolours the wordmark to `#e8eef7` — the night-time
text colour — so it sits at the same weight as everything beside it.
**The `V` is unchanged in both**, because the gradient carries itself
against either surface.

The two are separated by **brightness rather than hue**, since both are
blue: the navy's brightest channel is around 66 and the `V`'s is 255.

### Swapped in CSS, not in script

So it follows the mood without a second thing to remember, and without a
repaint. Watched to fail: removing the night rule leaves the navy mark
on the dark surface.

---

## The file

The supplied logo was a screenshot on white. Made transparent with **a
soft ramp on how close each pixel is to white**, rather than a
threshold — a threshold leaves a white fringe on every antialiased edge.

**The colours are untouched.** The alternative technique — treating the
image as a foreground composited over white and unpremultiplying —
recovers edges more exactly and shifts the navy darker, which is not a
trade worth making to a brand mark.

The enclosed white areas inside the `b` and `e` clear with everything
else, which is correct: on a dark surface the background should show
through them.

**Resized to 300px wide**, from 1502. The original is 496KB; a nav logo
nobody zooms does not need it, and both variants together are 72KB.

---

## What is not built

- **The sign-in screen has no mark**, which is the one screen where a
  customer looks for reassurance about where they are.
- **It is not a customer's logo.** Decision 0096 makes branding five
  tokens the operator sets per customer; this is VibeFinance's own mark,
  hardcoded, and a customer seeing it on their own instance may not be
  what anybody wants.
- **No `srcset`.** The 300px file serves every density, and on a
  high-density display it is doing so at its limit.
