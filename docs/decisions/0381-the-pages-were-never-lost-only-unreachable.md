# 0381 — The pages were never lost, only unreachable

**Status: built.** Phase 1 of `docs/design/document-viewer.md`. Corrects,
without rewriting, decision 0068's claim that the multi-page pending-document
flow *"deletes on finalise."*

---

## What was asked

Not this, directly. The operator's request was the whole viewer:

> the ultimate goal would be to build an integrated document viewer, which
> provides users with the ability to view images (jpg, png), and PDF
> (images), and structured PDF (containing XML) in one viewer... Can we
> discuss the document viewer next. This is the card in the viewer page in
> which the document is viewed. Early conversation we have had were parked.

Three things were decided in that conversation and recorded in the design
document: a real client-side page renderer rather than the browser's PDF
viewer, retaining every page of a multi-page scan rather than reconsidering
whether to, and a pop-out that carries the whole document panel — Timeline
and Chat included — not just the image. Asked which to build first:

> Want me to write that design doc now and then start on phase 1 (page
> retention), or would you rather reorder...
>
> yes please

---

## The premise, checked before building anything

Decision 0068 and `operator-interface.md` §2 both say the multi-page flow
*"deletes on finalise."* Scoping phase 1 meant reading that path directly
rather than trusting either:

- `PendingDocumentStorage` declares only `put()` and `get()` — no `delete`
  on the interface at all.
- No `.delete(` call anywhere in `workers/vf-app/src`, on any binding.
- No `DELETE FROM pending_document_pages` anywhere in the codebase.
- `markFinalised()` sets `pending_documents.status` and `invoice_id`. It
  touches no row in `pending_document_pages` and no R2 object.

**Every page of every multi-page scan this system has ever processed is
still in R2**, addressed by `pending_document_pages.r2_key`, reachable in
principle through `pending_documents.invoice_id`. What is true, and worse
in a different way than deleted: **nothing could reach it.**
`handleFinalisePendingDocument` never calls `storeInvoiceDocument`, so a
multi-page-sourced invoice has zero rows in `invoice_documents`.
`preferredDocumentType()` finds nothing for it.
`/invoices/:id/document-url` returns nothing. The viewer said *"No
document retained"* about a document that was, in fact, fully retained —
invisible rather than gone, which for an audit trail is a different
failure, not a smaller one.

This changed what phase 1 is. Not reversing a deletion — there was none to
reverse. Building the read path that never existed.

`docs/decisions/0068` is not rewritten. This record and the design
document both say plainly that its specific claim was checked and found
wrong. `SUPERSEDED.md` gets a row. `operator-interface.md` §2, a living
document rather than a decision record, was corrected in place already,
alongside decision 0380.

---

## What was built

**Two functions, `pending-document-route.ts`**, joined through
`pending_documents.invoice_id` — the one column already carrying the link
from a pending document to the invoice it became, set by `markFinalised()`
— rather than a second copy of that link on `invoice_headers`, which could
disagree with the first:

- `listRetainedPages(db, invoiceId)` — every page's number and content
  type, in page order. An invoice with no pending-document ancestry
  (everything captured through `/sources/:id/capture` instead) simply has
  none; an empty list is the honest answer, not an error.
- `retainedPage(db, storage, invoiceId, pageNumber)` — one page's bytes.
  Returns `null` for a page that does not exist and, separately, for a row
  that exists over an R2 object that does not — both are "nothing to
  serve," and the caller does not need to tell them apart from here.

