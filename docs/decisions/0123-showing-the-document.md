# 0123 — Showing the document

**Status: preview built.** The viewer frame and field highlighting are
designed here and not built.

---

## The preview was always possible

Decision 0042 records that **a Worker cannot render a PDF**. True, and
it was read for longer than it should have been as *"this cannot be
previewed"* — so the document panel has been a grey box and a button
that opens another window.

**The browser renders it.** A PDF in an `<iframe>` gets the browser's
own viewer, with scrolling and zoom already working. An image goes in an
`<img>`. Both use the signed URL that already existed (decision 0073).

The read route now reports the document's content type, because getting
the frame and the image the wrong way round shows nothing.

**Not awaited.** A slow R2 fetch should not hold up somebody who already
knows what to type.

---

## The ultimate shape, and why it is not the obvious one

The operator's goal: a viewer frame with **zoom, resizing, field
highlighting, and annotation**.

Field highlighting needs to know **where on the page each value came
from**, and nothing records that. Extraction returns values and a
confidence score, and no coordinates at all.

I described that as the hard part. **It is, on the scanned path — and
the operator inverted it for every other path:**

> For full UBL invoices, I would want the system to render an invoice on
> receipt, and store with the UBL — if a physical page does not exist.

**If we render the page, we know where every field is**, because we put
it there. No bounding boxes to extract, no matching values back to
positions. Highlighting becomes exact precisely where the data is most
reliable, and approximate only on the scanned path where the data is
inferred anyway.

That is a better architecture than the one I was reaching for.

### The schema anticipated it

`invoice_documents.document_type` already permits
**`'generated_rendering'`** alongside `'original'`, and nothing has ever
produced one. The place to put a rendered page exists.

### Render to HTML, not PDF

A Worker cannot render a PDF and generating one is awkward. HTML
renders natively in the frame, stays selectable and zoomable, and
**highlighting becomes CSS on elements we positioned** rather than
coordinates drawn over a canvas.

It stores in R2 beside the original just as well.

---

## And it must say what it is

The operator's own wording:

> "Fully digital invoice received. This page has been rendered by
> VibeFinance for viewing purposes."

**This is the same discipline as decision 0055.** This project never
presents inferred data as exact, and a rendered page that did not say so
would be that error in a new place — somebody would reasonably believe
they were looking at what the supplier sent, and could say so to an
auditor.

---

## What is not built

- **The rendering itself.** Nothing produces a `generated_rendering`.
- **The viewer frame.** Zoom and resizing come from the browser's PDF
  viewer today, which means they look like the browser rather than like
  this application, and an image gets neither.
- **Field highlighting**, which needs the rendering first on the digital
  path, and coordinates from the model on the scanned one.
- **Annotation.** Not designed at all — where a note lives, whether it
  is part of the document or beside it, and who may see it.
- **The five-minute URL expiring mid-session** (decision 0073). A frame
  left open through a long keying session goes blank, and nothing
  refreshes it.
