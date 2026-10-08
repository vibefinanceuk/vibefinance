# 0683: Reading an ordinary PDF — its text, or the picture of each page

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-app` only, with no migration, and adds one dependency (`unpdf`).
Deploy vf-app (after `npm install`).

## What was asked

Dan, 8 October 2026:

> I tried to test the recent changes from bundle 0979 by emailing in
> some pdf documents. Sadly no fields were extracted — can we
> investigate?

## Why nothing was read

**Not 0681: an ordinary PDF was never read.**

- Detection (`detect-structure.ts`, 0062) sent a PDF on one of two
  paths:
  - a PDF carrying an invoice (Factur-X / ZUGFeRD) was parsed;
  - any other PDF was kept as an invoice with no facts, for a person to
    key (0055, 0161).
- **The reason it gave:** a Worker cannot rasterise a PDF for the
  vision model. There is no native renderer, and PDF.js needs a canvas
  workerd does not provide. PROGRESS listed it as *Image-only PDFs:
  submit the page as an image instead*.
- Most PDFs a supplier emails are ordinary PDFs, so most emailed
  invoices arrived empty.

**A second fault made it look worse.** The viewer's *System alert —
this document could not be read automatically* showed whenever
`intake.structure` was absent, not only when it was empty. Only a
document nothing could read stores it empty; a photograph or an XML
upload never sets it. So invoices that were read in full also carried
the alert. Dan's screenshot of an XML upload (0674) showed it.

## Options, and Dan's choice

| Option | Note |
| --- | --- |
| **Text layer and page images, in the Worker** | Chosen. |
| Send PDFs to Claude's API, which reads PDFs natively | Needs a new provider, a key, and data leaving Cloudflare. |
| Cloudflare Browser Rendering, to rasterise each page | Paid binding, slower, the most moving parts. |
| Leave as is | |

## What was built

### vf-app `pdf-read.ts`, `readPdf(bytes)`

Uses `unpdf`, PDF.js's serverless build, which runs in workerd with no
canvas.

- **A digital PDF** (one with a text layer) is read for its text, page
  by page. At least 30 letters and digits counts as a text layer; past
  60,000 characters the text is cut, and the prompt says so.
- **A scanned PDF** is a picture per page. PDF.js decodes each page's
  largest image to pixels, whatever its compression (JPEG, Flate, JBIG2
  or CCITT). `toGreyPng` turns it into a grey PNG, no more than 1,600
  pixels on its longer side, with the deflate done by
  `CompressionStream`.
  - Up to 5 pages are read; the rest are left, as for a long
    photographed document (0163).
  - An image under 200 pixels on either side (a logo or a stamp) is not
    taken for the page.
- **Neither** (no text, no page picture) is reported as such.
- **Loading:** PDF.js is loaded on first use, so other requests do not
  evaluate it.

### Reading it

- **Text** goes through `extractInvoiceFromPdfText` (`extraction.ts`):
  - the same prompt, schema and parsing as a photograph;
  - the model is told it is reading text taken from a PDF, with the
    layout lost;
  - one call for the whole document.
- **Pictures** go through `extractInvoiceFromImages`, exactly as a
  multi-page photograph does.

### Capture

- **Routing.** `detectStructure` now sends a PDF with no embedded
  invoice to the image channel, marked `pdf: true`. A PDF declaring an
  invoice that cannot be read goes the same way, with `attempted`
  keeping why.
- **`handleCaptureOrdinaryPdf`** (`intake-capture-route.ts`) reads the
  PDF and captures what the model read. It shares its ending
  (`captureExtracted`) with a photograph.
- **What is recorded:**
  - `intake.structure` is `ordinary_pdf` (the vocabulary's description
    names it);
  - `intake.read` is `pdf_text` or `pdf_images`, or for a long scan
    `pdf_images (5 of N pages)`.
- **A PDF with nothing to read** is refused as unanswered, so it is
  still kept for a person to key, as before.
- **Every route is covered:** email, upload and HTTPS all capture
  through `handleCaptureFromSource`.

### The viewer's alert

`handleGetInvoice`'s `intake.readable` is false only when
`intake.structure` is empty, which is the one case capture says nothing
could read. When it is absent the document counts as read.

## Not done

- **A scanned page's picture is read as the PDF stores it.** A page
  made of several image strips, or a vector drawing, may not be read.
  It is kept for keying, as before.
- **A digital PDF's text loses its layout.** The model reads it well in
  practice, but a dense table may need a second look. The confidence
  score and the line-sum check still apply.

## Verification

- **`vf-app`** `pdf-read.test.ts` (new, 10 tests), against two genuine
  PDFs of one invoice (`scripts/build-pdf-read-fixtures.py`): a
  reportlab export, and a scan saved by Pillow.
  - **`readPdf`:**
    - reads the digital PDF's text;
    - turns the scanned PDF's page into a 620×420 grey PNG;
    - reports neither for a bare PDF;
    - shrinks a 3300-pixel page to 1600, and its rows decompress to
      the right size.
  - **Capture through the email source:**
    - a digital PDF is read from text, with no picture sent. The prompt
      says text and carries the invoice number. The invoice gets BT-1,
      BT-5, BT-31 and BT-112 and its two lines, with
      `intake.structure` `ordinary_pdf` and `intake.read` `pdf_text`;
    - a scanned PDF sends one PNG and records `pdf_images`;
    - a bare PDF makes no model call and is kept for keying.
  - **The alert:** shown only for an empty `intake.structure`; not for
    an absent one or `ordinary_pdf`.
  - `detect-structure.test.ts`: a PDF with no invoice, and one
    declaring an unreadable invoice, are now `image` with `pdf`.
- **Bundle:** 1.03 MB gzipped, up from 0.46 MB, inside Workers' limits.
- **Full run**: vf-app 3712, of which 3710 pass (the two known failures).
