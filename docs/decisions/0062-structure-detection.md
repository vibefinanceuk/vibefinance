# 0062 — Detecting what a document actually is

**Status: built, and not yet wired to a route.** The detector exists and
is tested against real documents. Nothing calls it — capture is still
addressed to a caller-chosen endpoint.

---

## What this replaces

Until now the **caller** chose the path. `capture-xml`, `capture-pdf`
and `capture-image` are separate endpoints, and the sender declares what
it is sending.

That works for an API integration where the sender knows. It does not
survive a mailbox: an attachment arrives and nothing has yet decided
what kind of document it is. Decision 0060's sources make that
unavoidable rather than merely untidy — a mailbox cannot choose an
endpoint.

---

## The ordering is the substance

Most specific first:

| # | Test | Result |
| --- | --- | --- |
| 1 | A PDF carrying embedded XML | `structured_pdfa` |
| 2 | XML in its own right | `structured_xml` |
| 3 | A recognised image | `image` |
| 4 | Anything else | undetected |

**A Factur-X *is* a PDF.** Asking the coarse question first would send
every hybrid document to inference and never open the structured data
inside it — a silent failure producing plausible facts, which is the
worst shape a failure can take.

Watched to fail, and this is the test worth having: treating any PDF as
unreadable without first looking for an embedded invoice breaks four
tests, including all three real Factur-X fixtures.

> **A first attempt at watching it fail proved nothing.** Moving image
> detection ahead of the PDF branch broke only one unrelated test,
> because a Factur-X has no image magic bytes — `sniffImageType`
> correctly returns null for a PDF. The guarantee that matters is
> *inside* the PDF branch, and testing the wrong reordering would have
> left it uncovered while appearing to confirm it.

---

## Detection never refuses

An undetected document is not an error. It is **an invoice with no
facts**, which reaches Validation and waits for a person — the operator
keys from the image, or rejects it (decision 0055 section 7).

What detection must not do is guess. A PDF with no embedded invoice
genuinely needs a vision model, and a PDF cannot be rasterised inside a
Worker, so no handler here can read it. Returning `image` for it would
be asserting a capability that does not exist.

---

## Every attempt is recorded, not just the outcome

`attempted` carries each test and what it found.

The distinction that motivates it: **"no invoice present"** and
**"declared but unreadable"** are opposite conversations. The first is a
supplier who has not adopted e-invoicing; the second is one whose
implementation is broken. A refusal saying only "not recognised" cannot
tell them apart, and decision 0055 section 9 already argued that intake
outcome by source is the report worth having.

`summariseAttempts` renders them as a comma-separated string, matching
`validation.failures` and `extraction.conflicts` — so the existing
`contains` operator applies and no new operator is needed.

---

## `looksLikeXml` is deliberately shallow

A declaration or an opening element, not a parse. Detection picks a
handler; the handler is where real parsing and real refusal live.
`parseUblInvoice` already rejects a document that is not well-formed,
and judging it twice would mean two places deciding what counts as XML —
which is how they come to disagree.

A test asserts that malformed XML still *looks* like XML, so the
shallowness is deliberate rather than a gap.

It reads only the opening bytes: decoding a whole document to answer a
question about its first character would be wasteful on a large one. A
UTF-8 BOM is stepped over, because it survives decoding as U+FEFF and
would otherwise make an ordinary XML document look like it starts with
something else.

---

## Images are detected by magic bytes

Not by a filename and not by a caller's declared content type, both of
which can be wrong — and under decision 0060 a mailbox attachment
carries whatever content type the sender's mail client decided to put
on it.

---

## What comes next

1. **Wire detection to a route.** The coherent endpoint is
   `POST /sources/:id/capture`: the caller knows where a document
   arrived, not what it is. Its own decision, because it changes the
   public API surface and the existing endpoints have a live
   integration pointing at them.
2. **An instance with no facts.** Everything today creates a process
   instance *from* extracted facts. An undetected document has none, so
   either an invoice row exists carrying only an id and provenance, or
   instances become creatable without one. The refusal facts from
   decision 0055 section 7 — source, structures attempted, what failed —
   are what it would carry.
3. **Key-from-image**, the third provenance class (decision 0055
   section 8), which the system does not have. Until it exists the only
   real outcome for an undetected document is reject — still better than
   today, where an unrecognised document simply fails.
