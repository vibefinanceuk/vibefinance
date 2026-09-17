# Design: The Document Viewer

**Status: phases 1–4 built (decisions 0381, 0382, 0383, 0384); phase 5
is still design only.** Written 17 September 2026, from a conversation
about where the viewer's document panel should ultimately go — the
shape decision 0123 gestured at in September and never returned to.

Read `docs/decisions/0380-…` first if you want the immediate context:
a bug fix in the existing panel led straight into this conversation.

---

## 1. What was asked

> the ultimate goal would be to build an integrated document viewer,
> which provides users with the ability to view images (jpg, png), and
> PDF (images), and structured PDF (containing XML) in one viewer. The
> viewer would allow the user to view thumbnails in a vertical panel
> and select the image to focus in a main frame. The user could also
> rotate and zoom into the image. The user can also click expand in the
> main invoice / task page which launches the document viewer in a
> separate browser window which can be moved to a second screen and
> therefore viewed in two screen mode with the image maximised on one.
> This would also free up the space in the browser window that the
> image is leaving to maximise the invoice data in the window and help
> maximise AP entry and validation tasks. The image viewer would also
> include (as it does today) additional tabs, one being the Timeline /
> Chat tab.

---

## 2. What is actually there today, checked rather than assumed

| Document kind | How it's shown today |
| --- | --- |
| jpg / png | `<img>`, inline. No rotate. Zoom is whatever the browser gives an image. |
| Scanned image PDF | `<iframe>`; Chrome's own PDF viewer supplies scroll, zoom and its own thumbnail rail for a multi-page PDF (0042, 0123: *"the browser renders it, not us,"* a deliberate choice). |
| Structured PDF with embedded XML (Factur-X, ZUGFeRD) | **As of phase 3 (0383):** the embedded XML is retained as its own `embedded_xml` document alongside the outer PDF's `original`, and gets an XML tab the way a bare-XML invoice already does. Before phase 3, only the outer PDF bytes were retained and the embedded XML was read once for extraction, then discarded. |
| Multi-page scan uploaded page-by-page (decision 0045) | See section 3. |
| Expand | **As of phase 4 (0384):** `openDocumentWindow()` navigates a fixed-name window to `document-window.html`, a real page of this app carrying the same tabs and Timeline/Chat the embedded card shows, opened or reused via `window.open(url, name)`'s own browser-enforced single-window behaviour. Before phase 4, `openDocument()` called `window.open(url, "_blank", "noopener")` on the *raw signed file URL* — a blank tab with no app chrome, no tabs, no Timeline/Chat. |

---

## 3. A claim checked and found false: nothing is deleted

Both decision 0068 and `operator-interface.md` §2 say the multi-page
pending-document flow *"deletes on finalise."* **It does not.**

Checked directly, not assumed:

- `PendingDocumentStorage` (`pending-document-route.ts`) declares only
  `put()` and `get()`. There is no `delete` method on the interface at
  all.
- No `.delete(` call anywhere in `workers/vf-app/src`, on any R2
  binding, for any purpose.
- No `DELETE FROM pending_document_pages` anywhere.
- `markFinalised()` sets `pending_documents.status = 'finalised'` and
  `invoice_id`. It touches no row in `pending_document_pages` and no
  object in R2.

**Every page of every scanned multi-page invoice this system has ever
processed is still sitting in R2, right now, forever**, addressed by
`pending_document_pages.r2_key`, linked to its invoice through
`pending_documents.invoice_id`.

What is actually true, and worse in a different way than "deleted":
**nothing can reach it.** `handleFinalisePendingDocument` never calls
`storeInvoiceDocument`, so a multi-page-sourced invoice has zero rows
in `invoice_documents`. `preferredDocumentType()` finds nothing.
`/invoices/:id/document-url` returns nothing. The viewer shows *"No
document retained"* for a document that is, in fact, fully retained —
just not through any table or route that knows to look. The bytes are
safe; they are also invisible, which for an audit trail is a different
failure from being gone, but not a smaller one.

This changes what "phase 1" is. It is not reversing a deletion — there
is none to reverse. It is building the read path that has never
existed: a way to list a finalised invoice's pages, and a way to fetch
one.

`docs/decisions/0068` is not rewritten — records here never are — but
this document and the decision that builds phase 1 both say plainly
that its specific claim was checked and found wrong.
`operator-interface.md` §2, being a living design document rather than
a decision record, is corrected in place.

