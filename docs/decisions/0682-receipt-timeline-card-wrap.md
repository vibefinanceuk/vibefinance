# 0682: The receipt Timeline's cards wrap properly

**Status: live** at `2ad1785`, pushed and deployed 8 October 2026.

## What was asked

Dan, 8 October 2026, with a screenshot of a goods receipt task's
Timeline / Chat:

> Can you check the text wrapping on the Goods Receipt task view, within
> the Timeline / Chat.

His screenshot showed each system card's words stacked one per line,
with the label and time overlapping.

## Why

The receipt pop-out's narrow side panel still had the layout it gave the
old dotted system lines (0658): `.receiptside .activitysysline` was a
grid with a 12px first column for the dot.

When 0675 made each system line a card, the card kept the
`activitysysline` class. This panel's rule outranked the card's own
layout (`.tlcard`), so the card's content landed in the 12px column.
The Document viewer had no such rule, which is why it looked right.

## What was built

vf-ui `app.css`: the three `.receiptside .activitysysline` rules are
removed, so a receipt's cards lay out as the Document viewer's do. The
symbol, the label and words that wrap across the panel, and the time
appear on the right.

## Verification

- **`vf-ui`** browser `timeline-entry.test.ts` gains 1 test: the
  stylesheet has no `.receiptside .activitysysline` rule left to
  re-lay a card.
- **Screenshots** of a receipt's Timeline / Chat panel in Day and
  Night.
- **Full run**: vf-ui browser 1647, of which 1646 pass (the known
  `typography.test.ts` 10px gap).
