# 0690: A scanned PDF is read and shown from smaller working pages; the original is kept

**Status: built**, in bundle 0989. vf-app (migration `0151_invoice_pages.sql`,
new `images` binding in `wrangler.jsonc`). Cloudflare Images must be enabled on
the account.

## What was asked

Dan, 8 October 2026, after the day's testing used up Workers AI's free daily
allowance (`AiError: 4006`):

> I think we should take any image PDF, and create a localised version of it,
> with much smaller filesize such that it can be processed more efficiently.
> The original can be retained and stored as an attachment, but the new version
> should be smaller in size.

He chose (AskUserQuestion) Cloudflare Images to make it, and the smaller copy
for both reading and viewing. Then:

> what will be the local storage format? please keep in mind I would like to
> enhance the document viewer to support lasso functionality. Any design
> decision made here should have that in mind

## What is kept

For a scanned PDF (one read from page images, `intake.read = pdf_images`):

| What | Where | Used for |
| --- | --- | --- |
| The PDF as it arrived | R2; `invoice_documents`, type `original` (for email, the message part itself) | The Attachments tab, download, audit |
| One working page per page: a greyscale JPEG, no more than 1600 px a side, quality 70 | R2 at `{customer}/{year}/{invoice}/pages/{n}.jpg`; one `invoice_pages` row each, with `width`, `height`, `original_width`, `original_height` | What the model reads; what the viewer draws |

`invoice_pages` rows are retained pages: `listRetainedPages` and `retainedPage`
read them alongside a multi-page upload's pages (0381). So the viewer's page
renderer (0382) draws them as page images with its rail, zoom and rotate, and
does not open the PDF.

`intake.reduced` on the invoice says what happened, for example
`1 page, 812 KB to 96 KB`, or `not reduced: <why>`.

## Why one image per page, not a smaller PDF

The first build wrapped the small pages in a PDF. Dan's lasso question changed
that:

- A lasso is drawn on a page **image**. With the page stored as the image the
  viewer shows, a region drawn there is in that image's pixels: no PDF
  rendering scale or page box to convert through.
- Stored as **fractions of the page** (0–1), a region maps to the working page
  for cropping, and through `original_width` and `original_height` to the scan
  at full resolution where a sharper crop helps a small font.
- The crop can be made by Cloudflare Images too (`trim`), from the stored page,
  and sent to the model on its own: a small, cheap call that reads one value.
- It is the same image the model read the whole page from, so what a person
  sees, what the model saw, and where a value came from all line up.

## How it is made

`page-shrink.ts`, with `imagesShrinker(env.IMAGES)`:

```
transform { width: 1600, height: 1600, fit: "scale-down", saturation: 0 }
output    { format: "image/jpeg", quality: 70 }
```

The work is done outside the Worker. Decision 0684 found that decoding and
re-encoding inside it caused time-outs.

**Never worse than before:**

- A page is replaced only by a valid JPEG that is smaller than the original.
- Working pages are kept only when **every** page was made smaller, so the
  viewer never mixes sizes. Pages that were made smaller are still read smaller.
- If Images is not bound, fails, or saves nothing, the original pages are read
  and the PDF is shown, exactly as before.

The shrinker reaches every path that reads a scan: an email read later (0687)
or at once, Reprocess, and `POST /sources/:id/capture`.

## Cost

Cloudflare Images: 5,000 unique transformations a month free (one per page),
then $0.50 per 1,000. A 1600 px greyscale page is a fraction of a 1654×2339
colour scan, which is the point: fewer Workers AI neurons per page.

## Not done here

- Digital PDFs (with a text layer) are unchanged. Their lasso is the PDF's own
  text layer in the browser.
- Photographs (JPEG/PNG attachments) are unchanged. The same shrinker could
  serve them.

## Tests

`test/email-limit-and-shrink.test.ts`:

- the smaller page is read in both calls (header and lines);
- the original is stored byte for byte as the only document;
- one `invoice_pages` row with the working and original sizes, served as a
  retained page;
- a failed shrink keeps the original and records why;
- no binding changes nothing;
- working pages are kept only when every page shrank;
- `imageSize` and `jpegSize`.
