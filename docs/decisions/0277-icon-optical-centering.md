# 0277 — Centred boxes, uncentred ink

**Status: built.**

---

## What was reported

> I think the icon left border needs review - the border on the right
> of the icons seems larger than that of the left.

## What was checked before anything was touched

The obvious suspect — asymmetric padding on the folded nav — wasn't
it. `.nav`'s own padding is 12px each side; `.navitem`'s collapsed
padding is `8px 0`, centred via `justify-content: center`. Computed by
hand and confirmed again with a real SVG geometry library
(`svgelements`), every icon's own bounding box sits exactly on
x=12.00 in its 24-wide viewBox — no rounding, no drift, nothing
eyeballed.

**A real HTML+CSS render was attempted first, and abandoned** —
`weasyprint` doesn't render stroked SVG reliably (icons came out
blank), which would have produced a confident-looking but false
result. Reverted to `cairosvg`, already proven reliable earlier in
this series, and to computing the geometry directly rather than
trusting an unreliable render.

## What a bounding box doesn't tell you

A box can be exactly centred while the *ink inside it* is not — two
small, dense shapes on one side and long, sparse lines on the other
carry different visual weight per unit of space, and the eye tracks
weight, not box edges. Computed an ink-weighted centroid for every
icon — sampling each stroke's own path, weighting by stroke width — to
check what a bounding box can't show:

| Icon | Ink-weighted centroid | Offset from true centre (12.00) |
| --- | --- | --- |
| dashboard | 11.99 | −0.01 |
| tasks | 9.67 | **−2.33** |
| sources | 12.00 | 0.00 |
| suppliers | 11.69 | −0.31 |
| rules | 10.04 | **−1.96** |
| documents | 12.08 | +0.08 |

Tasks and Rules stand out from the rest by an order of magnitude. Both
share the same shape: small, isolated marks (checkbox squares; branch
circles) on the left, long connected lines on the right. The ink's own
centre of mass sits well left of the box's geometric centre, which
reads as exactly what was reported — more apparent room on the right,
even though the box around it never moved.

## The fix, and how it was checked before it was kept

A `<g transform="translate(N,0)">` wrapping each icon's own paths —
+2.33 for Tasks, +1.96 for Rules, the icon's own number in each case,
not a shared guess. Checked twice, not once: first that the shift
lands the ink-weighted centroid at exactly 12.00 (confirmed by running
the same calculation against the shifted geometry), and second that
the shifted ink still sits fully inside the 0–24 viewBox with the
stroke's own width accounted for (5.53–23.13 for Tasks; 5.16–22.76 for
Rules — comfortable margin on both sides, no clipping).

The other four icons were left untouched — their own offsets (±0.31 or
better) are inside what a person could ever perceive, and a shift
applied where none was measured would be guessing, not fixing.

## What has coverage, and what deliberately doesn't

A new test confirms the `<g transform>` wrapper is present on both
icons, probed by removing it and watching the test fail. It does not
re-verify the centroid arithmetic itself — that would mean
reimplementing an SVG path-length calculation inside a browser test
suite for a check that a small, deterministic Python script already
performs rigorously once, at the point the numbers were chosen. The
geometric proof lives in this record and the commit it describes; the
browser test's job is only to notice if the fix is ever silently
reverted.

vf-ui: 49 Worker, 330 browser.
