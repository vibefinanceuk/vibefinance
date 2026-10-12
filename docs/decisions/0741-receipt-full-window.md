# 0741: A goods receipt opened fills the window; the Supplier tab's box at the bottom

**Status: built.** vf-ui (`goods-receipts.js`, `app.css`; `app.css` copied to vf-portal).

## What was asked

Dan, 12 October 2026, with screenshots of a receipt's pop-out: *"1) I think the good receipt
document from vf-app deserves to be in full-screen mode, in the same was as viewed in the
supplier network. Instead of a pop-out now, because there is so much information to share in
the page. 2) please can the comment box appear fixed at the bottom of the page for supplier
comments, in the same way as it appears towards the bottom for the timeline / chat."*

## What changed

- **A receipt opened fills the window**, wherever it is opened from (Goods Receipts, Tasks,
  Documents, Create, Conversations): the receipt scrolls on the left with its number larger;
  the Attachments / Timeline / Chat / Supplier panel on the right keeps the window's height,
  a little wider. Close returns to the screen it was opened from, as before. Stacked on a
  narrow screen.
- **The Supplier tab is laid out as Timeline / Chat's**: the messages scroll, and the box to
  write to the supplier and Send to supplier stay at the bottom of the panel.

## Tests

vf-ui `goods-receipts.test.ts`: the receipt opens in the window-filling layout, and the
Supplier tab's box sits in the panel laid out as Timeline / Chat's. Checked in Chromium.

## To deploy

Deploy vf-ui (and vf-portal, whose `app.css` copy changed). No migration.
