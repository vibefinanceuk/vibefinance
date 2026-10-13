# 0767: The order's PDF fits its panel

**Status: live.**

- vf-ui: `app.css` (copied to vf-portal).

## What was asked

Dan, 13 October 2026, with screenshots of the order in the supplier network and in VibeFinance:
*"in both the supplier network, and in the vf-app the document image spill over the bottom of the
card. Please can you fix in both locations."*

## Why it happened

0760 gave the PDF's frame (`.podocframe`) a 480px minimum height. Since 0765 and 0766, the panel
beside the order's cards ends level with the cards, and with short cards it has less than 480px
below its tabs. The frame kept its 480px and ran out of the bottom of the panel.

## What changed

The frame fills the height its panel has, and no more (`min-height: 0`, filling its column).
The 480px minimum stays only below 1000px wide, where the page stacks and the panel has no height
of its own to fill.

## Tests

Measured in a browser, on the order's page in VibeFinance and in the supplier network:

- **With tall cards:** the frame ends 17px (the panel's own padding) inside the panel: 806 against
  823, and 755 against 772.
- **With the row of cards hidden,** so the panel is short: it still ends inside, at 605 against
  622, and 415 against 432.

No test covers sizes in CSS, which a browser alone settles.

## To deploy

Deploy vf-ui and vf-portal (the shared stylesheet). No migrations.
