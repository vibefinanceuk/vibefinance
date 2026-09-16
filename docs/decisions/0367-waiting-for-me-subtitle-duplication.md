# 0367 — "Across N Stages," Once Not Twice

**Status: built.** Reported live, with a screenshot: "the Waiting for
me card says 'across 4 stages' twice. please could one be removed."

---

## Root cause

Decision 0363 built one string, `subtitle`, meant to describe the
card's own total. It was passed to `panel()` as the card's own
subtitle — rendered right under the title — and also passed to
`figure()` as the big number's own label, rendered right under the
count. `done`, the card this layout was modelled on, uses two
genuinely different strings for those two spots (`t("dash.donesub")`
and `t("dash.thisweek")`); this one reused a single string for both by
mistake, so "across 4 stages" printed twice on the same card.

## Fix

Removed the card-level subtitle, keeping the figure's own label. The
single-stage case already shows "across N stages" this same way, right
beside the number it describes and nothing above it repeating it — the
charted case now matches it exactly rather than saying the same thing
in two places.

## What has coverage

A new test confirms the string appears exactly once inside the card
once it is charted, and that the card carries no `.sub` element at
all in that state. Probed directly: reintroducing the old, duplicated
call fails the new test.

`vf-ui`: 69 Worker (unchanged), 553 browser (was 552, +1). `vf-app`
and `vf-licence` untouched.
