# 0059 — The UBL parser mapped half the vocabulary

**Status: built.** Found while sizing decision 0058's proposed work.

---

## What was missing

The closed vocabulary declares 21 invoice fields. The UBL parser
populated 11.

Absent: `BT-3`, `BT-10`, `BT-13`, `BT-106`, `BT-110`, `BT-115`,
`BT-151`, `BT-152`, and the two allowance/charge groups.

`BG-20` and `BG-21` are a deliberate, documented exclusion — repeated
nested groups rather than a path-to-scalar mapping, and the parser says
so. The other eight were not excluded for any recorded reason. They were
simply never mapped.

---

## Why it mattered more than a missing field usually does

**`BT-106`, `BT-110` and `BT-115` are what validation compares.**

Decision 0044's `vat_arithmetic` check needs net, VAT and total.
`amount_due_mismatch` needs amount due and total. On the UBL path none
of those inputs existed, so **neither check could ever run**.

The consequence is the wrong way round: UBL and hybrid PDF are the
*exact*, mandate-grade paths, and the image path is best-effort
inference. The trustworthy paths were getting the least validation, and
the inferred one the most.

> **The design surfaced it and nobody looked.** Decision 0044 tracks
> `checked` separately from `failures` precisely so that "passed" cannot
> quietly mean "nothing was checked". On the UBL path `checked` was
> reporting exactly that, correctly, every time. The mechanism worked;
> the reporting was never read.

---

## The one mapping with a trap in it

`cac:TaxTotal` is **1..2**, not 1..1. Peppol BIS Billing 3.0: *"when tax
currency code is provided, two instances of the tax total must be
present, but only one with tax subtotal"*. The second carries `BT-111` —
the same VAT total in the seller's accounting currency.

Taking the first `TaxTotal` blindly returns `BT-111` rather than
`BT-110` on any invoice using a VAT accounting currency. A wrong number,
silently, on exactly the documents where the two amounts differ.

Resolved by the spec's own discriminators, in order: the `TaxAmount`'s
mandatory `@currencyID` must equal `BT-5` for `BT-110`, and only the
`BT-110` instance carries a `TaxSubtotal`.

> **The same shape of bug the parser had already recorded once.** Its
> own comment describes a first version that assumed a single
> `PartyTaxScheme`, which would have silently failed to extract `BT-31`
> and `BT-48` on a document shaped like the spec's own worked example. An
> element the spec allows to repeat, assumed singular — twice, in the
> same file.

---

## `BT-151` and `BT-152` are line-level

They read like header fields and are not. In UBL they live at
`cac:InvoiceLine/cac:Item/cac:ClassifiedTaxCategory`, so they belong on
line facts, not document facts. Tested in both directions: present on
the line, absent from the header.

---

## Method

Every path was verified against `docs.peppol.eu` before being written,
not recalled — the discipline the parser's own comment already
established, and the reason the `TaxTotal` cardinality was noticed at
all rather than discovered later by a customer with a Swedish supplier.

The parser's scope comment, which listed the fields it mapped, is
updated to match. It had been accurate when written.

---

## What this does not fix

`BG-20` and `BG-21` remain unmapped, deliberately. They are repeated
nested groups with their own reason codes, amounts, base amounts and tax
categories — a real piece of work, not an oversight, and the vocabulary
declaring them without the parser populating them is now the only
remaining divergence of this kind on the UBL path.

Whether allowances and charges are worth mapping at all is a product
question: no rule has yet needed them.

---

## The pattern, now four times

| Found | Divergence |
| --- | --- |
| `invoice_lines.cost_centre` | Column with no vocabulary entry |
| `extraction.confidence` (0054) | Fact set, never declared |
| Settings → extraction (0056, 0057) | Configuration reaching nothing |
| This | Vocabulary declared, parser never populated |

All four are one layer disagreeing with another. None was found by
reading either layer alone — each came from checking one against the
other, which is now worth doing deliberately rather than accidentally.

**A candidate check:** for every field the vocabulary declares, assert
that at least one intake path can populate it, or that its absence is
recorded as deliberate. That would have caught three of these four at
the point they were introduced.
