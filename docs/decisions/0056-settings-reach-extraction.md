# 0056 — A channel's settings must actually reach extraction

**Status: built.** Fixes a gap in decision 0053.

---

## What was wrong

Decision 0053 made four extraction assumptions configurable per intake
channel: `requireLineDescription`, `maxExtractedLines`,
`currencyTolerance` and `conflictWinner`. It shipped a migration, a
settings table, an admin route to read and change the values, and
tests.

**None of it reached the image path.**

`extractInvoiceFromImages` took no `settings` parameter at all, so
every call fell back to `DEFAULT_EXTRACTION_SETTINGS` inside
`parseExtractionResponse`, `buildExtractionSchema` and
`mergePageResults`. And `extractInvoiceFromImage` — which *did* accept
settings, having been given them in 0053 — dropped them on the floor
when delegating to the multi-page path:

```ts
return extractInvoiceFromImages(model, [bytes], vocabulary);
```

An administrator could change a setting, read it back from the API and
see the new value stored. It changed nothing about how a document was
read.

---

## How the tests missed it

This is the part worth recording, because the tests were not
negligent — they were the wrong shape.

Decision 0053's tests are titled "the settings genuinely change
behaviour", and they do prove that. They call
`parseExtractionResponse` and `mergePageResults` with a settings
object constructed in the test:

```ts
const relaxed = parseExtractionResponse(withPhantom, "invoice", {
  ...DEFAULT_EXTRACTION_SETTINGS,
  requireLineDescription: false,
});
```

That proves the **functions honour settings**. It cannot prove that a
**channel's stored settings arrive** at those functions, because the
test supplies them by hand — bypassing exactly the wiring that was
missing.

A unit test that hands a dependency to the unit under test proves the
unit, never the wiring. Both were needed here and only one existed.

The new tests go through `handleCaptureImage` with a real channel id,
so the settings have to be loaded from the database and threaded
through for the assertion to hold:

- an unlabelled line row is dropped at the default setting;
- the same row survives once the channel is configured to allow it;
- a stored line cap is honoured, and the truncation reported.

---

## The fix

`extractInvoiceFromImages` now takes `settings`, defaulting to
`DEFAULT_EXTRACTION_SETTINGS` so every existing caller is unchanged,
and passes it to the schema build, the per-page parse and the merge.
`extractInvoiceFromImage` forwards what it was given.

### Settings come from the document's own channel

Two call sites load them, and neither asks the caller:

- **`handleUploadPage`** already reads the pending document row to
  check its status, so `channel_id` is in hand. Requiring the caller
  to supply settings would mean every caller querying for a channel
  this function already knows.
- **`handleFinalisePendingDocument`** loads them for the merge, which
  needs `conflictWinner` in particular — the merge is where two pages
  disagreeing gets resolved, and that resolution is configurable.

This matters beyond convenience. Settings supplied by a caller could
disagree with the channel the document actually arrived through, and
the document would then be read under rules its own channel never
configured.

---

## What this does not fix

The PDF and XML paths were not audited as part of this. `capture-pdf`
loads settings for its own use, but whether every configurable value
reaches every extraction path has only been verified for images.

**Worth an audit before the detection cascade lands** (decision 0055,
section 6), since the cascade adds two more paths that will each need
the same wiring — and the same end-to-end test, not another one that
hands settings in directly.

---

## The general point

The `cost_centre` divergence (Document 2) and
`extraction.confidence` (decision 0054) were both real values that no
rule could reference. This is the mirror image: real configuration
that no document was read under. All three were found by checking one
layer against another rather than reading either in isolation.

Storage proves nothing about addressability. An admin route proves
nothing about effect. The test has to cross the boundary.
