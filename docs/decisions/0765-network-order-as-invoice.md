# 0765: The supplier network's order, laid out as an invoice is

**Status: live.**

- vf-app: `orders-out.ts` (`orderCards`), `order-sharing.ts`.
- vf-portal: `order-view.js`.
- vf-licence: strings migration 0359.

## What was asked

Dan, 13 October 2026, with screenshots of the invoice viewer and the network's order:

1. *"Can we shorten the width of the To Do alert in the Supplier Network, so not full width of the
   screen. Similar to the invoice viewer in vf-app … make that the width of the card below, and
   move up the Document viewer."*
2. *"Please can we change the order of the tabs on the right of the Supplier Network, to read
   Document, Attachments and Messages - with Document having focus on opening."*
3. *"Would it be possible to Make the Purchase Order screen in terms of information cards look
   more like the invoice screen, having Seller, Buyer, Purchase Order Header, and Purchase Order
   Lines cards?"*

He asked for a mock-up first. It was drawn with the network's own stylesheets and sample data, and
he approved it: *"Looks great - I love the progress box also."*

## What changed

- **The alert** (0764) sits at the top of the left column, the width of the cards below. The right
  panel starts level with it, so the Document is higher on the page.
- **The tabs** read **Document, Attachments, Messages**, and the Document opens first.
- **The cards**, as the network's invoice (0729):
  - **Seller:** the supplier as the customer keeps it. It shows name, ERP reference, VAT number and
    address, and the orders email (the order's own, else the supplier's orders address, else its
    email).
  - **Buyer:** the customer, then the company that placed the order. It shows name, VAT number and
    address, and who to talk to: the order's buyer, else the Destination's reply-to mailbox, else
    the company's email, then its phone, as on the PDF (0761).
  - **Progress:** the order's status, whether receipt is confirmed (and when), and how much is
    still to deliver and still to invoice.
  - **Purchase order header:** order number, date, currency, requisition, net, VAT, total and
    company, as read-only fields.
  - **Purchase order lines:** across the page below, with net, VAT and total beneath.
- **vf-app gives what the cards need** with the order: `parties`, `net`, `vat` (as the PDF's, the
  tax between the totals excluding and including it) and `requisition`.

### Words (vf-licence 0359)

9 keys, in English and German.

## Tests

- **vf-app** `order-sharing.test.ts`: the order's seller, buyer, net, VAT and requisition.
- **vf-licence** string coverage. **vf-portal** `network.test.ts`: the words are defined.
- **Related suites pass:** vf-app orders, order sharing, confirmation, orders out, order PDF and
  portal (12 files, 198 tests), vf-portal, and vf-licence string coverage.
- **The approved mock-up** is the page as built, in Day and Night.

## To deploy

Migration: vf-licence `0359_network_order_cards_strings.sql`. Deploy vf-app, vf-licence and
vf-portal.
