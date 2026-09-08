# 0170 — Does the reading add up?

**Status: built.** Extraction checks its own arithmetic and stops
claiming confidence it has not earned.

---

## Eight plausible lines that do not balance

A real freight invoice, read from an image:

```
International Freight                    1,797.47
Destination Terminal Handling Charges       275.00
ISPS / Port Security Charge                  35.00
Destination Documentation Fee                75.00
Equipment Fee                                25.00
Delivery Cartage                            585.00
Destination Customs Clearance Fee            85.00
Drop off                                    260.00
                                        ──────────
                                          3,137.47
```

The header's own `BT-106` says **2,272.47**. Out by **865.00**.

And the reading reported `extraction.confidence: 0.9`,
`extraction.conflicts: ""`, `extraction.pagesFailed: 0`.

**The model was confident about a reading that does not balance**, and
the arithmetic was available here the whole time.

---

## The strongest signal a table was misread

A line table that does not sum to the header total is the clearest
evidence available that something went wrong in the reading — a wrapped
description taken as two rows, a merged cell, a column read as another.

`extraction.linesDiffer` names the difference. **Zero when they agree**,
so a rule can test it either way.

### Confidence is halved, not zeroed

The facts are still worth having: a header read cleanly is a header read
cleanly, and a person keying needs somewhere to start. **What is not
warranted is telling them we are 90% sure.**

### And this is not validation

Decision 0119's validation already compares the lines against the total
and says *"lines total differs by"*. That is a statement **about the
invoice**.

This is a statement **about our reading of it**, and the two want
different responses from a person: *"this supplier's invoice is
inconsistent"* is a conversation with the supplier, and *"we may have
read this badly"* is a look at the image.

---

## Rounded before comparing

A sum of decimals disagrees with itself in floating point. Rounding to
the penny first means a rule about a mismatch fires on documents rather
than on arithmetic — `0.1 + 0.2` is tested directly.

---

## Four things a stub got wrong, again

`extractInvoiceFromImages` takes the **model first and the pages
second**. The model answers in **prompt keys**, so `netTotalBeforeVat`
rather than `BT-106` and a line's `amount` rather than `lineNetAmount`.
And an `ExtractedLine` is `InvoiceFacts & { lineNumber }` — the facts
**directly**, not nested under a `facts` property.

Decision 0161 recorded the same class of thing and it happened again.
**A stub that is wrong in a plausible way sends somebody to read working
code**, and the fastest route through is to check the signature rather
than to reason about the failure.

---

## What is not built

- **Nothing shows this to a person.** The fact is stored and no screen
  reads it, so a low-confidence reading looks like any other.
- **Only the net total is checked.** `BT-112` against `BT-106` plus
  `BT-110` is the same arithmetic and is not done here.
- **A missing line and a wrong line read identically.** The difference
  is a number; which line caused it is not identified, and often could
  be.
