# 0171 — The order a line reads in

**Status: built.** Line columns in the order an invoice prints, and the
description shown at last.

---

## Business Term order is not a reading order

The line table came out as:

> #, Line no, Quantity, Unit, Line net amount, Item net price, VAT
> category, Item name

That is `BT-126, BT-129, BT-130, BT-131, BT-146, BT-151, BT-153` — the
**standard's numbering**, which orders by when the specification defined
a term and not by how anybody reads a line.

So quantity comes before its unit, the line total before the unit price
it is derived from, and the item's name last.

The operator asked for what an invoice actually prints:

> Line No, Description, UOM, Unit Price, Quantity, Total Price.

The resolver already sorted by a configurable `sortOrder`; line fields
simply had none. They have a reading order now, and **a field nobody
named keeps its place after them** — so adding one to the vocabulary
does not silently disappear.

---

## A description extracted from every line and shown on none

`description` is stored under a **plain key** rather than `BT-153`,
deliberately. Decision 0052 refused to widen the closed vocabulary
*"purely to carry text no rule tests"*, and `invoice_lines` has its own
column for it.

**That reasoning holds and its premise changed.** The viewer renders
only what the field resolver lists, so the description reached storage
on every line and reached the screen on none.

It is now a **displayable field, not a vocabulary one**: no rule can
test it, and a person can read it. Which is the honest shape of a thing
that is text and nothing else.

### Read, not edit

Keying refuses anything outside the closed vocabulary (decision 0144),
so an editable description would render as a text box and **fail on
save** — worse than not offering it.

A person can read what the document said. Correcting it needs either a
Business Term or a keying route that accepts a field no rule can test,
and neither is a decision to make in passing.

---

## Two columns that are not built, and why

The operator asked for **VAT Amount** and **Total Amount** per line.

**EN 16931 has neither.** A line carries a VAT *category* and *rate*
(`BT-151`, `BT-152`); the amounts are summed per category at document
level in `BG-23`. So both would be **derived** — `BT-131 × BT-152` — and
derived is the right shape, matching how `invoice.duplicate_confidence`
and `po.variance_pct` already work.

**But nothing extracts `BT-152`.** The real freight invoice returned a
description and an amount per line and no rate at all, so a derived VAT
column would be empty on every row.

Two steps, and this is the first: extraction learning to read per-line
VAT, then the derived columns that have something behind them.

---

## What is not built

- **Per-line VAT extraction.** Until then, `BT-151` and `BT-152` are
  vocabulary fields nothing fills.
- **The description cannot be corrected**, which is exactly the field
  somebody keying an unreadable document would most want to type.
- **The reading order is ours, not the customer's.** `sortOrder` is
  configurable per field and nothing sets it for lines, so a customer
  who wants quantity first cannot say so.
