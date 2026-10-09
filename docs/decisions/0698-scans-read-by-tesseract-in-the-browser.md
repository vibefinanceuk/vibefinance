# 0698: Scanned pages are read into words by Tesseract, in the browser

**Status: live** at `e0c12b2`, pushed and deployed 9 October 2026, migration applied. vf-ui (vendored tesseract.js); vf-licence migration
`0311_scan_lasso_strings.sql` (shared with 0699). No vf-app change.

## What was asked

The second of the three steps agreed on 9 October 2026 (see 0697): finding a
field's value and the lasso, for scans and photos as well as PDFs with text. Dan
chose Tesseract in the browser over a paid OCR service.

## How it works

A scan has no text layer, so `realPageWords` (page-renderer.js) now reads one:

- **An image page** (a photo, or a scan's working page from 0690) is fetched
  as bytes from its signed URL and given to Tesseract. Its bytes, not the
  picture on screen: the page is served from vf-app's origin, and a picture
  from another origin cannot be read back from a canvas.
- **A PDF page with no text** (a scan inside a PDF, from before 0690) is drawn
  to a canvas at about 2000 px on its longer side, and the canvas is read.

Tesseract's words come back with pixel boxes and a confidence (0–100);
`ocrWords` (doc-words.js) turns them into the same word list a PDF's text layer
gives, as fractions of the page, keeping each word's confidence. So **nothing
in 0697 changes**: a field clicked is found on a scan the same way, and a lasso
reads the words it encloses.

`ocr.js` keeps **one Tesseract worker per window**, made the first time a page
needs reading, and reads pages one at a time. A page read once is kept for as
long as the window is open. The first read of a page says *"Reading the
page…"* on the toolbar if it takes more than a moment.

## Vendored, not fetched from a CDN

`public/vendor/tesseract/` (see its `VENDORED.md`): tesseract.js 6.0.1, its LSTM
cores (with and without SIMD), and English and German trained data
(`4.0.0_best_int`). About 12 MB in the repository; a browser downloads the
script and core (about 4 MB) and the trained data (4.3 MB) **once**: tesseract.js
keeps the trained data in IndexedDB. Nothing about a document leaves this
deployment, the same reason pdf.js is vendored (0382).

## Checked

- A German invoice rendered at 140 dpi, greyed, turned 0.6° and blurred, read by
  tesseract.js 6.0.1: every word read, confidence 84–96, `1.683,26` boxed
  beside *Gesamtbetrag*.
- In Chromium, through the real viewer: the first read took **1.6 s** (worker,
  core and trained data loading included); a second field found on the same
  page took 9 ms. The total, the date and a lasso round the VAT number all
  matched the page.
- `doc-words.test.ts`: Tesseract's blocks to words, in reading order with
  confidence, found by the same search as a PDF's text.
- `lasso.test.ts`: *"Reading the page…"* shown while a page is read, and cleared.

## Not done here

- The words read from a scan are not stored; each window reads a page again the
  first time. Storing them would come with storing where each value came from
  (the step after 0699).
- Languages are English and German. Another is one more trained-data file.
