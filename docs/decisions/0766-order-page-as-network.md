# 0766: The order's page in VibeFinance, laid out as the supplier network's

**Status: built.**

- vf-app: `index.ts`: the order's cards (`orderCards`, 0765) with the order itself.
- vf-ui: `purchase-orders.js`, `app.css` (copied to vf-portal).
- vf-licence: strings migration 0360.

## What was asked

Dan, 13 October 2026, with a screenshot of the order's page: *"can we improve the UI for purchase
order in the vf-app - so that it matches what we have in the supplier network."* He saw a mock-up
first, drawn from the page's own code and stylesheets, then asked: *"Can we align the bottom of
the Document viewer with the bottom of the Purchase Order Header card."* He approved the second
mock-up: *"Looks good thank you."*

## What changed

The order's page has the cards of the supplier network's order (0765):

- **Alerts**: *On hold* and *Waiting* (the question to the supplier, 0752). They are amber, as the
  invoice's *Here because* line (0528) and the network's *To do* (0764). Before, they were plain
  text.
- **Seller, Buyer and Progress**, in a row:
  - **Seller:** the supplier's reference, name, VAT number and address, and the orders email.
  - **Buyer:** the company's name, VAT number and address, and who to talk to. That is the order's
    buyer, or the Destination's reply-to mailbox, or the company's email, then its phone.
  - **Progress:** status, still to deliver, still to invoice (from the Goods Receipts register,
    0644), and beneath them when it was last sent (0759) and whether the supplier confirmed it
    (0762).
- **Purchase order header** as read-only fields. On top: order number, issue date, requisition,
  net and total. Beneath: currency, order type, company, VAT and status.
- **Purchase order lines** and **Receipts and returns**: cards across the page below. The lines
  have net, VAT and total beneath.
- **The right panel ends level with the header card.** It stretches to the cards' height and adds
  none of its own (`contain: size`), so a long Timeline scrolls inside it. Narrow screens still
  stack.
- **The Document tab opens first**, as on the supplier network's order.

`GET /purchase-orders/:n` now also gives `cards`: the same parties, net, VAT and requisition the
supplier network gets.

### Words (vf-licence 0360)

17 keys, in English and German.

## Tests

- **vf-app** `order-pdf.test.ts`: the order through the router gives its cards, with seller, buyer,
  VAT and requisition.
- **vf-ui browser:**
  - the Document tab is first and opens the PDF as the order opens;
  - the lines are on their own card;
  - the receipts card's heading;
  - the waiting question is an alert with its label.
- **vf-licence** string coverage.
- **Related suites pass:**
  - the full vf-ui browser suite, except the known `typography.test.ts` gap;
  - the vf-ui worker and vf-portal;
  - vf-app orders, order sharing, confirmation, orders out, order PDF and portal (12 files, 199
    tests).
- **The approved mock-ups** are the page as built, on the Document and Timeline / Chat tabs, in
  Day and Night.

## To deploy

Migration: vf-licence `0360_order_cards_strings.sql`. Deploy vf-app, vf-licence, vf-ui and vf-portal
(the shared stylesheet).
