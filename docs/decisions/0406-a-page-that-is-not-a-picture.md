# 0406 — A page that is not a picture

**Status: code built and tested, not yet pushed.**

---

## What was asked

The operator, immediately after decision 0405 landed: *"I sent in a new
invoice — which looks like it was rendered, but not visible on the
document."* Confirmed against `vf-app-poc` via the same read-only
diagnostic as 0405: the new invoice genuinely has both an `original`
and a `generated_rendering` row — the very first successful rendering
this system has ever produced. So the document exists; it just isn't
showing.

---

## The investigation

`documentPanel()` (`viewer.js`) calls `showPreview(invoiceId,
stored.document?.contentType)`, which hands the content type straight
to `pageViewer()` (`page-renderer.js`, decision 0382). `pageViewer()`'s
own `resolvePages()` only recognises two shapes: a PDF (`/pdf/i` on the
content type, opened with pdf.js) and everything else, which it treats
as a single image — `new Image(); img.src = <the signed document URL>`.

A `generated_rendering` document's content type is `text/html;
charset=utf-8`. That matches neither branch, falls into "everything
else," and gets handed to `<img>` as its source — which cannot decode
HTML, fails silently, and leaves the pane showing nothing. The document
was never missing; it was being asked to render as a photograph.

**Why this was never caught building 0380–0382.** Those decisions
built the canvas-based page renderer specifically for photographed and
scanned documents (images, PDFs, Factur-X) — real cases this system had
actually captured. A UBL invoice's own `generated_rendering` is a third
kind of document, HTML rather than a picture, and per decision 0405's
own finding, rendering had never once succeeded for a real invoice
until today — so this exact code path had never been exercised, and the
gap was invisible the whole time.

---

## What was built

### `workers/vf-ui/public/viewer.js`

`showPreview()` now checks the content type before routing anywhere:
an HTML document renders through `documentFrame()` — the same
signed-URL-refresh iframe `showXmlPreview()` already uses for the XML
tab, a few lines below — instead of `pageViewer()`. Nothing about an
HTML page benefits from a thumbnail rail, zoom or rotation built for a
scanned photograph; an iframe is exactly what it needs, and
`documentFrame()` already solved decision 0380's stale-signed-URL
problem generically rather than only for the canvas case. Every other
content type (PDF, image) is unaffected — same code path as before.

---

## Tests

`workers/vf-ui/test-browser/viewer.test.ts` — one new test in "the
document preview" describe block: an invoice whose document content
type is `text/html; charset=utf-8` renders through `#vpreview iframe`,
not `.vpagesroot`/`canvas.vcanvas`. Fail-first verified (stashed
`viewer.js` alone, confirmed the new test failed — no iframe present —
restored the fix, confirmed it passes). Full `vf-ui` browser suite:
**711/711** (710 + 1 new).

`eslint` clean.

---

## What is not built

**`page-renderer.js`/`resolvePages()` itself is untouched.** The fix
sits one layer up, at the point that decides whether to call into the
page renderer at all, rather than teaching `resolvePages()` a third
`kind`. `page-renderer.test.ts`'s own coverage (rotate, zoom, the
thumbnail rail, PDF vs. image resolution) is unaffected and did not
need a matching HTML case, since HTML never reaches it now.
