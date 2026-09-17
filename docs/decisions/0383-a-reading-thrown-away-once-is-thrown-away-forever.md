# 0383 — A reading thrown away once is thrown away forever

**Status: built.** Phase 3 of `docs/design/document-viewer.md`.

---

## What was asked

Phase 2 (decision 0382) closed with a question about what to build
next, weighing phase 3 (embedded XML retention, next in the design
document's own stated order) against phase 4 (the pop-out, possibly
more visible) and noting annotation (decision 0206) was newly reachable.
The operator answered directly:

> Lets do the order written, so phase 3 next

Phase 3, as the design document states it:

> The embedded XML in a structured PDF becomes a real, retained
> artifact, so Factur-X/ZUGFeRD invoices get an XML tab the way a
> bare-XML invoice already does.

---

## The premise, checked before building anything

Migration `0018`'s own comment named three document cases and said a
Factur-X/ZUGFeRD hybrid needs *"one 'original' row only, since the
received PDF/A-3 already embeds the XML — no separate rendering
needed."* True of what `retainOriginal()` stores, and it undersold what
a person actually wants to see. `pdf-attachment.ts` reads the embedded
XML once, for extraction, and hands it back inside `DetectionResult` —
`detect-structure.ts` already threads it as far as `retainOriginal()`.
Nothing keeps it past that call. A hybrid invoice has no XML tab at
all, unlike a bare-XML invoice retaining the exact same kind of data
under `document_type = 'original'`.

