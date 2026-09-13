# 0278 — The icon was never in a flex box at all

**Status: built.**

---

## What was reported, and what didn't fix it

A folded nav icon sitting well left of centre, reported live from a
screenshot. Decision 0277 investigated and fixed a real, measured
issue — an icon's own ink sitting off-centre within an otherwise
correctly-centred box — and shipped it, confirmed by hard mathematics
and a rendered before/after comparison.

**It didn't fix what was reported.** The next screenshot showed no
visible change at all. A hard refresh (ruling out browser cache)
didn't change it either. This record is the difference between a real
fix that solved a real but smaller problem, and the actual cause.

## Measuring the real screenshot, precisely

Rather than reason about CSS values in the abstract again, the actual
screenshot was measured pixel by pixel: the highlight box's true edges,
and the icon's own ink boundaries within it. The result — roughly 34px
of margin on the left against 99px on the right, in screenshot-pixel
space — was far larger than anything an ink-balance shift could
produce, and pointed at something structurally different: the icon
looked exactly like it was sitting at the **start** of its container,
not centred within it at all.

**Confirmed by fetching the live deployed source directly**, once
`web_fetch`'s own readable-content extraction proved unable to return
raw markup and the operator pasted the real page source instead. The
CSS on the live page was byte-for-byte what the repository already
had — ruling out a stale deploy or a CDN cache, and meaning the bug
had to be in the CSS itself, reasoned through correctly this time or
not at all.

## The actual bug

`.nav a` — the base link styling from decision 0108 — sets
`display: block`. `.navitem` — decision 0274's icon-and-label row —
sets `display: flex`. Computed with the same specificity calculator
decision 0275 already used once: `.nav a` is `(0,1,1)` (the element
selector "a" counts); `.navitem` alone is `(0,1,0)`. `.nav a` wins.

**`.navitem` was never actually a flex container on the rendered
page.** `display: block` from the higher-specificity rule won outright,
which means `align-items`, `gap`, and the folded nav's own
`justify-content: center` never had a flex layout to act on in the
first place — not "centred wrong," but never centred by any mechanism
at all. The icon rendered as ordinary inline content at the start of a
block box, which is exactly the position measured in the screenshot.

**The identical class of mistake as decision 0275**, on a different
property: a selector that looks more specific by name loses to one
that is more specific by the letter of the specification, because an
element selector counts and a person's intuition about "which rule is
more targeted" does not.

## The fix, and why it doesn't rely on being lucky twice

Scoped as `.nav .navitem`, reaching `(0,2,0)` — clearly ahead of
`.nav a`'s `(0,1,1)`, not tied to it. Decision 0275's fix relied on
matching specificity and winning a source-order tie-break; this one
was written to exceed it outright, the more robust of the two
approaches and the one 0275's own record already recommended for next
time.

**Verified as a combined system, not just individually.** With the
container genuinely centring its one visible child, and decision
0277's own ink-weighted shift already moving the icon's visual mass to
its own true centre, the two corrections were checked together: the
icon element centres within the 40px collapsed row (8px each side),
and its own ink's centroid — already corrected to sit at the icon's
own centre — lands exactly on the row's true centre (20.0 of 40, by
calculation, not assumption). Decision 0277 was a real, correct fix
for a real, smaller problem; it simply had nothing to act on until
this one gave it a flex container to work inside.

## What has coverage now

A test reads the real stylesheet and confirms the losing, bare
`.navitem` selector is gone — not merely superseded, since leaving it
in place would invite a future edit to "simplify" the CSS back to the
version that loses. Probed by reverting to the exact original selector
and confirming the test fails.

vf-ui: 49 Worker, 331 browser.