---

## 4. Three decisions, made in conversation

**A real, client-side page renderer, not the browser's PDF viewer.**
One thumbnail strip, one zoom, one rotate, shared by images and PDFs
alike, rather than an `<img>`/`<iframe>` split that behaves differently
per document kind. This is not blocked by decision 0042 — that
decision is about a *Worker* rendering a PDF; this runs in the browser,
same as the `<iframe>` does today, just with our own code instead of
Chrome's. It reverses a choice made twice for good reasons (0042,
0123: less code, and the browser already does this well), and the
reversal is deliberate: once pages are drawn by code we control, every
pixel position is known, which is exactly what decision 0206's
still-unbuilt annotation piece has been waiting on since 10 September.
**This is the largest single piece of work in this plan.**

**Start exposing retained pages, now that the false premise is
corrected.** Not a schema change — the bytes and rows already exist —
a real read path where none existed.

**The pop-out carries the whole document panel, Timeline/Chat
included**, matching the operator's own framing: the main window
becomes just the invoice data, freed of the document entirely, while
the second screen carries the document and everything that goes with
it.

---

## 5. The five phases

1. **Expose retained pages.** Backend only: a route that lists a
   finalised invoice's pages, a route that mints a signed URL for one
   of them, and the token type to carry it. No UI change yet — nothing
   today has anywhere to put a thumbnail strip.
2. **Built (decision 0382).** A client-side page renderer, shared by
   images and PDFs: one thumbnail rail, one zoom, one rotate. Replaces
   the `<iframe>`/`<img>` split in the Document tab — and, as a side
   effect nobody planned for separately, retires decision 0380's whole
   class of bug: a canvas is pixels already drawn, so nothing reloads
   it and nothing can ask a stale link again.
3. **Built (decision 0383).** The embedded XML in a structured PDF
   becomes a real, retained artifact, so Factur-X/ZUGFeRD invoices get
   an XML tab the way a bare-XML invoice already does — and it renders
   the same way bare XML already does, since the tab's dispatch was
   always keyed on content type, not document type.
4. **Built (decision 0384).** A second window carrying the whole
   document panel — the renderer from phase 2, its tabs, Timeline/Chat
   — opened by ordinary navigation to a page of our own rather than a
   raw file, so no signed-URL problem exists for the chrome itself
   (only for the bytes inside it, exactly as today). The main window's
   document card gives up its space (a toggled placeholder, not a
   rebuild) once a pop-out is open, and a fixed window name makes the
   browser itself refuse to ever open a second one — retargeting an
   already-open pop-out to a newly-opened task is the one piece that
   primitive doesn't cover on its own, and is handled explicitly.
5. **Retire what phase 2 replaced and what phase 4 replaced.** The old
   inline `<iframe>`/`<img>` preview is already gone (phase 2) and the
   raw-file `window.open` Expand is already gone (phase 4) — what, if
   anything, is actually left for this phase needs checking against
   the codebase as it now stands, not assumed from this list's
   original wording.

Each phase is its own decision record when built, in the order above,
matching how every other multi-step piece of work in this project has
gone — a plan is not a licence to skip the habit of naming what was
found and what broke along the way.

---

## 6. Open questions, deliberately not settled here

- **Rotate and zoom state — settled in decision 0382: reset every
  time.** Asked directly when phase 2 was scoped. A session
  convenience, not data worth a place to store it.
- **The pop-out and the main window agreeing they're the same
  document — settled in decision 0384.** Asked directly when phase 4
  was scoped; the operator's own answer — *"there should not be a
  situation where the user has multiple pop-out windows open"* — is
  built as a fixed `window.open` name (the browser refuses a second
  window sharing it) plus an explicit retarget on opening a different
  task while one is already up. A closed pop-out is detected by
  polling `.closed` every 700ms, since no native close event exists
  for an opener to subscribe to.
- **Annotation**, decision 0206's own deferred piece, becomes reachable
  once phase 2 gives every page a known pixel geometry — genuinely a
  sixth phase, not attempted here.
- **Whether a structured PDF's embedded XML, once retained, should
  also get a *rendered* view — settled in decision 0383: it already
  does.** `/documents/:token`'s dispatch was never keyed on document
  type, only on content type (`doc.contentType.includes("xml")`), so
  an `embedded_xml` document reaches decision 0279's rendered view
  through the same path a bare-XML `'original'` document already
  does, with no change needed.
