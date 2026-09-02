# 0045 — Multi-page invoice capture

Status: settled, 2 September 2026. Closes the gap decision 0044's
addendum named as needing its own design.

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
