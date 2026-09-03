# 0063 — Capture addressed to a source

**Status: built.** The older channel-addressed endpoints still work.

---

## What changed

`POST /sources/:id/capture` takes raw bytes. Detection decides the
structure (decision 0062) and the structural channel for that structure
handles it (decision 0061).

The caller says **where a document arrived**, not what it is. That is
the only thing a mailbox knows: it has an attachment and nothing more.

Each branch delegates to a handler that already exists and is already
proven. This route decides *which*, and adds no extraction logic of its
own — with one exception noted below.

---

## An undetectable document is captured, not rejected

The operator's framing, and it dissolved a problem that looked harder
than it was.

An undetectable document is **an invoice with no facts**. It gets an
invoice row carrying only provenance, a process instance, and reaches
Validation — where a person keys it from the image or rejects it
(decision 0055 section 7).

> **Why an instance has to exist.** A refusal that produces no facts has
> nowhere to go: no invoice means no instance, no instance means no
> rule can fire, and the document is simply gone. Creating the row is
> what makes the refusal actionable rather than merely recorded.

`intake.structure` is set to the **empty string**, not omitted. An
absent field cannot be tested for, and testing for it is precisely how
an undetectable document reaches somebody:

```
if intake structure is "", assign a task to the AP team requiring AP.Review
```

`intake.attempted` carries the tests that were tried, so the same rule
set can distinguish a supplier who has not adopted e-invoicing from one
whose implementation is broken.

### Which channel holds a structureless document

Any structural channel of the process, preferring `image`.

The alternative was a fourth channel meaning "none", which would exist
only to hold failures. Preferring `image` is deliberate rather than
arbitrary: it is where a keyed-from-image document will end up once
keying exists.

---

## A recognised structure with no channel says so

If detection identifies XML and the process has no `structured_xml`
channel, that is a **422 naming the configuration gap** — not a fallback
to another channel.

Falling back would read the document under rules nobody configured for
it, which is the same failure mode decision 0062's ordering exists to
prevent, arriving from a different direction.

---

## One place this route does extract

The hybrid PDF branch. Detection has already pulled the embedded XML out
of the container to decide the structure, so `DetectionResult` carries
it and this route parses it directly rather than extracting a second
time.

The alternative — handing the PDF to `handleCapturePdf` — would repeat
the FlateDecode and attachment walk on every document for tidiness.

A parse failure there is reported distinctly: the PDF *declared* an
embedded invoice, detection *extracted* it, and it is not a UBL invoice.
That is a different problem from an unreadable attachment and worth
saying which.

---

## Capture is ungated, and this route matches

`AP.Capture` was written and then removed. The existing capture routes
have no permission gate at all, and adding one here while `capture-image`
and `capture-xml` stay open would be **theatre**: a caller wanting to
bypass it would use the older endpoint.

Capture being ungated across the board is a real gap. It deserves fixing
as one thing rather than half, and this decision does not pretend
otherwise.

---

## The old endpoints are transitional

`capture-xml`, `capture-pdf`, `capture-image` and the multi-page
`documents` flow all still work, addressed to a channel.

They **bypass detection entirely**, which is the thing detection exists
to prevent. So they are transitional rather than an alternative: kept
because a live integration points at them, and removed once it has
moved.

Keeping them indefinitely would leave two ways to do the same thing,
one of which lets a caller assert a structure the document does not
have.

---

## What is still missing

- **Key-from-image** (decision 0055 section 8). Until it exists, the
  only real outcome for an undetectable document is reject — still
  better than today, where an unrecognised document simply fails.
- **The multi-page flow** still addresses a channel. It has the same
  problem and wants the same move.
- **Settings still live on the legacy channel.** `conflictWinner` and
  `maxExtractedLines` are properties of reading an image and belong on
  the image channel now that one exists; `currencyTolerance` belongs to
  the process.
- **Retiring the legacy channels**, which is what removes the NULL
  structure case and lets decision 0061's partial index become a total
  one.
