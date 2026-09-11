# 0221 — The Seller card, as drawn

**Status: built.** Inline labels, an address block, a phone number, and
the country as a person reads it.

---

## The operator drew it

Decision 0220's card was right in structure and wrong in every detail,
and a picture said so faster than a paragraph would have.

**Labels beside values, not above them.** Decision 0219 stacked them,
which is how the keying form works **because its values are inputs**.
These are short, read-only and being scanned against a document — a
label above each one doubles the height for nothing.

**Short forms.** *VAT no*, *E-address*, *E-mail*. On a card of five
inline labels, *Electronic address* is wider than most of the values
beside it.

**The address as a block under one label.** Four labelled rows is four
labels for one thing, and an invoice prints an address as lines.

---

## Two things the drawing had that I did not

**A phone number.** Neither decision 0207's reading of Oracle nor
decision 0219's email thought of it — **the same omission twice**. A
supplier record exists to reach a supplier, and a person disputing an
invoice reaches for a phone before an inbox.

**And *United Kingdom* rather than *GB*.** An invoice prints the name;
our record holds the code. **A card that exists to be compared against
an image should say what the image says.**

Expanded from **OpenPEPPOL's own ISO 3166 list**, already here for
decision 0205's rendering — so it is not a second list somebody
maintains.

---

## A column counted three times and wrong twice

The insert gained `email`, then `phone`, by string replacement — and the
second edit matched a fragment the first had already changed, giving
`phone, phone` and twenty placeholders for twenty-one columns.

**SQLite said so precisely** — *"22 values for 23 columns"* — and the
tests caught it before deployment did. **But a hand-counted list of
placeholders is a thing that will drift again**, and this is the second
time this week a hand-maintained list has been wrong (decision 0200's
permissions being the first).

Recorded rather than fixed: the placeholder list is still written out,
because generating it is a larger change than the fault deserves and
would hide which column is which.
