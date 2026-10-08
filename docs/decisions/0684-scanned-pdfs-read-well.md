# 0684: Scanned PDFs read well — their own JPEGs, their lines, and the original shown

**Status: live** at `3c0430f`, pushed and deployed 8 October 2026.

## What was asked

Dan, 8 October 2026, after 0683:

> I've had mixed results with several PDFs mailed into the system …
> Some items went to AP Review, no document is visible, some header
> information is extracted, but no line item info yet. Some went to
> Validation where the document is visible, but no information
> extracted at all.

## What the five PDFs showed

Read through the app's own API in Dan's signed-in browser. All five came
in one email (MSG-BD65-7470-AA92), and all five are scans from the same
scanner:

- one 1654×2339 colour JPEG per page (two pages for one invoice);
- each JPEG wrapped in Flate: `/Filter [/FlateDecode /DCTDecode]`;
- no text layer.

| Invoice | Stage | What happened |
| --- | --- | --- |
| 023A204E.pdf | AP Review | Header read (`pdf_images`), no lines, no document shown |
| 023F88A6.pdf | AP Review | Header read (`pdf_images`), no lines, no document shown |
| 0248E6FB (2 pages) | AP Review | Header read (`pdf_images`), no lines, no document shown |
| 0247B880.pdf | Validation | Nothing read (`intake.structure` empty) |
| 0249E0B0 (multi line) | Validation | Nothing read (`intake.structure` empty) |

## Three faults, and their fixes

### 1. The original was stored as a JPEG

`contentTypeForDetection` (`document-storage.ts`) gave an image-channel
document the sniffed image type, or `image/jpeg` by default. An ordinary
PDF now reads on the image channel (0683), so it was stored as
`image/jpeg`, and the viewer could not draw a PDF given to it as a
JPEG.

**Fix:** a document whose detection found a PDF header is stored as
`application/pdf`.

### 2. Scans were decoded and re-encoded, and two went unanswered

0683 decoded each page to pixels with PDF.js and wrote a grey PNG. For
a 1654×2339 page, that was:

- heavy CPU work for a Worker;
- a request several times the size of the JPEG.

Two of five, in one email read in turn, came back unanswered (kept for
keying, 0163).

**Fix: `embeddedJpegs`** (`pdf-read.ts`) finds every image that is a
JPEG and sends it as it is, which is what a photograph upload sends. A
JPEG here is an image whose last filter is `DCTDecode`, after at most a
`FlateDecode` with no `DecodeParms`, and which is at least 200 pixels
each way.

- The Flate wrapper is undone with `DecompressionStream`.
- `/Length` is read whether direct or by reference.
- Images are taken in file order, which is page order for a scanner, up
  to 5.
- The JPEG keeps its full resolution and colour.
- Only another kind of picture (JBIG2, CCITT, raw pixels) still goes
  through PDF.js and a grey PNG.

**Checked against Dan's five files** in the browser: each gave its
page JPEGs, 330–480 KB, both pages of the two-page invoice included.

### 3. One row without an amount threw away every line

`parseExtractionResponse` keeps lines only when every row the model
reported either reads as a line or is set aside as not one (0052).
Otherwise the whole list goes, so a total is never checked against
some of the lines.

A row with no amount at all counted as a line that failed to read. A
scanned multi-line invoice is full of such rows: a description running
onto a second line, a delivery note, a sub-heading. One of them
discarded every real line.

**Fix:**

- A row with no amount (null, absent or blank) is set aside as not a
  line item, as a row with no description already is.
- An amount that is there and cannot be read (`about 25`) still
  discards the list.

### And now it can be told

The model's raw answer is not kept, so nothing could say whether the
model saw no lines or the lines were discarded. Two facts now say it:

- `extraction.lineRows`: the rows the model reported, across every
  page;
- `extraction.linesKept`: the lines kept.

## Verification

- **`vf-app`** `pdf-read.test.ts`:
  - a new fixture shaped like Dan's scans (a JPEG inside Flate,
    `scripts/build-pdf-read-fixtures.py`);
  - the scanned PDF's page JPEG is handed over as it is;
  - the Flate-wrapped one is unwrapped;
  - capture sends the model `image/jpeg` and keeps the original as
    `application/pdf`;
  - a table with an amount-less row keeps its two real lines, with
    `lineRows` 3 and `linesKept` 2;
  - an unreadable amount still keeps none.
- **`extraction.test.ts`:** the prompt-key count leaves out the two new
  facts.
- **Full run**: vf-app 3715, of which 3712 pass: the two known failures, and the
  `index.test.ts` "need Admin.Configure" timeout under load, which passes run
  alone.
