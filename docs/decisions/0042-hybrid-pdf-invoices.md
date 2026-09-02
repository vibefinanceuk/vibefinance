# 0042 — Hybrid PDF invoices, and why they must never see a model

Status: settled, 2 September 2026. Step two of the extraction design
(`docs/design/extraction.md`) — reshaped substantially in review,
because the original design treated "PDF" as one thing when it is
genuinely two.

## The correction that changed this step

The design assumed a PDF invoice needs a vision model. That is only
true for one of the two kinds of PDF that actually arrive.

**A hybrid PDF (Factur-X in France, ZUGFeRD in Germany) carries a
complete, valid EN 16931 XML invoice as an embedded file attachment.**
Both are real e-invoicing mandates. The embedded XML *is* the
authoritative data — structured, standards-conformant, and already
exactly what this system's existing parser consumes.

Sending one of those to a vision model would be a genuine regression:
taking mandate-grade structured data and asking a model to re-read it
from a picture, introducing extraction error where there was none, and
silently substituting inference for fact.

**An image-only PDF** — a scan or a photograph — has no embedded data
at all, and genuinely does need a model.

So the first job is not extraction. It is **detection**, and getting
it wrong in one direction quietly degrades data a mandate requires to
be exact.

Decision 0013 had already anticipated this and said so plainly: *"pull
the XML attachment out of the received PDF/A-3 to populate structured
facts"*. `factur_x` has been a real CIUS profile in `profiles.ts` since
decision 0009. The architecture was right; the implementation simply
never existed.

## What was built

Every PDF is checked for an embedded invoice **first**. When one is
found, it is handed to `handleCaptureUblXml` — the exact path a
directly-submitted UBL document already takes. Same parser, same
storage, same workflow instance, same guarantees. No model is
invoked, no confidence score exists, and nothing is inferred.

This is deterministic container parsing, not machine learning. There
is nothing to be uncertain about.

`pdf-attachment.ts` is deliberately a minimal, targeted PDF reader
rather than a general one. It answers exactly one question — "is there
an embedded XML invoice, and what is it?" — and refuses clearly when
it cannot. A full PDF parser would be a much larger surface for no
benefit here.

## Two real findings from building it

**The stream boundary is an off-by-one waiting to happen.** The naive
approach searches for the `endstream` keyword. But the PDF
specification requires an EOL *before* that keyword, and including it
corrupts the data — harmlessly for uncompressed streams, fatally for
compressed ones, which fail with trailing-junk errors. The fix is to
use the declared `/Length` as authoritative, with EOL-trimming only as
a fallback.

This was found by prototyping against a real compressed PDF before
writing the module, and it matters because it would have worked
perfectly on a naive test fixture and failed on most real-world
Factur-X files. Watched to fail: reintroducing it breaks three tests,
and only the compressed ones.

**Filenames never appear literally.** Real producers write
`(factur\055x\056xml)` using PDF octal name escapes. A reader
searching for the literal string `factur-x.xml` finds nothing. There
is a test asserting the literal string is genuinely absent from the
fixture, so this cannot silently regress.

## Fixtures are real PDFs, not stubs

The module parses genuine PDF structure, so a hand-stubbed "PDF" would
prove nothing. `scripts/build-pdf-fixtures.py` generates four real
files — correct xref tables, real object structure, real Flate
compression — covering the uncompressed hybrid, the compressed hybrid,
a PDF whose attachment is not XML, and an ordinary PDF with no
attachment at all. They are base64-encoded into a `.ts` module so the
bytes survive bundling, the same reason migrations are imported via
`?raw`.

## The fallback policy is configuration, not a default

When a PDF declares an embedded invoice and that invoice cannot be
read, there is no single right answer, so the channel decides:

- **`refuse`** — a customer under a real e-invoicing mandate has a
  genuine compliance argument for rejecting the document outright.
  Silently falling back to reading a picture would substitute inferred
  data for mandate-grade data with nobody being told.
- **`fallback`** — a customer using PDFs informally would rather get
  something than nothing, provided it is visibly marked as
  best-effort.

`refuse` is the default deliberately: the safer behaviour is the one
you get without having thought about it, and a customer who genuinely
wants degradation has to say so.

Per channel rather than global, because that is the granularity where
it actually differs — one channel may be a mandate-compliant supplier
integration while another is a shared mailbox anyone can send a scan
to. There is a test asserting the two policies genuinely produce
different outcomes on the same document, so the setting cannot become
decorative.

## Honest about what is not built

An image-only PDF returns **501**, not a fake success. A `fallback`
channel with an unreadable hybrid also returns 501, because there is
nothing to fall back *to* yet. Reporting 201 with nothing extracted
would be the genuinely bad outcome — it would look like the document
was processed.

## What's still open

- **Image extraction itself**: the vision model path. Cloudflare
  Workers AI has several suitable models, but choosing one needs real
  evaluation against real invoices, and `env.AI` has no local
  simulation — so it needs a live session, not a bundle.
- **Notably, Moondream is probably the wrong choice** despite being
  the obvious OCR candidate: its fixed task enum (`query`, `caption`,
  `point`, `detect`) takes a single question, so extracting twenty
  invoice fields would mean twenty calls. A vision model with
  structured outputs (`llama-4-scout`, `qwen3.8-27b`, `gemma-4`) fits
  the existing compiler pattern far better.
- Rasterising an image-only PDF to something a vision model accepts is
  its own unsolved problem in a Worker: no native renderer, and PDF.js
  needs a canvas workerd does not provide. Client-side rasterisation
  or Cloudflare Browser Rendering are the realistic options.
- Steps three to five of the design: custom field extraction,
  extraction rules with their activation gate, and supplier groups.
