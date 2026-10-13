# 0769: Purchase orders on the Documents screen

**Status: live.**

- vf-app: `documents-route.ts`, `index.ts`.
- vf-ui: `documents.js`, `app.css` (copied to vf-portal).
- vf-licence: strings migration 0361.

## What was asked

Dan, 13 October 2026: *"Would it be possible to next include Purchase Orders as a document type in
the Documents screen on vf-app?"*

Asked whether orders should appear in **All** or only when picked in Type, he chose *"In All, as
receipts are"*. He added that the supplier network's Documents screen already does this (0751).

## What changed

Purchase orders are rows of Documents, on the same terms as goods receipts (0737).

- **In All**, newest first among invoices, credit notes and receipts. An order is placed by when it
  was loaded.
- **Type** offers *Purchase orders*, to list them alone.
- **Each row** shows:
  - **Type:** *Purchase order*, in the accent receipts have.
  - **Number** and **PO:** the order number.
  - **Supplier:** as the customer keeps it, else the party the order names.
  - **Amount:** the order's total.
  - **Company:** the company that placed it.
  - **Status:** where it has got to, in the supplier network's words (0751's `portalOrderStatus`):
    *Open*, *Part received*, *Received*, *Part invoiced*, *Invoiced*, *On hold* or *Closed*. The
    two lists say the same of the same order.
- **A row opens the order's own page** (0753, 0766), as from Purchase Orders.
- **Search** finds an order by its number, its requisition or its supplier's name. The company
  chosen, `since` and the chosen org apply as they do to invoices.
- **Who sees them:** whoever may read orders. That is AP.Validate (the Purchase Orders screen's own
  rule) or AP.Purchasing (0752), in the companies where they hold it.
- **Where they are left out:** under a card's drill-through, which asks about invoices, and in the
  AP Assistant's own unpaged search.

The receipts' merge (`listWithReceipts`) now takes any of the three kinds. Each query is bound with
exactly as many values as the highest `?N` it names, as D1 requires.

### Words (vf-licence 0361)

8 keys, in English and German.

## Tests

- **vf-app** `documents-orders.test.ts`, 7 tests:
  - interleaved in All, newest first;
  - an order's row: supplier, amount, dates, company and status;
  - Type filters to orders, and leaves them out of invoices and receipts;
  - search by number, requisition and supplier;
  - narrowed to the chosen company and the person's companies;
  - none without the permission, in the AP Assistant or under a drill-through, and paged with
    invoices alone;
  - through the router: AP.Validate and AP.Purchasing see them, AP.Review alone does not.
- **vf-ui browser** `documents.test.ts`, 4 tests: the row and its pill, the Type filter, none offered
  without the permission, and opening the order's page.
- **vf-licence** string coverage.
- **Related suites pass:**
  - vf-app's Documents, receipts on Documents, agents, AP Assistant and orders (8 files, 270 tests);
  - the full vf-ui browser suite, except the known `typography.test.ts` gap;
  - vf-portal.

## To deploy

Migration: vf-licence `0361_documents_orders_strings.sql`. Deploy vf-app, vf-licence, vf-ui and
vf-portal (the shared stylesheet).
