# 0275 — The full logo outlived its own fold, by one specificity point

**Status: built.**

---

## What was reported

A screenshot of the newly-folded nav: the full "Vibe finance" wordmark
still sitting above the "V" mark, not replaced by it — both showing
at once.

## Why nothing caught this before a screenshot did

`.frame.collapsed .brandmark { display: none; }` — decision 0274's own
rule — carries three class-level selectors. The rule it needed to beat,
`:root[data-mood="day"] .brandmark.dark { display: block; }` (and its
night equivalent), carries four: `:root` counts, the attribute
selector counts, and both class names count. CSS specificity does not
care which rule sits later in the file when one has a lower score —
the four-selector rule won regardless of order, every time.

**jsdom applies no CSS at all**, the same limitation this project has
named more than once — a test asserting the text `.frame.collapsed
.brandmark { display: none; }` exists proves the rule was written, not
that it wins the cascade against everything else touching the same
element. Nothing in decision 0274's own test suite could have caught
this; only a real render could, which is exactly what surfaced it.

## Confirmed with a calculator, not eyeballed

Specificity arithmetic is easy to get wrong by one count while
believing it is right, so this was checked against the standard `specificity`
npm package rather than hand-counted alone:

| Selector | Specificity (A,B,C) |
| --- | --- |
| `:root[data-mood="day"] .brandmark.dark` | (0,4,0) |
| `.frame.collapsed .brandmark` (the bug) | (0,3,0) |
| `.frame.collapsed .brandmark.dark` (the fix) | (0,4,0) |

The fix names `.dark` and `.light` explicitly, tying the mood rules'
own specificity rather than falling short of it. A tie is broken by
source order, and the fix's rule was confirmed to sit later in the
file than both mood rules it competes with — checked by index position
in the real stylesheet text, not assumed from where it was typed.

## A real regression test, not just a fixed file

The existing decision-0274 test for the folded nav checked that *a*
rule hiding `.brandmark` existed; it could not have caught this,
since the buggy rule also matched that description. The new test
checks the specific thing that was actually wrong: that the winning
selector's specificity was raised to match what it has to beat, and
that it appears later than both competitors in source order. Probed by
reverting to the exact three-selector rule the screenshot exposed and
confirming the test fails.

vf-ui: 49 Worker, 330 browser. No other Worker touched; no migration.
