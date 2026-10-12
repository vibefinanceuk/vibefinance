# 0741: A goods receipt opened is a page in the frame; the Supplier tab's box at the bottom

**Status: live** at `8d8fd44`, pushed and deployed 12 October 2026. vf-ui (`goods-receipts.js`, `app.css`; `app.css` copied to vf-portal).

## What was asked

Dan, 12 October 2026, with screenshots of a receipt's pop-out: *"1) I think the good receipt
document from vf-app deserves to be in full-screen mode, in the same was as viewed in the
supplier network. Instead of a pop-out now, because there is so much information to share in
the page. 2) please can the comment box appear fixed at the bottom of the page for supplier
comments, in the same way as it appears towards the bottom for the timeline / chat."*

Then, the same day: *"Full screen, but still with the side menu displayed - like we have with
invoices and credit notes, and with the header bar, and header buttons"* — a first version
filled the whole window over the side menu, and is replaced.

## What changed

- **A receipt opened is a page in the application's frame**, as an invoice is: the side menu,
  then the top bar — the receipt number, *Goods receipt · supplier · order(s)* beneath it, and
  on the right the receipt's own actions (Register, Reject receipt, Cancel receipt, Claim,
  Release, as allowed) beside **Back**, then Day / Night, Language, Help, Ask and Sign out.
  Drawn where the invoice viewer draws, over whichever screen opened it (Goods Receipts,
  Tasks, Documents, Create, Conversations); Back returns to that screen. Close is now Back.
- Below: the receipt in a card on the left; on the right a card with Attachments, Timeline /
  Chat and Supplier, the window's height less the top bar and kept in view as the receipt
  scrolls. Stacked on a narrow screen.
- **The Supplier tab is laid out as Timeline / Chat's**: the messages scroll, and the box to
  write to the supplier and Send to supplier stay at the bottom of the panel.

## Tests

vf-ui `goods-receipts.test.ts`: the receipt opens in the frame in place of the screen,
its actions beside Back in the top bar, Back returns to the screen, and the Supplier tab's box
sits in the panel laid out as Timeline / Chat's; `receipt-timeline` and `tasks` tests follow
the page. Checked in Chromium.

## To deploy

Deploy vf-ui (and vf-portal, whose `app.css` copy changed). No migration.
