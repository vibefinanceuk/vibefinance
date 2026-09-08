# 0161 — A document nobody could read

**Status: built.** An unreadable document says so, and an image is no
longer refused for want of configuration.

---

## Two symptoms, one send

Reported after re-seeding a clean database:

> When sending in a PDF document, nothing is extracted. I also tried
> creating .png and .jpg documents, but these are rejected back to
> sender.

The log settled it: PDFs `captured` with empty facts, images
`rejected · unreadable · attachments 1, captured 0`.

**Different causes.**

---

## The PDF was working as designed and reading as broken

`intake.structure` came back **empty** and `intake.attempted` listed
`pdf_header,embedded_invoice_xml`. So it is an image-only PDF, and
decision 0042 records that a Worker cannot rasterise one.

Decision 0055 already decided what to do: **an undetectable document is
an invoice with no facts**, which reaches Validation and waits for a
person to key it. That is right.

**Nobody told the person.** The facts recording *what was tried* have
been stored since decision 0055 and nothing read them, so a task arrived
with an empty form and no explanation — and the reasonable conclusion is
that the software is broken.

Now the read route reports it and the viewer says so, **above the
exceptions**, because every arithmetic check fails on an invoice with no
facts and *"net plus VAT does not equal the total"* on an empty form is
telling somebody the wrong thing.

---

## The image was a configuration gap reported as a document problem

Capture requires an `intake_channels` row matching the detected
structure. **Nothing seeds one for `image`**, so a photographed invoice
met *"process ap has no image intake channel"* and bounced to the
supplier.

The channel is now created on arrival, the same as decision 0154 does
for a stage's first rule set. **The alternative is a customer who can
only receive the kinds of document somebody thought of in advance.**

### And this is the second-best fix

Decision 0061 retires `intake_channels` *"once capture addresses sources
rather than channels"*, and decision 0060 replaced them. **This
entrenches them**, because `intake_capture_events.channel_id` is `NOT
NULL` and references one — so removing the concept is a migration and a
rewrite of capture, not a deletion.

Recorded rather than hidden: the right fix is still the one decision
0061 named.

---

## A test that asserted the old answer

`source-capture.test.ts` checked that a missing channel produced a 422,
on the reasoning that **silently using a different channel would read
the document under rules nobody configured for it.**

That reasoning is untouched, and the answer changed: the *right* channel
is created, and falling back to a wrong one is still refused because it
never happens. The test now asserts the creation.

---

## Four things a stub got wrong before the code was right

Worth recording together, because each cost a cycle and none was a
defect.

`ExtractionModel.extract` returns **a JSON string**, not an object.
**`_confidence` is required** (decision 0043): a model that does not say
how sure it is has not answered. A **plausible set of fields** is
needed, since one field is refused as nothing read. And the model
answers in **prompt keys** — `invoiceNumber`, not `BT-1` — which is
decision 0043's own design, mapping the model's terms back to the closed
vocabulary.

**A stub that is wrong in a plausible way sends somebody to read working
code**, which is the same lesson decision 0138 recorded about four
different tests.

---

## What is not built

- **Nothing tells anybody a PDF is unreadable until they open it.** The
  task list shows an invoice with no supplier and no amount, and the
  explanation is one screen further in.
- **The image path is untested against a real image.** Every test uses
  a twelve-byte PNG header and a stubbed model.
- **`intake_channels` is more entrenched, not less.**
