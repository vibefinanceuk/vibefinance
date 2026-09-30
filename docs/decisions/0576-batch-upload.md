# 0576: Create → Batch upload, with a preview before anything is made

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0224`**. There is no `vf-app` migration.

## What was asked

This is the third Create option, after Upload documents (0573) and
Create an invoice (0575). Dan first described it on 30 September:

> *"A batch upload facility with the ability to upload a CSV/XML file,
> to create multiple invoices, perhaps a summary invoice."*

A "summary invoice" is one invoice from many rows. He approved the
mock-up: *"yes this looks great - 500 seems sensible"*. That mock-up
set out:

- the VibeFinance template, or a supplier's own layout through its
  mapping;
- XML invoices, or a zip of them;
- a preview in which each invoice is Ready, a Possible duplicate, or a
  Problem, with its row;
- possible duplicates left out unless ticked in;
- Download problems;
- at most 500 invoices at once.

## What was decided

### The VibeFinance template (`shared/ingestion/batch-template.ts`)

The template has **one row per invoice line**:

- Required: `invoice_number`, `issue_date`, `currency`, `supplier_name`
  or `supplier_vat`, `line_description`, `quantity`, `unit_price`,
  `vat_rate`.
- Optional: `due_date`, `purchase_order`, `buyer_reference`, `unit`
  (C62 if empty), `line_net`, `notes`.

`templateCsv()` gives the header and two example lines, served as
`GET /uploads/template.csv`.

**Rows with the same invoice number and supplier are one invoice**, with
a line for each row, in order. So a statement's thirty rows make one
invoice. The same number from two suppliers makes two invoices.

**Totals come from the lines**, as an invoice states them:

- each line's net is quantity × unit price;
- the net total is their sum;
- VAT is each rate's base times its rate, rounded once per rate;
- gross and amount due follow.

Rates of 0 are category Z, and others S.

**It is read by our own code, not as a mapping.** A mapping's functions
take one value each, so they cannot multiply two columns or sum VAT by
rate. The template is ours, so its rules can be exact.

**What is wrong is said by row, in words.** Any of these makes a Problem:

| Problem | Example of what is said |
|---|---|
| A missing column | "The file has no column … Download the template to see the columns." (the whole file) |
| No invoice number on a row | "Row 7: no invoice number" |
| A date not written 2026-09-30 | "Row 6: issue_date "30.09.2026" is not a date written as 2026-09-30" |
| A currency that is not three capitals | "Row 8: currency "euro" is not a three-letter code such as EUR" |
| A number with a comma, or none | "Row 2: unit_price "12,50" is not a number written with a dot" |
| A VAT rate outside 0 to 100 | "Row 8: vat_rate 120 is not a percentage from 0 to 100" |
| A `line_net` that is not quantity × price | "Row 6: line_net 11.00 is not quantity × unit_price (10.00)" |
| Rows of one invoice that disagree | "Row 5: currency is EUR, but row 4 says GBP" |
| More than 500 invoices | "The file holds 501 invoices. At most 500 are read at once: split it and upload each part." |

`problemsCsv` writes them as `row,invoice_number,problem`.

### A supplier's own layout

`splitCsvByColumn` (in `supplier-csv.ts`) cuts a CSV into one CSV per
invoice. It groups the rows by the column the mapping reads the invoice
number (BT-1) from, so **no new mapping setting is needed**. Each part
keeps the file's skipped lines and header, so the mapping reads it
exactly as it reads a whole file.

`GET /uploads/mappings` lists every published CSV mapping to choose from.

### XML invoices

Each XML invoice is read for the preview with `readInvoiceXml` (UBL, CII,
XRechnung). A supplier's own XML is a Problem that points to Upload
documents, where its mapping reads it.

### The preview and the making (`vf-app/src/batch-route.ts`)

**`POST /uploads/preview`** reads the file and **keeps nothing**. It
returns:

- each invoice's number, supplier, date, currency, total, lines, rows and
  status;
- its problems;
- a **possible duplicate**: an invoice with the same number from the
  same supplier (by VAT number or name) already received, with when;
- the counts, and the problems CSV.

**Creating** opens a batch upload (`kind: "batch"`, one CSV or up to 500
XML files). What happens next depends on the file:

**A CSV.** It is made in chunks of 20 through
`POST /uploads/:id/batch?from=&count=&duplicates=`.

- Each chunk reads the file again, the same way, and makes the next of:
  - the ready invoices;
  - the possible duplicates, only if ticked in.
- **The choice reads the same on every chunk.** Invoices this upload
  made in earlier chunks do not count as duplicates.
- **A chunk sent again makes nothing twice.**
- The whole file is kept once, as the upload's part 1.
- Each invoice is made through `handleCaptureFromSource` with the
  invoice already read (`preRead`), so everything after reading is the
  path every other invoice takes:
  - the channel;
  - placement in the source's company;
  - supplier matching;
  - the process from its first stage;
  - retention.
- Its original is the file (a reference, not a copy), and its table is
  its own rows only.

**XML invoices** are sent one at a time as files, exactly as Upload
documents sends them.

**Finish** closes the upload as delivered, partial or failed.

**Where it shows.** The Route monitor has one message, "Batch upload of 1
file", with a `batch_read` event. Each invoice's Timeline says "Received
by AP upload from …, Read from batch_september.csv", and its Attachments
tab has the file.

### The screen

As in the approved mock-up, a third tab, **Batch upload**:

**Left: what to upload.**

- Send to.
- Layout of the CSV: the VibeFinance template, with **Download
  template**, or a supplier's layout, with its published mapping chosen.
- The drop zone for a CSV, XML invoices or a zip.
- **What goes in the template**, which lists the columns.

**Right, once a file is chosen: the Preview.**

- The file, rows, invoices and layout.
- **Cancel**.
- The counts.
- A table of every invoice:
  - Ready, with "N rows in one invoice" where it has several;
  - Possible duplicate, with what was received and when;
  - Problem, with the rows and what is wrong.
- **Also create the possible duplicates**.
- **Download problems**.
- **Create N invoices**, which counts only what will be made.

**After Create**, each invoice is shown as it is made, as Created (with
number, supplier, total, stage and **Open**) or Not read (with why).

Help covers the tab.

## Not built

- **A supplier's own CSV holding several invoices, sent by email.** It is
  still refused as one invoice per file (0565). The same grouping could
  read it now; this is left for Dan to choose.
- **Resuming a batch after the page is closed.** Invoices already made
  stay made; the rest can be made by uploading the file again, and the
  possible-duplicate check will then flag the ones already made.
- **Credit notes** in the template. BT-3 is always 380.

## Verification

- **`shared`**: 8 tests. `batch-template.test.ts` covers:
  - the template and its example;
  - one invoice from many rows, with totals and VAT by rate;
  - the same number from two suppliers;
  - every problem above, by row;
  - missing columns, an empty file, and 501 invoices;
  - a semicolon file, and the problems CSV.

  It also covers `splitCsvByColumn`, including a title line, a quoted
  `;` and a missing column. The whole package: 396 pass. The three
  failures existed before this change.
- **`vf-app`**: `batch.test.ts`, 7 tests. They cover:
  - the preview:
    - four invoices, one of them a possible duplicate of an invoice
      received on 12 September, and one a problem;
    - the problems CSV;
    - nothing kept;
  - an XML invoice in the preview, and a supplier's own XML;
  - the batch made in two chunks:
    - the chunk sent again, making nothing new;
    - the upload delivered, the file kept once, and each invoice placed
      and with its lines;
    - its original the file, and its table only its own rows;
    - its Timeline naming the file;
  - the duplicate made only when asked, and a file with bad columns
    refused;
  - a supplier's mapping offered, its rows grouped by the invoice
    number's column, and both invoices made;
  - an unknown mapping refused;
  - through the router: the template and a preview with `AP.Create`,
    and 401 without.

  Full, unfiltered run: 144 files and 3347 tests, of which **3345
  passed**. The two failures are the ones already known (0511).

  The first run found that the second chunk counted the first chunk's
  invoice as a duplicate and skipped ahead. The duplicate check now
  leaves out invoices this upload made.
- **`vf-ui`**: `create.test.ts`, 3 new tests using the real strings. They
  cover:
  - the layouts, the template link and the mapping list;
  - a CSV previewed:
    - with nothing opened;
    - every status and detail;
    - the Create count rising when duplicates are ticked in;
    - then made in one chunk into rows with Open;
  - the mapping chosen in the preview's query, and two XML files
    previewed and sent one by one.

  All fail against the interface before this change. Full browser suite:
  1393 of 1394 pass. The one failure is the known `typography.test.ts`
  10px gap. Worker tests: 86 of 86, and the proxy test covers the four
  new paths.
- **`vf-licence`**: `0224` adds 44 keys in English and German, none with
  a `;`. 322 of 322 pass, and migrations replay 224.
- **Screenshot** of the tab with a preview, checked by eye against the
  mock-up. It showed invoice numbers and dates wrapping, which now stay
  on one line, and "1 possible duplicates", which now reads "1 possible
  duplicate".
