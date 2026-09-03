# 0045 — Multi-page invoice capture

Status: **built, and not working against real documents.** The
mechanism is sound and tested; two real 1.5MB and 2.8MB scans exceed
the model's time budget when sent together. See the addendum — it
records what was learned, including a finding about prompt
instructions that matters well beyond this decision.

## The failure

A freight invoice with its charge lines on page one and its totals on
page two. Submitted as a single image, page one extracted correctly —
all eight lines, every amount right — and honestly reported no total,
because none is printed there.

Correct, and useless. The totals existed; nothing had seen them.

`line_sum` could not run either: the lines were present but had
nothing to be checked against.

## Pages arrive separately, extraction happens once

Two decisions that pair deliberately.

**Pages accumulate over time.** A scanner feeding sheets one at a
time, or a mail integration receiving attachments separately, cannot
hand over a complete document in one request. Pages are uploaded
individually against a pending document.

**Extraction runs once, across all of them, in a single model call.**
A multi-page invoice is one document: the line table may run across a
page break, and the totals are commonly on the last page. Extracting
each page separately and merging in code would mean inventing an
answer for what to do when two pages disagree about the same field —
a problem better avoided than solved.

The prompt tells the model plainly that it is looking at consecutive
pages of one invoice and must report one set of values, never one per
page.

## A document that exists before it is an invoice

This is the genuinely new concept, and why `invoice_documents`
(decision 0035) could not be reused: that table requires an
`invoice_id` referencing a row that must already exist, and its
`UNIQUE (invoice_id, document_type)` permits exactly one original per
invoice. Both are correct for a stored, extracted invoice. Neither
can represent pages arriving before there is anything to attach them
to, and widening it would weaken guarantees that are right for what
it already does.

`pending_documents` holds `open` until finalisation, then
`finalised` with a real `invoice_id`. Standing invariants enforce
that an open document never has an invoice and a finalised one always
does — the table's entire reason for existing, stated as a fact the
migration runner re-checks.

Finalised documents are kept rather than deleted, so the page set
that produced a given invoice stays auditable.

## Page order is explicit, never upload order

Pages carry a caller-supplied `page_number`, and are read back ordered
by it.

A retried or delayed page can easily arrive out of sequence, and page
two's totals mean nothing to a model that reads them first. Watched
to fail: ordering by upload time instead breaks the test that uploads
page two first.

Re-uploading a page replaces it rather than adding a second copy, so
a retry after a network failure cannot make the model read the same
page twice.

## A gap is refused, not extracted

A document with pages 1 and 3 is missing page 2. Extracting it would
silently produce an invoice from an incomplete document — the exact
failure this decision exists to fix, reintroduced in a form that is
harder to notice. Finalisation refuses and says which pages it has.

## Failure leaves the document retryable

The document is marked finalised only once an invoice genuinely
exists. A refused extraction leaves it open, so the pages are not
stranded against nothing.

## What this closed

Page one's lines plus page two's total now validate together:
`line_sum` runs, and passes. That check has existed since decision
0044 and had never once executed against a complete real document.

## What's still open

- **Abandoned documents.** A page-one upload that never returns
  leaves a pending document holding a customer's real invoice image
  indefinitely. It needs an expiry sweep — `vf-licence` already has
  the cron pattern for exactly this — or at minimum a way to list
  stale ones. Not built.
- **No page limit.** Nothing stops a fifty-page upload, which would
  produce a request far beyond any sensible token budget. The line
  cap exists; a page cap does not.
- **PDFs still cannot be split into pages** inside a Worker, so a
  multi-page PDF must be exported to images first.

---

## Addendum — what the real documents showed

Two genuine scans of the freight invoice, page 1 at 1.5MB and page 2
at 2.8MB, both PNG.

### Multi-page times out, and the cause is size

Sent together, the finalise call fails with `AiError 3046: Request
timeout`. Sent alone, **page 1 extracts perfectly** — better than the
82KB JPEG of the same page had, in fact: nine of twelve fields where
that managed five, all eight line items, and the supplier VAT
correctly distinguished from the client's for the first time.

So the constraint is not page count and not resolution. A single
1.5MB image is comfortable; 4.3MB together is not. The threshold sits
somewhere between, and has not been measured.

Two viable routes, neither built:

- **Downscale before sending.** Two 400KB JPEGs would sit well inside
  the working range. Simple, but pushes the constraint onto whoever
  uploads.
- **One call per page, merged in code.** Each call stays the size
  already known to work, and handles a five-page invoice as easily as
  a two-page one. Merging looked like inventing an answer when this
  was first designed; the real documents show otherwise — page 1
  carries the lines and header, page 2 the totals. They are
  complementary, not competing, so "first non-null value in page
  order" is an honest rule rather than a fudge.

### Three crashes, one class of bug

Diagnosing the above took three rounds, and two of the failures were
mine:

1. A truncation check thrown as a plain `Error` rather than an
   `ExtractionRefusal`, escaping a catch that handles only refusals.
2. `AiError` doing exactly the same thing from a different origin.

The second is the instructive one. The fix for the first handled
precisely the one throw being thought about, which was treating the
symptom. **Anything the model call can raise has to be caught**,
because the caller's contract is that extraction either returns text
or refuses. `loadPendingPages` had the identical gap and was fixed by
looking rather than by being hit.

`wrangler tail` named the real cause in seconds after three rounds of
reasoning from symptoms had not. Worth reaching for far earlier.

## The finding that matters beyond this decision

**A prompt instruction is not a safety property.**

The extraction prompt forbids calculation outright. Every monetary
field's description says "as PRINTED" and "never sum the lines
yourself". Decision 0044 was built on that instruction holding.

On the 1.5MB scan of page 1, the model **calculated anyway** —
reporting `BT-106`, `BT-112` and `BT-115` as 2,272.47, a figure
printed nowhere on the page. Its own extracted lines sum to 3,137.47.
It contradicted itself, confidently, at 0.9.

The same instruction held on the 82KB JPEG of the same page, where
those fields correctly came back null. So compliance is
**inconsistent** — not absent, which would be easy to design around,
but unreliable in a way that cannot be tested for by trying it once.

### What caught it

Validation. All five checks ran for the first time, and `line_sum`
failed: the stated total did not match the lines the same response
had produced. Every other check passed, so the failure is specific
and legible — not "something is wrong" but "the total does not match
its lines". A rule fired, and a human has a task waiting.

No fabricated figure reached anyone.

This is the layered design earning itself in a way that could not
have been demonstrated deliberately. The extractor misbehaved; a
deterministic check the platform does exactly caught it in
milliseconds.

### What follows from it

Anything that actually matters needs a deterministic check behind it.
Instructions shape behaviour and are worth writing carefully, but
they cannot be relied on for correctness — and a design that assumes
otherwise is one bad response away from a silent error.

That principle already ran through the compiler's refusal boundary,
the worked-example gate, and the closed vocabulary. This is the first
time it has been demonstrated against a live model contradicting an
explicit instruction, on a real document, in production.

---

## Superseded in part by 0046

The one-call-per-document design recorded above is replaced by
one call per page, merged in code. See
`docs/decisions/0046-per-page-extraction.md`. The upload and
finalise mechanism is unchanged; only how the pages reach the model
differs.
