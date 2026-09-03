# Design: Text-Layer PDF Extraction

Status: **design only — nothing here is built.** Written 3 September
2026, after the original Morrison PDF was examined for the first time.

## 1. The mistake this corrects

Two days were spent teaching a vision model to read a document that
carries its own text.

The Morrison invoice was tested as PNG scans — 1.5MB and 2.8MB,
visibly skewed, grey, with artefacts. Everything difficult about this
week came from that: the timeout that forced per-page calls, the
fabricated total, the phantom line, the page conflicts, the three
resolution rules.

The original PDF is **133KB with a complete text layer**. Every value
extracts exactly:

```
Sales No:G23281 / Pascal Koslowski / DUS  SUBTOTAL 3,137.47
Created by: Nikolai Slama (NSL) ADD VAT 0.00
Quotation No: QDUS00001814 TOTAL  EUR 3,137.47LOA No:
```

The total the model invented as 2,272.47 is printed, extractable, and
exact.

**We have been treating the hard case as the default.** A business
invoice is usually a generated PDF, not a photograph.

## 2. What this does not invalidate

The vision path is still needed. Genuine scans and photographs exist,
have no text layer, and only a model can read them. Everything built
for them — per-page calls, the merge, conflict surfacing, validation —
is real work for a real case.

What changes is the **order**. Text extraction should be tried first,
and the vision model should be the fallback rather than the default.

## 3. `env.AI.toMarkdown()`

Workers AI provides document conversion as a built-in. For PDFs it
does not OCR: it extracts a `StructTree` — the PDF's own tagged
element structure, per ISO 14289 (PDF/UA) — and builds a semantic
Markdown representation. Where no `StructTree` exists it falls back to
the page's raw text.

Either way it reads **characters that are in the file**, not pixels.

Cloudflare's own example response shows `"tokens": 0` for a PDF, and
their text-based conversion is documented as free. So this path costs
nothing in inference, which is a strong argument for trying it first
regardless of accuracy.

## 4. Text still needs interpreting

Extraction gives a layout, not fields. `"TOTAL  EUR 3,137.47LOA No:"`
is exact text and still needs turning into `BT-112: 3137.47`.

Two options:

**Pattern rules.** Deterministic, no model, no fabrication — and
brittle across suppliers. Every invoice layout differs, and a rule set
that works for Morrison would need rewriting for the next supplier.
This is the trap the closed vocabulary and compiler were built to
avoid.

**A text LLM with the same schema.** The extraction schema already
exists (decision 0043) and is vocabulary-aware. Sending text rather
than an image changes the input, not the contract.

**The second, and the reason is specific.** A model reading extracted
text *cannot fabricate a total that is not in the text* — not because
it is better behaved, but because it is reading characters rather than
inferring from pixels. That removes the failure that has dominated
this week, without inventing a new mechanism.

It is also cheaper: a text model on ~2,000 characters costs far less
than a vision model on a megabyte of image.

## 5. The routing

```
PDF arrives
 ├─ has embedded XML (Factur-X / ZUGFeRD)? → parse it        EXACT
 ├─ toMarkdown yields usable text?         → text LLM        NEAR-EXACT
 └─ no text layer                          → 501, or images  INFERRED
```

The first branch already exists (decision 0042). The second is new.
The third is today's behaviour.

**"Usable" needs defining, and this is the one real judgement call.** A
scanned PDF may still yield a few stray characters. A threshold — some
minimum character count, or requiring digits and letters both present
— would work, and any threshold is a guess until measured against real
documents. It should be a configurable setting (decision 0053), not a
constant.

## 6. What this changes, by component

| Component | Change |
|---|---|
| `capture-pdf` | Try `toMarkdown` after the embedded-XML check |
| New: text extraction | The same schema, a text model, no image |
| `ExtractionModel` | A second method, or a sibling interface |
| Vision path | Unchanged, but reached less often |
| Settings | A "minimum text to trust" threshold |

Multi-page becomes largely irrelevant here: a 133KB PDF goes in one
call, and `toMarkdown` returns the whole document with page markers
already in it.

## 7. What it would have prevented

Worth listing, because it is the argument for the change:

- The fabricated total (0045) — the real one is in the text
- The phantom line (0052) — page 2's table is genuinely empty
- Page conflicts (0048, 0050) — one document, one extraction
- The timeout (0047) — 133KB, not 4.3MB
- Three resolution rules — nothing to resolve

None of that work is wasted; it is needed for genuine scans. But for
this document, none of it would have been necessary.

## 8. Open questions

1. **What counts as "usable" text?** Needs measuring against a real
   scanned PDF, not guessing.
2. **Does `toMarkdown` preserve enough structure?** The example shows
   page markers and metadata; whether a charge table survives
   readably is unknown until tested.
3. **Which text model?** `gpt-oss-120b` already runs the compiler and
   is known to work with this codebase's JSON discipline.
4. **Does `guided_json` work the same way on a text model?** Assumed,
   not verified.
5. **Should a text-extracted invoice still carry a confidence score?**
   Arguably not: the values are transcribed, not inferred. But the
   interpretation step is still a model, so something is being judged.
6. **What about hybrid documents** — a text-layer PDF whose line table
   is a scanned image? Real, and not addressed here.

## 9. Suggested order

1. **Prove `toMarkdown` on the real PDF.** One call. Answers questions
   2 and 3 immediately, and costs nothing.
2. **Text extraction behind the existing schema**, tried before the
   vision path.
3. **The usable-text threshold**, as a setting.

Step 1 is worth doing before committing to any of this.
