# 0356 — Spacing Under the Process Picker

**Status: built.** Reported live: "could you increase the padding /
space between the Process drop down, and the Process that become
visible beneath it?"

---

`.cardhead` (decision 0351's own process picker, and every other
screen's own "New X" header) has never carried its own bottom margin
— nothing spaced it from whatever sits beneath it within the same
panel, relying entirely on the shape of what follows.

**Scoped to this one cardhead, not `.cardhead` itself.** Every other
screen's own cardhead sits directly above a table or a form, where
the current, tighter spacing already reads fine; widening `.cardhead`
globally would have changed screens nobody asked about. A second
class, `processpicker`, carries the extra `margin-bottom` alongside
`cardhead` on this one element only.

## What has coverage

A direct test confirms the class is actually present on the picker's
own cardhead — probed by removing it and confirming the test fails —
rather than trusting a CSS rule with no verification that anything
still applies it.

`vf-ui`: 69 Worker (unchanged), 536 browser (was 535). `vf-app` and
`vf-licence` untouched — CSS and markup only.
