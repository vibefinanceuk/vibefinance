# 0205 — Something a person can look at

**Status: built.** A UBL invoice is rendered at capture and stored
beside the original.

---

## Decision 0018 named this and nothing produced one

That record created the `generated_rendering` document type and said
why: **a plain XML invoice has nothing a person can look at.** It has
been an allowed value with no producer since September, and the viewer
showed raw markup in an iframe.

---

## The official stylesheet, and why we could not run it

OpenPEPPOL publishes `stylesheet-ubl.xslt` — the rendering every Peppol
tool uses, with its own CSS, 249 countries, the UNCL1001 document types
and sixty labels in two languages.

**It is XSLT 2.0.** Browsers implement 1.0, and `xsl:function` is not in
1.0.

**SaxonJS is the only viable processor and it does not run in
`workerd`.** Proven rather than assumed:

```
ReferenceError: abstractNode is not defined
  at node_modules/saxon-js/SaxonJS2N.js:4295
```

On import, before any transform. The npm package is *"for Node.js"* and
the browser build is a separate download from Saxonica.

**An hour to find out**, rather than a day to discover.

---

## So: their design, our traversal

The renderer emits the same markup with **their CSS, their code lists
and their labels**. We own the presentation of nothing.

**The data is transcribed by script, never by hand.** Decision 0200 is
why — writing a permission list into SQL that week, I invented five that
do not exist, omitted five that do, and then missed an entire namespace
correcting it. This is 262 codes and sixty labels, and a person would be
worse. `scripts/extract-peppol-render-data.py` reads the stylesheet's
own variables.

### And I reached for the wrong parser first

`DOMParser` does not exist in `workerd`. **Decision 0018's UBL parser
had already solved this** — `fast-xml-parser`, with `removeNSPrefix` —
and I wrote a hundred lines against a browser API before the tests said
so.

The project knew and I did not look.

---

## Rendered at capture, not at view

The operator: *"I would not want performance impact for the user in the
viewer."*

**And there is a second reason.** What somebody saw when they approved
an invoice becomes a **record**, rather than something recomputed later
from a stylesheet that may have changed.

**A rendering that fails is not a retention that fails.** The original
is stored either way, and a document that cannot be rendered is one a
person reads as XML — not one that was lost.

---

## The notice, and the print rule

> Rendered automatically from the XML source received. Source document
> TEST-ORG-0001. The XML is the original; this page is a view of it.

**With the document's own identifier**, because a notice saying *"this
is a rendering"* without saying *of what* leaves somebody with nothing
to ask for.

**And it survives printing.** The official stylesheet hides its footer
on paper — `@media print { #footer { display: none } }` — which is right
for a customization URN and **exactly wrong for this**: a printed copy
that does not say it is a rendering is one somebody will take for the
original.

---

## One choice, made in two places

`document-url` reports a content type; `/documents/:token` serves bytes.
**The token names an invoice, not a document**, so both must pick the
same file — or the viewer chooses an `<img>` or an `<iframe>` for one
and is handed another.

I wrote *"one helper for that reason"* in a comment and then did not
write one. `preferredDocumentType` exists now, and a test proves both
sides use it.

**Ordered by type, not by `uploaded_at`** — decision 0152 found that
same-second timestamps fall back to insertion order, which is not a rule
anybody could state.

---

## What is not built

- **The rendering is plainer than the official one.** It shows parties,
  metadata, totals and lines; the stylesheet also renders delivery,
  payment means, an attachments section and a tax breakdown. **The spine,
  not the whole document.**
- **English and Norwegian**, because that is what OpenPEPPOL's labels
  ship. A German customer gets English, which is a fact about the
  upstream artefact rather than about this.
- **`render.refused` is stored and read by nothing** — decision 0162's
  own shape, for the fourth time this month.
- **Nothing re-renders.** An invoice captured before this stays as raw
  XML for ever, and the same is true of every improvement to the
  renderer.
