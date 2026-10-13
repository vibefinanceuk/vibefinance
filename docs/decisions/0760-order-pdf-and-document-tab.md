# 0760: A purchase order as a PDF, and its Document tab

**Status: built.**

- vf-app:
  - `order-pdf.ts` (new): the PDF and the CSV;
  - `orders-out.ts`, `index.ts`;
  - a new dependency, pdf-lib 1.17.1 (`package.json`, `package-lock.json`).
- vf-ui:
  - `order-document.js` (new);
  - `purchase-orders.js`, `orders-out.js`, `order-timeline.js`, `app.css` (copied to vf-portal);
  - the proxy: `/purchase-orders/:n/document`.
- vf-portal:
  - `order-document.js` (new);
  - `order-view.js`, `portal.js`, `portal.css`, `network.ts`, `index.ts`.
- vf-licence: strings migration 0355.

## What was asked

Slice 4b of purchase orders, as agreed with Dan on 13 October 2026 (see 0759):

- **The PDF:** made by pdf-lib, inside our own code.
- **A document viewer:** *"Can we show the rendered PDF in a document viewer in vf-app and
  vf-portal. Same as viewer for invoices - another tab next to attachments and Timeline / Chat."*
- **Downloads:** as PDF, UBL XML and CSV.
- **The width:** asked during the work, *"Can you give the document viewer equal width as that
  which we have configured in the invoice viewer?"*

## What changed

### The PDF

`orderPdf()` draws the order on A4 in Helvetica. The layout:

- **The letterhead:** the company, with the order's facts on the right: number, date, currency,
  the change reference and the requisition.
- **A banner** for a change or a cancellation. A cancellation's note is printed in it.
- **Supplier and Buyer** blocks.
- **The lines:**
  - long text wraps;
  - the table's header repeats on each page;
  - a change marks each line *Changed*, *Added* or unchanged, tints changed lines and lists their
    field changes from → to;
  - removed lines are listed after the table.
- **Totals** and a *Page n of m* footer.

It is written in the supplier's language, as the email is: German for DE, AT, CH or LI, English
otherwise.

Helvetica covers WinAnsi only, so other characters are replaced with their nearest form and never
fail the PDF.

What a change did comes from the order's own Timeline (`purchase_order_events`) for that release.

### The CSV

The CSV uses the columns our order CSV reads, so a downloaded CSV loads back as the same order.

### In the email

The Destination gains **Attach the order as a PDF**, on by default. The PDF is attached first and
the UBL second. The Timeline says *With the order as a PDF.* beneath a send.

### The Document tab

**In VibeFinance:** the order's page has a **Document** tab, first among Attachments,
Timeline / Chat and Supplier. Timeline / Chat stays selected when the page opens.

- The PDF is fetched when the tab is first opened, and shown in the page.
- Above it are downloads as **PDF**, **UBL XML** and **CSV**.
- It is served by `GET /purchase-orders/:n/document?format=pdf|ubl|csv`:
  - for whoever may open the order;
  - the PDF is inline unless `download=1`, and the others are attachments;
  - files are named PO-7.pdf, PO-7-change.pdf or PO-7-cancellation.pdf;
  - responses are `private, no-store`.

**In the supplier network:** the order's right side now has **Messages** and **Document** tabs,
with Messages selected first. The Document tab is the same viewer, with the same three downloads.
It is served through `GET /portal/orders/:id/document` for a supplier who may read the order.

### The width

The order's page now splits 3:2, as the invoice viewer does (0390). This applies in VibeFinance
and in the supplier network. Goods receipts keep their narrower side panel. Below the page's
narrow-screen width, both still stack.

### Words (vf-licence 0355)

10 keys, in English and German.

## Tests

- **vf-app** `order-pdf.test.ts`, 7 tests:
  - the letterhead and facts, read back from the PDF;
  - many lines across pages, with the header repeated and the pages numbered;
  - a change's marks and its removed lines;
  - a German cancellation, with its note;
  - characters outside WinAnsi;
  - the CSV loading back as the order, and the UBL reading back;
  - through the router: the headers, the downloads and a 403.
- **vf-app** `order-sharing.test.ts`: the supplier network's document in each format, and a 404 for
  an order the supplier may not read.
- **vf-app** `orders-out.test.ts`: the PDF attached before the UBL, and the setting.
- **vf-portal** `network.test.ts`: the document passed through with its headers, and only `format`
  and `download` forwarded.
- **vf-ui browser:**
  - the order's four tabs;
  - the Document tab showing the PDF, with its three downloads;
  - the Document tab saying when it cannot be shown;
  - the Destination's PDF setting, and the Timeline's words.
- **vf-ui worker** proxy test: the new path.
- **vf-licence** string coverage.
- **Related suites pass:**
  - vf-app: the order PDF, orders out, network sharing and purchase order suites (5 files, 124
    tests). Two full-suite runs here timed out before finishing. The only failures they showed
    were the known `capture-pdf`, `key-fields` and `stage-permissions` tests;
  - vf-portal and the vf-ui worker;
  - the full vf-ui browser suite, except the known `typography.test.ts` gap and
    `signin.test.ts`, which fails the same way without this change.
- **Screenshots:** the order's Document tab in VibeFinance, and Messages and Document in the
  supplier network.

## To deploy

Migration: vf-licence `0355_order_document_strings.sql`. There is no vf-app migration.

Deploy vf-app, vf-licence, vf-ui and vf-portal. vf-app has a new dependency, pdf-lib, so run
`npm ci` (or `npm install`) at the repo root before deploying.

**Then:** the Destination's *Attach the order as a PDF* is on already. Untick it on the panel if
you want UBL only.
