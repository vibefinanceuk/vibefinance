# 0258 — A deeper purple, at the operator's asking

**Status: built.** One token, one value, day mode only.

---

## What was asked

Shown a reference dashboard alongside the product's own and asked
whether some of its deep purple could be incorporated. Three concrete
options were mocked up separately — a deepened `--chart-3`, a gradient
sparkline fill, a soft glow behind a ring — so the choice could be made
without getting all three whether wanted or not.

**The answer was the first, in day mode**: `#7a4fa8` → `#6a3aa0`.

---

## Why this one, and not the others

`--chart-3` already was purple. It just read as lavender rather than
the saturated violet in the reference — a value problem, not a concept
problem, and the smallest possible change that answers the ask.

**Still categorical, still no verdict attached.** Decision 0242's whole
argument for this palette was that a chart colour must not double as a
warning or a success — a richer purple is still just the third
category in a five-colour set, not a warning wearing a disguise.

**Not applied to night mode.** The operator named *"Deeper (day)"*
specifically from the two swatches shown for each hour; night's
`#b08bff` is untouched.

---

## A pre-existing gap this does not touch

Decision 0247 saturated the chart palette for dark surfaces, but only
inside `@media (prefers-color-scheme: dark)` — the explicit
`:root[data-mood="night"]` toggle carries no `--chart-*` overrides of
its own. Someone on a light-preference machine who picks *Night time*
by hand gets the **day** chart values on a dark background, which is
exactly the "read as grey" problem 0247 was written to fix, just
reachable by a different door.

Today's change makes that gap slightly more visible, since the day
value it now falls through to is a different purple than the one
that was there before — but the gap itself predates this change and
is not fixed by it. Noted here rather than folded in silently, since
fixing it was not what was asked.

---

## What was not built

- No test pins the token's own hex value, so none needed updating —
  decision 0223's existing check (every `var(--x)` resolves to
  something defined) still covers this.
- Options B (gradient sparkline) and C (glow ring) from the mock-up
  remain unbuilt, by choice rather than oversight.

vf-ui: 49 Worker, 273 browser — unchanged, confirmed still green.
