# 0068 — Retaining the document that was captured

**Status: built.** Removes the blocker `docs/design/operator-interface.md`
identified.

---

## What was wrong

`intake-capture-route.ts` had no R2 access. A document arriving at
`/sources/:id/capture` was read, extracted from or not, and **discarded**.

Document 1 section 6 records long-term retention as *"proposed design
only, no code exists for this yet"*. That was accurate for the capture
path and inaccurate about the codebase: `document-storage.ts`,
`document-route.ts` and the `invoice_documents` table have existed since
decisions 0013 and 0035, with jurisdiction support and a real key
structure.

**The storage layer was built and nothing on the capture path called
it.** A sixth instance of one layer disagreeing with another — and
unusually, this one had a route for uploading a document manually while
the automatic path threw every document away.

---

## Why it blocked more than compliance

Key-from-image cannot exist without it. The screen's premise is that an
operator reads the document and types what they see; there was nothing to
read.

For an undetectable document the point is sharper still: **there are no
facts standing in for it**, so the original is the only record of what
arrived.

---

## The ordering, and why it is this way round

Retention runs **after** capture, not before. `invoice_documents.invoice_id`
is a real foreign key and the invoice does not exist until extraction has
produced something to store it against.

That is the reverse of what safety would suggest — storing first would
mean a failed extraction still left the document retained. The foreign
key forbids it, and inventing an invoice row to hang the document from
would be worse: a row asserting an invoice exists when nothing has been
read from one.

---

## A retention failure does not fail the capture

Refusing would discard facts that were successfully extracted, in
exchange for bytes that are **already lost** — the request body cannot be
replayed. The document would be gone either way; refusing would lose the
facts as well.

So the capture stands, and the failure becomes visible instead:

```json
{ "document": { "retained": false, "reason": "no R2 bucket is bound" } }
```

Three failure modes are reported distinctly rather than collapsed: no
bucket bound, `CUSTOMER_ID` not configured, and the write itself failing.
The second matters because inventing a key without a customer would put a
document somewhere nothing would look for it.

> **This is a deliberate trade, and it has a cost.** An invoice can now
> exist with no retained original, which in a mandate jurisdiction is a
> compliance gap rather than an inconvenience. It is *visible* rather than
> silent, which is the most this decision can honestly claim. Making it
> testable by a rule — so a customer can require retention and route on
> its absence — is the natural follow-on and is not built.

---

## The content type comes from detection

Not from a caller's declared content type and not from a filename, both
of which can be wrong — and under decision 0060 a mailbox attachment
carries whatever content type the sender's mail client decided to put on
it.

| Detected | Stored as |
| --- | --- |
| `structured_pdfa` | `application/pdf` |
| `structured_xml` | `application/xml` |
| `image` | the sniffed image type |
| nothing | `application/octet-stream` |

**A hybrid PDF is retained as a PDF, not as its embedded XML.** What is
retained is what arrived; the embedded invoice is derived, and deriving
it again from the stored original is always possible.

The octet-stream case is honest rather than lazy: the bytes are kept
exactly as they came, and nothing claims to know what they are.

---

## One implementation detail worth stating

The bytes are copied into a fresh buffer before the R2 write. A
`Uint8Array` may be a view onto a larger allocation, and passing
`.buffer` directly would store the whole thing — a subtle way to retain
more than the document.

---

## What this does not do

- **The channel-addressed endpoints still discard.** They are
  transitional (decision 0063) and this is one more reason to retire
  them, but adding retention there would extend the life of a path that
  bypasses detection.
- **The multi-page flow has its own R2 use** and deletes on finalise.
  Whether the assembled document should be retained as an original is a
  separate question.
- **Retention period is still open.** Document 1 section 6.4 records it
  as a genuine compliance question. Nothing here expires anything, so
  today's answer is "forever", which is a decision by default rather than
  by choice.
