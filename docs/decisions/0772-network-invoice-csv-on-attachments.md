# 0772: An invoice's CSV on its Attachments tab, in the supplier network

**Status: built.**

- vf-portal: `view.js`, `invoice-document.js`, `portal.js`, `portal.css`.
- vf-licence: strings migration 0363.

## What was asked

Dan, 13 October 2026: *"The invoice and credit note page in the supplier network includes a download
button on the top-right, which downloads a CSV version of the file. This could be moved to the
attachments tab for download. This would be consistent with the purchase order view, which contains
the csv download in the attachments tab."*

I first listed the CSV under a heading of its own. Dan: *"call is the same as other attachments with
.csv at the end … not sure why you would give it a separate name."*

## What changed

- **The top bar's Download is gone** from an invoice and a credit note.
- **The CSV is on Attachments,** in the one list with the invoice's other files, as an order's is
  (0763). It is named like them (`INV-16356.csv`, described as *Spreadsheet (CSV)*) with its own
  **Download**. It is made in the browser from the page's figures, as before (0729).
- **Attachments is always there,** since the CSV always is. The Document tab is there only where
  the customer shares a document (0770). With no document, the page opens on Messages, as before.

### Words (vf-licence 0363)

1 key, in English and German.

## Tests

- **vf-portal** `network.test.ts` passes (40 tests).
- **vf-licence** string coverage.
- **In a browser:** the CSV is listed with the other files, Download saves `INV-16356.csv`, and the
  top bar has no Download.

## To deploy

Migration: vf-licence `0363_network_invoice_csv_strings.sql`. Deploy vf-licence and vf-portal.
