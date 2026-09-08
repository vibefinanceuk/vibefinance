# 0162 — Why, not just that

**Status: fixed.** A refused attachment records the reason the capture
route gave.

---

## The reason existed and was thrown away

A photographed invoice was emailed in and bounced. The supplier got
*"the attached file could not be read as an invoice"*, the customer's
log said `unreadable`, and **`wrangler tail` showed nothing** — because
capture returns a 422 rather than throwing.

So three places reported a failure and **none of them said why.**

Decision 0146 collected failed attachments **by filename** and discarded
`result.body`, which holds the actual explanation — *"no fields could be
read from this image at all"*, *"the model did not report a usable
confidence score"*, or whichever it was.

**The same fault decision 0161 had just fixed one level down**, and I
wrote both.

---

## `unreadable` is true of everything and explains nothing

It was a word this route chose, not a reason a route gave. Now the
recorded reason is what capture actually said, per attachment and named:

```
invoice.jpg: no fields could be read from this image at all
```

Which distinguishes a model that could not read the picture from a model
that did not answer, from a file that was not an invoice — three
different problems that read identically before.

---

## What this does not fix

**The bounce to the supplier is unchanged**, deliberately. A supplier
does not need to know that a vision model reported low confidence; they
need to know the invoice did not arrive and to send it another way.

The detail belongs to the customer, who can act on it.

---

## What is not built

- **Nothing shows the log.** `GET /inbound-email` returns it and no
  screen reads it, which decision 0147 already recorded and this makes
  more valuable.
- **A reason is stored as free text**, truncated to 500 characters. It
  is diagnostic rather than something a screen can translate (decision
  0132's rule about codes), and it is the honest shape for something
  produced by whichever route refused.
