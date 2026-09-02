# 0043 — Vision extraction, and what cannot be verified from here

Status: built, live-tested once, **corrected** — and still not fully
verified. Step two's remaining half, completing the three intake
paths. See the addendum at the end: the first live test found the
exact bug this document flagged as its own biggest risk.

This decision doc is unusual in one respect and it is worth saying so
at the top: the most important claim it makes — that a vision model
actually reads an invoice correctly — has not been tested. It cannot
be, from here. Everything around that claim has been.

## The three paths, now complete

| Document | Handling | Nature |
|---|---|---|
| UBL/XML | `parseUblInvoice` | Exact |
| Hybrid PDF (Factur-X / ZUGFeRD) | Extract embedded XML, then parse | Exact (decision 0042) |
| Photograph or scan | Vision model | **Inferred** |

The ordering is deliberate and load-bearing. This path is reached only
when neither other can apply. Nothing that could have been parsed
should ever be inferred.

`handleCaptureImage` refuses a PDF outright with a message pointing at
`/capture-pdf`, because a hybrid PDF read as a picture would silently
substitute inferred data for mandate-grade data — the exact regression
decision 0042 exists to prevent. Watched to fail: removing that guard
breaks the test.

## Why a separate endpoint rather than a fallback

`capture-image` is its own route, not something `capture-pdf` degrades
into. A caller submitting a photograph knows they are submitting one,
and the difference between exact and best-effort data should be
explicit at the point of submission rather than discovered afterwards.

The response says so too: `documentPath: "image-extraction"`, a
`confidence` score, and a `missingFields` list. A caller must be able
to tell at a glance that this data was inferred.

## Model choice, and how to change it

`@cf/meta/llama-4-scout-17b-16e-instruct`, for three reasons:

1. **Natively multimodal.** Cloudflare's own writeup draws the
   distinction: Llama 3.2 used *separate* parameters for vision and
   text, so an image request engaged only the vision half. Llama 4's
   parameters understand both together — which is what reading an
   invoice actually requires, since it is reasoning about text within
   a layout, not recognising a picture.
2. **Structured outputs** via `guided_json`, so the response is
   *constrained* to a schema rather than politely asked for one. The
   compiler needed `extractJson()` recovery precisely because that
   option did not exist there.
3. The same `messages` shape `gpt-oss-120b` already uses, so
   `extraction-model.ts` mirrors `compiler-model.ts` closely.

**Moondream was the obvious OCR candidate and is the wrong choice
here.** Its fixed task enum (`query`, `caption`, `point`, `detect`)
takes a single `question` string — extracting a dozen invoice fields
would mean a dozen calls.

Changing the model is `EXTRACTION_MODEL_ID` in config, not a code
edit, so evaluating alternatives against real invoices costs a
redeploy.

## What is genuinely unverified

**The image request shape.** The model's own Workers AI parameter page
documents only `prompt` and shows text-only examples. The
`image_url` content-part shape comes from Cloudflare's
`workers-ai-provider` changelog — *"Send images as OpenAI-compatible
image_url content parts inline in messages, enabling vision for models
like Llama 4 Scout"* — which is well-supported but not the model's own
documentation.

It is isolated in a single function, `buildVisionMessages`, precisely
so a correction is a small local edit rather than a change rippling
outward. This is the first thing a live test will confirm or correct.

**Extraction accuracy itself.** `env.AI` has no local simulation, so
no test here exercises a real model. Whether Llama 4 Scout reads a
real invoice well is unknown until someone runs it against one.

What *is* tested — thoroughly — is everything around it: the schema,
the prompt, coercion, refusals, the PDF guard, capture-event
recording, and custom-field integration. 38 tests.

## The type system doing real work

Decision 0041 deferred coercion; this is where it lands. A `number`
field returned as `"approximately 500"` must fail to coerce, not
silently become 500.

**The first implementation got this wrong**, and a test caught it. The
"tolerate a stray currency symbol" cleanup stripped *any* leading
non-digits, so `"approximately 500"` parsed cleanly to `500` —
fabricating a confident number out of model hedging, which is exactly
the silent invention the type system exists to prevent. Now only a
known currency symbol is tolerated, and prose fails.

Dates are strictly `YYYY-MM-DD`. An ambiguous date like `03/04/2026`
is refused rather than guessed, and the prompt tells the model to do
the same: a silently mis-parsed date is worse than a missing one.