`'embedded_xml'` is a genuine third case, not a rendering of anything —
it is the authoritative data the PDF already carried, retained on its
own so it can be shown the way an `'original'` XML document already is.
This is the case decision 0381's page tokens deliberately did *not*
create by widening `DocumentType`: pages live in a different table,
addressed by number, and got their own token shape instead
(`document-token.ts`'s own comment explains why). The embedded XML is
different — it is a real row in `invoice_documents`, matching the same
`CHECK` constraint every other document type does, so widening the
vocabulary is the correct move here, not the wrong one 0381 avoided.

---

## What was built

**Migration `0070`**: widens `document_type`'s `CHECK` from two values
to three (`'original' | 'generated_rendering' | 'embedded_xml'`).
SQLite cannot `ALTER` a `CHECK` constraint in place, so the table is
rebuilt — the same approach migration `0033` used to widen a status
column. Every other column and every existing row carries across
unchanged; no index existed on this table to drop and recreate first.

**`source-capture-route.ts`**: `retainOriginal()`'s `detection`
parameter widened with an optional `embeddedXml?: string`. A new
branch, parallel to the existing `structured_xml` rendering branch,
stores it as its own `embedded_xml` document when
`detection.structure === "structured_pdfa"` and the field is present —
same failure handling as the rendering branch: a `UNIQUE` collision or
a transient R2 failure here leaves the outer PDF retained and the
invoice usable either way.

**`document-storage.ts`, `document-token.ts`, `document-route.ts`,
`index.ts`**: `DocumentType` widened everywhere it is declared or
matched — the token mint/verify pair, the route's own type guard and
error messages, and the `document-url` route's type-selection branch.

**A real bug, found before it could ship: `preferredDocumentType`'s
`ORDER BY CASE` had no `ELSE`, so an unranked value evaluates to
`NULL` — and SQLite sorts `NULL` before every real value ascending.
`embedded_xml`, left unranked, would have silently outranked both
`original` and `generated_rendering` the moment a row of that type
existed.** Fixed by giving it its own rank (`WHEN 'embedded_xml' THEN
2`, after `generated_rendering`, before nothing — `original` is never
displaced). Watched fail: removed the rank, reran, got exactly the
predicted wrong `documentType`, restored.

**A second, more serious bug, in different code: `invoice-facts-route.
ts`'s `handleGetInvoice` computed its own `document` response field
with an independent `ORDER BY uploaded_at DESC LIMIT 1` query, rather
than calling `preferredDocumentType()` — the single function decision
0273's own comment says exists so *"two copies of the same ORDER BY
would eventually not agree."* They had agreed by coincidence: both
`generated_rendering` and, now, `embedded_xml` are inserted after
`original`, so "most recently uploaded" and "actually preferred"
happened to be the same row. Adding a document type that is inserted
after `original` but is **not** the preferred one broke that
coincidence outright — a hybrid invoice would report `embedded_xml` as
what the preview shows, while `/invoices/:id/document-url` (which does
call `preferredDocumentType`) actually serves the outer PDF. Two call
sites disagreeing, exactly the class decision 0273 named and exactly
what building a test *before* checking whether the code already
handled it correctly is meant to catch. Fixed by replacing the ad-hoc
query with a direct call to `preferredDocumentType(db, invoiceId)`,
making it the only implementation of that choice, and adding a second
field, `embeddedXmlDocument`, reported alongside rather than instead
of it.

**`viewer.js`**: `loadInvoice()` carries `embeddedXmlDocument` through
from the response. `documentPanel()`'s `hasXml` now also checks for it,
alongside the existing bare-XML check. `showXmlPreview()` asks for
`"embedded_xml"` when one is retained and falls back to `"original"`
otherwise — a hybrid invoice's XML tab now requests the embedded
invoice specifically, never the outer PDF.

**The XML tab's rendering was already generic, and stays that way.**
`/documents/:token`'s dispatch branches on `doc.contentType.includes
("xml")`, not on `documentType` — so an `embedded_xml` document, with
`contentType: "application/xml"`, reaches `renderXmlForDisplay()`
(decision 0279's dark-styled, escaped HTML wrapper) through the exact
same code path a bare-XML `'original'` document already does, with no
change needed. This answers the design document's own open question
in section 6 — *"should a structured PDF's embedded XML, once
retained, also get a rendered view the way bare XML does, or only the
raw-XML tab bare-XML invoices get today"* — the rendered view, because
the branch was never keyed on document type to begin with.

---

## Tests, watched to fail

Every new assertion below was run against the pre-fix code first and
confirmed to fail before the fix landed, per this project's standing
discipline.

- **`document-storage.test.ts`**: a third real document type stores
  and counts correctly alongside `'original'` (19/19).
- **`document-token.test.ts`**: the third type round-trips through
  mint/verify (22/22).
- **`peppol-render.test.ts`**: `preferredDocumentType` never prefers
  the embedded XML over the outer PDF it came from, and a generated
  rendering still outranks both (31/31) — this is where the `ORDER BY
  CASE` bug was caught.
- **`source-capture.test.ts`**: a hybrid PDF retains the embedded XML
  as its own artifact under its own key, distinct from the outer
  PDF's; an ordinary UBL invoice retains no such second artifact
  (32/32).
- **`key-fields.test.ts`**: `handleGetInvoice` reports the embedded
  XML without disturbing what the preview shows — the outer PDF stays
  the served document; every ordinary invoice reports `null` (44/44) —
  this is where the `invoice-facts-route.ts` regression was caught,
  before it could ship.
- **`viewer.test.ts`**: the XML tab is offered for a hybrid PDF that
  retained its embedded invoice, and it asks for `type=embedded_xml`
  specifically, never `type=original` (120/120 in this file; 122
  unhandled-rejection errors, the known pre-existing class from
  decisions 0380/0382, unchanged).

**Full suites, run together rather than file by file.** `vf-app`: 77
test files, 1921 tests, all passing (up from 1912 at decision 0382).
`vf-ui`: 74 Worker tests, unchanged; browser suite 120/120 in the
touched file, matching the per-file count above (this phase touched
one browser test file; the rest of that suite was not rerun as a whole
in this arc). `vf-licence`: 320 tests, unchanged — this phase touches
no `vf-licence` file. `tsc --noEmit` clean in `vf-app` and `vf-ui`
once one new test's own `.map()` callback got the explicit parameter
annotation every other query-result `.map()` in this codebase already
carries (a defensive habit against `cloudflare:test`'s import failing
under bare `tsc`, not a real type error). `eslint` clean, both on the
touched files and across the whole repository.

---

## What is not built

- **Phases 4–5**: the pop-out window carrying the whole document
  panel, and retiring the old inline preview and raw-file Expand —
  both still design only, both waiting on phase 2 (built) rather than
  this phase.
- **Annotation** (decision 0206), reachable since phase 2, not
  attempted here — its own, later piece.
- **A route-level integration test for `/documents/:token`, for any
  document type.** Checked directly rather than assumed: no existing
  test drives that HTTP route end-to-end for a bare-XML `'original'`
  document either, only `renderXmlForDisplay()` at the unit level. The
  branch that reaches it is generic on content type, not document
  type, and is exercised by that unit test — real but pre-existing
  test-coverage gap, not one this phase introduced, and closing it for
  every document type at once was out of scope for adding one more
  type to an existing table.
