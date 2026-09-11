# 0244 — A card asks for the room it needs

**Status: built.** The dashboard's layout and its charts.

---

## Reported by looking at it

> The dashboard is a great start — but looks a distant second place, in
> terms of rich experience from the mock-up. Are we limited on UI
> controls, colours, etc. with the tools available in Cloudflare?

**Cloudflare was not the constraint.** A Worker serves whatever CSS and
JavaScript it is given, and the mock-up being compared against was
rendered by the same stylesheet.

**Three real causes**, and one of them is not fixable.

---

## The layout was mine

Every card got an equal half, so *"waiting for me: 3"* sat in a panel
the width of a worklist **with a void beside it.**

**A count and a table are both cards and are not the same size of
thing.** Four columns now, and a card declares what it asks for: a tile
takes one, a chart two, the worklist all four.

**And a tile is mostly its number**, so it carries less chrome — a
smaller, quieter heading, because the figure is doing the work.

---

## The charts were plain

**A grid behind the bars**, so a height is read against something. Four
hairlines at quarters; without them the heights are relative to each
other and to nothing else, which is fine for two bars and guesswork for
six.

**A gradient on each bar** — four lines of SVG, and most of what the
reference's depth actually is. Each needs its own, because an id must be
unique in the document and two charts on one screen would otherwise
share.

**A zero is a hairline, not a bar.** One pixel of colour reads as *"a
little"*; nothing reads as nothing, and the number above says which.
**Four of the operator's five ageing buckets are zero.**

**And a bar alone is capped**, because with one row the slot is the
whole width and a 55% bar is 165px of flat colour. The eye reads size as
quantity, and one bar has nothing to be larger than.

---

## One stage is a number, not a chart

**A bar chart of one bar is a rectangle**, and the rectangle says
nothing the figure does not.

---

## And the part that is not a layout problem

**Three invoices at one stage.**

The mock-up had six stages, five ageing buckets with spread, and four
suppliers with exceptions. **A dashboard looks rich when something is
going on**, and no amount of drawing fixes an empty queue.

**Which is a reason to send more test documents rather than to add
decoration**, and worth saying plainly because the temptation runs the
other way.

---

## What is not built

- **No animation**, no transitions, no counting-up figures. All
  achievable and none of them information.
- **No sparklines**, because there is still no history (decision 0242) —
  and a trend drawn from one point implies a claim.
- **The navigation test needed a dashboard stub**, added here. It had
  been passing since decision 0242 and began failing during this work; I
  do not know what changed, and the stub is right to have either way.