## Refusals, not guesses

- A response that is not valid JSON, or has no confidence score, is a
  refusal.
- An extraction that read *nothing* is a refusal — storing it would
  create a record indistinguishable from a real but sparse invoice.
- A field that could not be read is absent and listed in
  `missingFields`, never invented.
- Every refusal is recorded as a real `intake_capture_events` row.

`extraction.confidence` is exposed as a real derived fact, so
customers write their own threshold — *"if extraction confidence is
below 0.8, assign a task to the AP team"* — rather than this module
choosing one for them.

## What's still open

- **A live test against a real invoice.** The single most important
  remaining step, and it needs a real document.
- **Image-only PDFs still cannot be processed.** A PDF cannot be
  rasterised inside a Worker: no native renderer, and PDF.js needs a
  canvas workerd does not provide. `capture-pdf` says so plainly and
  points at `capture-image`. Client-side rasterisation or Cloudflare
  Browser Rendering are the realistic options.
- **Line-level extraction.** Only document-level fields are asked for;
  `BT-129`/`BT-131` are per-line, and extracting a line table from an
  image is its own harder problem. Asking for fields the model cannot
  sensibly answer would degrade the ones it can.
- Steps four and five of the design: extraction rules with their
  activation gate, and supplier groups.

---

## Addendum, same day — the live test, and what it found

The live test happened, against a real invoice. It found a real bug,
and the bug was the one flagged above as unverified.

### The image never reached the model

The first implementation sent an OpenAI-style `image_url` content
part inside `messages`, inferred from Cloudflare's
`workers-ai-provider` changelog. That was wrong. The changelog
describes what that *library* does internally; the raw binding wants
something else.

Cloudflare's own Llama Vision tutorial shows the real shape: `image`
is a **separate top-level parameter alongside `messages`**, not a
content part inside them. Other vision models on the platform
(`uform-gen2`, `resnet-50`) use the same top-level `image` key.

So the model received a base64 data URL as ordinary text, saw no
image at all, and answered from the prompt alone.

### The failure mode is worth recording precisely

Given a clear, legible invoice, the model returned:

```json
{"BT-1": "Mcdonalds UK", "extraction.confidence": 0.9}
```

`"Mcdonalds UK"` is the **buyer's name**, not the invoice number
(`MCD2001321-003`). Every other field — including a plainly printed
`£2,518.80` total — came back null. And it reported **0.9
confidence**.

Two runs produced byte-identical output, which was itself the useful
diagnostic: `temperature: 0` was working, so this was not random
guessing. It was a model confidently answering a question it could
not see the evidence for.

**The confidence score is not self-validating.** A model that cannot
see the document still reports a number, and that number can be high.
Any design that routes on confidence — including this one — needs to
treat the score as a signal from a component that might be broken,
not as ground truth about the extraction.

### What changed

`VISION_SHAPES` now sends `image` as a top-level parameter, with both
documented encodings attempted (base64 string first, then byte array)
because models differ on which they accept. Tests pin the shape
directly: no `image_url` in `messages`, no `data:` URL in the payload.

`ExtractionModel.extract` now takes raw bytes and a sniffed content
type rather than a pre-built data URL — building the URL in the
shared layer baked one guess into the interface, and each adapter
should be free to encode however its own model wants.

### Two further bugs, found by reading the invoice rather than the code

**Thousands separators.** `£2,518.80` would have failed coercion even
if the model had read it correctly — the parser stripped a currency
symbol but not commas. Now handled, but only in genuine grouping
positions, so `"1,2,3"` still fails rather than silently becoming
`123`.

**Field descriptions were too thin to disambiguate.** `BT-1` said
only *"the supplier's own invoice number or reference"*, which did
not rule out a company name. Supplier and buyer VAT numbers were
distinguished by a single word. Both now spell out which party is
meant and what shape the value takes, and the prompt names the
supplier-versus-buyer confusion explicitly as the most common
mistake.

Those two would have caused real failures on real invoices regardless
of the image bug, and neither was findable without a real document.

### Still unverified

Whether the corrected shape actually works, and whether Llama 4 Scout
reads invoices well once it can genuinely see them. The next live
test answers both — and this time there is a known-good document to
check against, which is the thing that was missing before.
