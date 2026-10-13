# 0755: Invoice this order, in the supplier network

**Status: built.**

- vf-app: `order-sharing.ts`.
- vf-portal: `public/order-view.js`, `public/create.js`, `public/portal.js`.
- vf-licence: strings migration 0353.

## What was asked

Dan, 13 October 2026: *"Can you add "Invoice this order", number 5"*. This is slice 5 of the
purchase orders proposal, after 0751 shared orders with suppliers in the network.

## What changed

### On the order, in the network

- **The button:** *Invoice this order* sits beside Back on an order a supplier opens.
- **A new column:** the lines table gains *Still to invoice*, which is what the button fills in.
- **When it can't be used,** the button is greyed out and a line under the page's note says why:
  - the order is closed;
  - the customer has put it on hold;
  - everything ordered has been invoiced;
  - or, where the customer receipts this supplier's goods, nothing received is waiting to be
    invoiced.

**What is still to invoice** depends on the supplier's matching option on the customer's
supplier record (0644):
- **three-way** (goods are receipted): received, net of returns, less what has been invoiced;
- **otherwise:** ordered, less what has been invoiced.

It never goes below zero. Credit notes give back what they credit (0733). The vf-app works this
out per line (`toInvoice`), with `receiptingRequired` beside it, so there is one rule.

### Create, filled from the order

The supplier lands on Create an invoice (0727) with these filled in:
- **Company:** the company the order was placed by, locked.
  - This is the company the supplier's link covers the order by. An order of an operating unit is
    invoiced to the company above it (`invoiceCompanyId`).
- **Currency:** the order's.
- **Purchase order (BT-13):** the order's number.
- **Lines:** one for each order line still to invoice, with its item, quantity, unit, the order's
  price, and its order line (BT-132).

A banner says which order it was filled from and asks them to check quantities and VAT and add
their invoice number. Everything else is edited as on any invoice, and the draft is kept in the
browser as before.

If the customer does not take invoices for that company through the network, Create says so
rather than offering another company.

### Also fixed

Create drew the word "null" above the form whenever it was not a credit note. The form now draws
only the panels there are.

### Words (vf-licence 0353)

9 keys, in English and German: the button, its tooltip, the four reasons, the banner, the
not-accepting message, and the *Still to invoice* column.

## Tests

- **vf-app** `order-sharing.test.ts`:
  - each line's *still to invoice*, two-way and three-way, with an invoice against one line;
  - an operating unit's order invoiced to the company above it;
  - the existing order test now checks `toInvoice`, `receiptingRequired` and `invoiceCompanyId`.
- **vf-portal**: the network tests pass, including that every literal `network.` key the pages
  use exists.
- **vf-licence** string coverage.
- **Screenshots:** a part-received order with *Still to invoice*, and Create filled from it, in
  Day and Night.

## To deploy

Migration: vf-licence `0353_invoice_order_strings.sql`. Deploy vf-app, vf-licence and vf-portal.
