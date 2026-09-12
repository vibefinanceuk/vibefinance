# 0273 — A wording change, a token that carries its own answer, and a
third tab

**Status: built.**

---

## What was asked

> Can we change the message... to be "This document could not be read
> automatically. Please manually enter the fields in the cells
> provided." Also, please can you an another tab to the same
> section... Please include after document, the original XML document
> in another tab (if it exists).

---

## The wording

A straight `UPDATE`, both languages — the established pattern for
changing a string that already exists rather than the `INSERT` pattern
new ones use.

## The token now carries the answer, not the question

Before this, `/documents/:token` re-derived *"which document"* by
calling `preferredDocumentType()` — the exact same choice
`/document-url` had already made once when it minted the token. The
code's own comment already named this as fragile: *"the choice is made
twice and has to be made the same way."*

**Adding a second document type made that fragility a real bug
waiting to happen**, not a hypothetical one. A caller wanting the
original specifically now has to tell the mint route so, and the fetch
route has to honour exactly that choice — recomputing "preferred"
independently would have meant the XML tab sometimes serving the
generated rendering instead, silently, whenever the two calculations
happened to disagree.

**Fixed at the root**: the document type is now signed into the token
payload itself (`invoiceId.documentType.expiresAt`, HMAC'd as one
unit). `/documents/:token` reads it back rather than asking the
question again. There is exactly one choice now, made once, for any
given token — the fragility the old comment named is gone by
construction, not by discipline.

A new test exists for the attack this shape newly makes possible: a
token signed for the generated rendering, edited to name the original
instead. The signature does not cover a field it never signed.

## Reporting the original, not just the preview

`/api/invoices/:id` already reported `document` — whichever row was
uploaded most recently, which for an invoice with both an XML original
and a generated rendering is the rendering, not the XML. A genuinely
new field, `originalDocument`, answers a different question: does the
original exist, and what is it — regardless of what the preview
itself shows.

**Reported by content type, not filtered by it.** A native PDF's
`originalDocument` is still reported (as a PDF); the interface decides
whether that is worth a tab, the route just states the fact.

## The tab, offered only when it is real

`hasXml` checks `originalDocument`'s content type for `xml`, nothing
assumed. `documentPanel()` was rebuilt around a list of tab entries
rather than the two hand-wired branches decision 0269 left — adding a
third tab to a design built for exactly two would have meant touching
every branch a second time; a list of `{key, label, pane}` entries
lets `select()` treat all of them alike; no branch needed touching to
add one.

**One piece of genuinely dead code found while testing this, removed
rather than left.** A line meant to fall back to the Document tab if
`docPanelTab` were somehow `"xml"` on a document with none turned out
unreachable — `openViewer()` already resets that state unconditionally
for every document it opens, before `documentPanel()` ever runs.
Confirmed by removing each in turn: removing the new line changed
nothing; removing the existing reset broke the test. The dead line was
deleted; the test was kept, its own comment corrected to credit the
mechanism actually responsible.

vf-app: 1499 tests. vf-ui: 49 Worker, 318 browser. vf-licence: 320.
