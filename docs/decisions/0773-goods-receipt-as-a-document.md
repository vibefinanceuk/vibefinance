# 0773: A goods receipt as a PDF, and its Document tab

**Status: built.**

- vf-app:
  - `receipt-pdf.ts` (new): the PDF and the CSV;
  - `receipt-document.ts` (new): the receipt as a document, and its response;
  - `order-pdf.ts`: the drawing primitives exported for the receipt's PDF;
  - `orders-out.ts`: `companyOf` and `supplierOfOrder` exported;
  - `receipt-sharing.ts`: `receiptLines`, the supplier's view of a receipt's lines, taken out of
    `getPortalReceipt` so the PDF prints exactly that;
  - `index.ts`: two routes.
- vf-ui:
  - `goods-receipts.js`, `order-document.js`, `app.css` (copied to vf-portal);
  - the proxy: `/goods-receipts/:id/document`.
- vf-portal:
  - `receipt-view.js`, `order-document.js`, `portal.js`;
  - `network.ts`, `index.ts`: `/api/receipts/:linkId/:id/document`.
- vf-licence: strings migration 0364.

## What was asked

Dan, 13 October 2026: *"can you check whether rendering is possible for goods receipt, in the same
way as we have achieved with purchase order?"* I said yes, and asked whether staff and the supplier
should see one PDF or two. Dan: *"One PDF is fine, yes please go ahead and mock it up."*

Dan approved the mock-up and asked for one change: *"yes, remove 'As Acme Corp recorded it against
your purchase orders' from this one too"*. That note is gone from the supplier network's receipt
page, as the order's note was (0764).

## What changed

### One document, as the supplier sees it

The receipt's PDF holds what the supplier may see of a receipt (0738) and nothing more. Staff see the
same page the supplier does.

- **What it shows:**
  - the receipt's number, date and delivery note, and its order or orders;
  - the supplier, and who received the goods;
  - for each line: the order and order line, the item, and what was ordered, received, rejected and
    returned;
  - the return reason, in the words of the customer's list of reasons.
- **What it never shows:**
  - the receipt's notes or its lines' notes;
  - who recorded it;
  - why a line was rejected in checking.

  Its lines come from `receiptLines`, the same query `GET /portal/receipts/:id` answers with, so the
  two cannot drift apart.
- **The company:**
  - the letterhead is the company whose order the receipt's first line names;
  - it is filled in from the legal entity above that company, as an order's letterhead is (0760);
  - the supplier is that order's supplier.
- **The layout:** the order PDF's primitives are reused. The letterhead and facts sit on the right,
  then the Supplier and Received by blocks, then the lines.
  - The table's header repeats on each page.
  - The return reason is printed under the item.
  - A line with anything rejected or returned is tinted.
  - *In all* gives the totals.
  - A cancelled receipt has a banner across the page.
  - Each page has a *Page n of m* footer.
  - A receipt carries no money.
- **The language:** English. A receipt has no supplier language of its own to follow.

### The CSV

The CSV uses the columns our receipt load reads (0644), so a download loads back as the same
movements.

- A line rejected in checking was still delivered, so it is a `received` line.
- The note column is empty.
- A cell a spreadsheet would run as a formula is kept as text.

### The routes

- **`GET /goods-receipts/:id/document?format=pdf|csv&download=1`:** for whoever may see the receipt,
  with the same permissions and units as its Timeline (`receiptAccess`).
- **`GET /portal/receipts/:id/document`:** for a supplier the receipt is shared with
  (`portalMayReadReceipt`). Any other receipt gets the same 404.

Both routes work the same way:

- The PDF is inline unless `download=1`. The CSV is always an attachment.
- The files are named `GR-1.pdf` and `GR-1.csv`.
- Responses are `private, no-store`.

The supplier network passes the file through from `/api/receipts/:linkId/:id/document`, forwarding
only `format` and `download`.

### The tabs

**In VibeFinance:**

- The receipt's side panel has **Document**, **Attachments** and **Timeline / Chat**, with
  **Supplier** where offered (0740).
- The Document tab comes first and is selected when the panel opens, as on an order (0766).
- Attachments lists the receipt's PDF and CSV after what came in with it, under *The receipt as the
  supplier sees it*.
- The panel splits 3:2 at desktop widths.

**In the supplier network:**

- The receipt's page has **Document**, **Attachments** and **Messages**, with Document first.
- Attachments lists the PDF and CSV under *As {customer} recorded it*.

### Words (vf-licence 0364)

3 keys, in English and German:

- the document frame's title, *Goods receipt {receipt}*;
- the two Attachments headings.

## Tests

- **vf-app** `receipt-document.test.ts`, 6 tests:
  - the PDF, read back:
    - the letterhead from the legal entity, the facts, the supplier and the lines;
    - the reason from the list;
    - none of the notes or the rejection's reason;
  - a cancelled receipt's banner, and none for an unknown receipt;
  - many lines across pages, with the header repeated and the pages numbered;
  - the CSV row by row, and a formula kept as text;
  - VibeFinance's route:
    - inline and downloaded, the CSV, the headers;
    - a 404 for an unknown receipt;
    - a 403 without receipt permissions;
  - the supplier network's route:
    - a 404 until receipts are shared;
    - then the PDF and the CSV;
    - the same 404 for another supplier's, another company's, a cancelled and a pending receipt;
    - a 401 with no token.
- **vf-app related suites pass:** receipt sharing, goods receipts, the order PDF, orders out, order
  sharing and the receipt's Timeline (6 files, 67 tests).
- **vf-portal** `network.test.ts`: the file passed through with its headers, with only `format` and
  `download` forwarded.
- **vf-ui worker** proxy test: the new path.
- **vf-ui browser:**
  - the receipt's tabs, with Document first and selected;
  - the PDF fetched, with the frame's title;
  - Attachments listing `WH-1.pdf` and `WH-1.csv` under their heading.

  The full browser suite passes except the known `typography.test.ts` gap, which fails the same way
  without this change.
- **vf-licence** string coverage.
- **Screenshots:** the receipt's Document and Attachments in both apps.

## To deploy

Migration: vf-licence `0364_receipt_document_strings.sql`. There is no vf-app migration.

Deploy vf-app, vf-licence, vf-ui and vf-portal.
