# 0163 — A model that never answered

**Status: fixed.** An image whose extraction times out is kept as an
invoice with no facts, rather than bounced to the supplier.

---

## Found in one send, because decision 0162 had just been deployed

A 936KB photograph of an invoice, emailed in. The recorded reason:

> Screenshot 2026-09-08 at 13.36.04.jpg: the model did not respond in
> time — a large image or a long line table can exceed the time
> available (AiError: 3046: Request timeout)

**The previous two sends said `unreadable` and nothing more.** Decision
0162 shipped an hour earlier and turned a shrug into a diagnosis.

---

## A timeout is not a bad reading; it is no reading

`intake-capture-route.ts` refuses on any `ExtractionRefusal`, with a
reason worth quoting:

> A refusal, never a half-populated invoice: the compiler's own
> discipline, applied to extraction.

**That is right for a model that read the document and produced
nonsense** — evidence the document is not an invoice.

**It is wrong for a model that never got to look.** A timeout is
evidence about *our infrastructure*, and the customer's invoice was
thrown away over it: capture returned 422, stored nothing, and the
supplier was told their file could not be read.

### Decision 0055 already said what to do

An undetectable document becomes **an invoice with no facts**, which
reaches Validation and waits for a person to key it. That is exactly the
right outcome here, and it was already built — it just was not reached,
because a timeout took a different path.

Now it is, and decision 0161's notice explains it on the screen: *"this
document could not be read automatically."*

---

## Only when every page went unanswered

`ExtractionRefusal` carries an `unanswered` flag, kept per page through
the multi-page loop.

**A document where one page timed out and another was genuinely
unreadable is a document the model did look at**, and keeping it would
hide a real refusal behind an infrastructure problem.

An unsupported image format is a real answer too, and stays a refusal:
no amount of retrying makes a file into an image.

---

## What is still true and not fixed

**The timeout itself.** A 936KB image exceeds what the model can do in
the time available, and nothing downscales it, retries it, or splits it.
Every large photograph will still fail to extract — it will simply
survive, as a document somebody keys by hand.

That is a worse product than one that reads the picture, and a much
better one than one that loses it.

---

## What is not built

- **No downscaling.** A Worker cannot resize an image without a library,
  and Cloudflare's own image resizing works on fetched URLs rather than
  bytes in hand. Worth investigating; not investigated.
- **No retry.** A timeout may be transient and nothing tries twice.
- **Nothing tells the customer an invoice needs keying** beyond it
  appearing in the queue with no supplier and no amount.