**A second token shape, `document-token.ts`: `mintPageToken` /
`verifyPageToken`.** Not a third value on `DocumentType` — that type is
`"original" | "generated_rendering"`, matching `invoice_documents`'s own
`CHECK` constraint exactly, and a page is neither; it lives in a different
table, addressed by number rather than by that closed vocabulary. Widening
it to describe something it does not gate would save four lines and cost
the guarantee. A leading `"page"` literal (`page.<invoiceId>.<pageNumber>.
<expiresAt>.<sig>`, five dot-parts against the document token's four) makes
the two shapes unmistakable at a glance, reuses the same HMAC-SHA256
machinery decision 0073 chose, and checks the signature before the expiry
for the same reason as that token: telling a forgery it was merely
mistimed would be telling it more than it earned.

**Three routes, `index.ts`**, the same shape as the existing document-url
pair (decision 0073):

- `GET /invoices/:id/pages` — session or API key (decision 0105),
  `AP.Validate`. Lists what `listRetainedPages` finds. Not gated on the
  licence being blocked, matching every other document read on this
  invoice.
- `POST /invoices/:id/pages/:n/document-url` — same auth, mints a page
  token, 404s a page number that does not exist rather than minting a
  link to nothing.
- `GET /document-pages/:token` — deliberately unauthenticated, the token
  IS the authority, same reasoning as `/documents/:token` immediately
  above it in the file. A separate route rather than a third branch on
  that one: its `DocumentType` matches a real constraint; a page does not.

**vf-ui's proxy allow-list** (`workers/vf-ui/src/index.ts`) gets two new
entries for the first two routes, immediately after the existing
document-url pattern — the pattern decisions 0212 and 0324–0328 already
found live six times over: a route existing and tested in `vf-app` proves
nothing about whether `vf-ui`'s allow-list forwards it.

---

## Tests, watched to fail against the code before this change

`document-token.test.ts`, a new describe block mirroring the existing
`mintDocumentToken`/`verifyDocumentToken` tests exactly: round-trip,
5-minute expiry, rejection one tick past it, forgery on each of the three
fields (invoice, page number, expiry), a stale-but-correctly-signed token
reported as a bad signature rather than expired, and malformed input
including a document token — four dot-parts, no `page` prefix — presented
where a page token is expected.

`pending-document.test.ts`, a new describe block against a realistically
finalised two-page invoice built with the existing `memoryStorage()` and
`PAGE_ONE`/`PAGE_TWO`/`PNG_PAGE` fixtures: pages listed in order regardless
of upload order or format, an empty list for an invoice with no
pending-document ancestry, a page's real bytes read back by invoice and
page number, `null` for a page number that does not exist, `null` for an
invoice with none at all, `null` rather than a throw when a row survives
but its R2 object does not, and — the regression decision 0068's false
claim earns its own pin — that both pages are still there after
finalisation.

`session-routes.test.ts` gets the two authenticated routes added to the
existing "the routes a browser needs accept a session" table, the same
reachability check the keying screen's document-url route already had.

**Watched fail first.** With `src/document-token.ts` and
`src/pending-document-route.ts` reverted to their pre-change state — the
functions this record adds simply absent — 17 of the 19 new tests failed
with `TypeError: ... is not a function`; the reachability additions in
`session-routes.test.ts` are unaffected by that revert and were checked
separately by reasoning through `handleProxy()`'s existing session-check-
before-dispatch order, the same reasoning decision 0380's summary records
for why the existing document-url reachability test only proves allow-list
membership, not method compatibility — a limitation this change inherits
rather than introduces.

vf-app: 1912 tests (was 1893). vf-ui: 74 Worker tests (unchanged), 631
browser tests (unchanged — this phase touches no browser-side code).
`tsc --noEmit` clean in both packages; `eslint` clean.

---

## What is not built

- **Phase 2, the client-side page renderer.** Nothing today has anywhere
  to put a thumbnail strip; these routes exist and nothing calls them yet.
  The Document tab still shows the `<img>`/`<iframe>` split it always has.
- **Phase 3, the embedded XML in a structured PDF as its own retained
  artifact.**
- **Phase 4, the pop-out window**, and **phase 5, retiring the old
  preview and the raw-file Expand** — both wait on phase 2.
- **A UI affordance for anything built here.** This phase is backend
  only, by design (section 5 of the design document): a foundation the
  next phase calls, not a feature an operator can reach yet.
