# 0257 — Bigger cards, and a line behind real history

**Status: built.** Read the last section for the one card that does
not get what was asked of it, and why.

---

## What was asked

> Could you look at the cards, and see if we could increase the default
> size so it's easier to read and evaluate adding a line graph in the
> background for the Waiting For Me, and Done cards.

With a reference image of small KPI cards, each carrying a big figure
and a faint sparkline running behind it.

---

## The cards are bigger

**A tile's minimum width went from 200px to 240px**, its padding from
the base panel's 16/18 to a roomier 20/22/18, and the headline figure
from 32px to 40px on the type scale's own 1.25 ratio — a third step
above `--text-xl`, not a size chosen by eye.

---

## Done gets a real line. Waiting for me does not.

**`completed_at` is a timestamp every finished task actually has.** A
day-by-day count of completions over the last week is genuine history —
the same bucketing the `received` card already does for invoices in —
so Done's tile now carries a quiet line behind its three figures, drawn
from real rows.

**`waiting_for_me` is a live queue depth**, and nothing in this system
has ever recorded what it was on a past day. There is no snapshot
table, only the current count. A line under that card would have to be
invented — which is exactly what decision 0242 already declined to do,
for the same reason: *a trend drawn from no history is a decoration
that implies a claim the data cannot back.*

**This record does not reopen that.** The tile is larger and plainer,
and stays that way until the system actually has something to draw.

### What would make it honest

A scheduled snapshot of the queue depth, written daily, is real
feature work — a new table and a cron trigger, not a styling change.
Worth doing if the operator wants it; not smuggled in under this ask.

---

## Gaps are filled with zero, not skipped

`done()`'s query only returns a row for a day that had at least one
completion. Drawn as-is, five quiet days would compress into the same
width as two busy ones and call the result a week. The screen fills
the missing days to zero before drawing, the same discipline decision
0248 applied to the ageing buckets.

---

## Two faults in the drawing code, found while wiring this up

**`sparkline` had never been called.** Built and left unused by
decision 0242, it passed `{ stretch: true, fixed: true }` to the
shared `svg()` helper — `stretch` means *distort to fill a box of
unknown size*, `fixed` means *this is a literal pixel box regardless of
container*. The two contradict each other, and nothing caught it
because nothing had ever run it. A `fill` mode was added: width and
height both taken from a sized, positioned ancestor, which is what a
background chart in a resizable tile actually needs.

**Stacking was made explicit rather than trusted to paint order.** The
background layer gets `z-index: 0`, the foreground content is wrapped
in `.tilefg` at `z-index: 1`. A statically positioned element is not
guaranteed to sit below a positioned sibling merely by coming first in
the document — this does not rely on that guarantee holding.

---

## Testing note

Every new assertion was deliberately broken and confirmed to fail
before being trusted — a discipline earned the hard way over the last
few days of this project, where more than one "passing" test turned
out to be checking nothing. The stacking test reads the stylesheet as
text rather than measuring computed style, matching this codebase's
own established pattern (decision 0223, the typography test): these
browser tests do not load real CSS into the DOM, so `getComputedStyle`
would have passed or failed for the wrong reason.

vf-app: 1435 tests. vf-ui: 273 browser. vf-licence: 320.
