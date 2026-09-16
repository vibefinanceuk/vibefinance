# 0357 — Pause and Write a New Version Move Into the Rule Card

**Status: built.** Reported live: "a card is shown with 'Pause' and
'Write a new version' buttons. Please can the card be removed, and
the buttons placed in the top right of the card below, which shows
the rule code."

---

The separate `.gate` card that held Pause/Resume, "Write a new
version," and a status line is gone. Both buttons now sit in the
latest version's own card, in a `cardhead` alongside its heading and
status badge — the same shape decisions 0351 and 0354 already
established elsewhere for a card's own primary actions. Only the
latest version gets them: an older version is history, not something
to pause or write a new version from.

**The status line moved rather than being dropped.** Checked its own
actual value before deciding: "Paused. Invoices reaching this stage
are not tested against it." — a real, non-redundant fact about what
pausing does, not merely a restatement of the "Paused" badge already
shown beside the heading. Kept as a small line in the same card,
directly beneath the buttons that now cause it.

## What has coverage

A direct test confirms the structural claim itself: neither button
sits inside a `.gate` element any more, and both sit inside the same
`.panel .cardhead` naming the version they belong to — probed by
reverting to the old, separate-card structure and confirming that
test fails. The existing test for the "what pausing means" text was
failing after the move until the text itself was relocated rather
than removed, catching that its own information would otherwise have
been lost rather than moved.

`vf-ui`: 69 Worker (unchanged), 537 browser (was 536). `vf-app` and
`vf-licence` untouched — markup and CSS only, no new routes or
strings.
