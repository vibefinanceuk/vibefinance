# 0366 — One Flow, Not Several Bands

**Status: built.** Reported live: "can we change all cards, with the
exception of the list card 'on my clock', to be the same, so that
they can occupy the same line, if so desired? I want a user to have
flexibility to move to the top, or bottom of the page, and occupy
either two cards per row or three cards per row, using their own
discretion." Then, on how a person actually sets that: "can the UI
figure it out based on how many cards are on the row?" — followed by
the exact rule: "A narrow card (those without chart) can support up
to 4 on a row. A graphic card (those with graphics) can support up to
three cards in a row. The list card, only 1 in a row."

---

## What this actually fixes

Decisions 0246, 0364, and 0365 each solved a real problem by adding
another band a card's own size sorted it into — and each time, a
card's stored order never decided which band it rendered in.
Decision 0364's own report was the direct consequence: a card that
changed weight moved to a different band regardless of how many times
it was moved up. Every earlier fix in this arc made that gap smaller;
none of them could close it, because the bands themselves were the
thing disagreeing with the stored order.

This decision removes the bands. One `.dashflow`, `display: flex;
flex-wrap: wrap;`, rendering every card in exactly the order it is
stored in. Nothing splits cards apart before they render, so nothing
can put a card somewhere its own position did not ask for. A user's
own reordering now means exactly what it says, for every card, with
no exception.

## No control needed at all

The operator's own second answer — "can the UI figure it out" —
changed what this needed to be. Rather than a per-card width toggle
(a new setting, a new UI, a new thing to persist and get out of sync),
every card's own width is read from what it already, structurally is:
whether it draws a chart. `panel()`'s own `weight` parameter (tile /
third / half) is renamed `kind`, with exactly three values:

- **`narrow`** — no chart. `flex: 1 1 240px`, the same basis decision
  0257 already proved fits three or four across a desk.
- **`graphic`** — has a chart. `flex: 1 1 280px`, wider because a
  chart's own labels crowd sooner than a single figure does.
- **`list`** — `on_my_clock`, the one named exception. `flex: 1 1
  100%` leaves no room for a second card on the same line, which
  forces the line break both before and after it without naming a
  position for it specially.

Every renderer was reclassified against this rule directly, not
carried over from its old weight. Most mapped over unchanged — a
figure-only card was already narrow, a bar-chart card was already
wide. One did not: `items_at_stage`'s own small donut had let it sit
in the narrower band since decision 0250, and the operator's own rule
— "those with graphics" — draws no line for a small one. It is now
`graphic`.

## What has coverage

Rewritten rather than patched: several tests from decisions 0244,
0364, and 0365 that asserted a specific band's own existence no longer
describe anything real and were replaced with tests for the actual,
new mechanism — that every non-list card renders inside the one
`.dashflow`, in stored order, mixing kinds freely; that narrow and
graphic cards each carry their own, distinct flex-basis; that the list
card gets the full row and nothing beside it; and the reclassification
of `items_at_stage` itself. Five of the newest, most load-bearing
pieces probed directly by reverting each in turn — the flow container
itself, both card-kind widths, the list card's own class, and the
reclassification — each fails only the one test written for it.

`vf-ui`: 69 Worker (unchanged), 552 browser (was 550, +2: several
tests replaced, net two new). `vf-app` and `vf-licence` untouched —
layout and classification only, no data change.
