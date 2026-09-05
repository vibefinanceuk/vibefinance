# 0110 — The standard is the vocabulary

**Status: built.** BG-25 completed against the Peppol BIS Billing 3.0
UBL tree, read by the parser, and offered by the keying screen.

---

## The principle, stated

> Use a structured document type that already has industry recognition,
> and use that standard for **all** document types.

Not new — Document 2 records the invoice vocabulary as *"sourced
directly from the EN 16931 semantic model, addressed by Business Term id
exactly as the standard itself, a customer's tax adviser, ERP vendor,
and auditor already use it."*

What was new is holding the vocabulary to it.

---

## Four of six mandatory line elements were missing

Checked against the specification rather than recalled. `cac:InvoiceLine`
has six mandatory elements; the closed vocabulary carried two.

| Element | Term | Was |
| --- | --- | --- |
| `cbc:ID` | Invoice line identifier (BT-126) | **missing** |
| `cbc:InvoicedQuantity` | Invoiced quantity (BT-129) | present |
| `@unitCode` on it | Unit of measure (BT-130) | **missing** |
| `cbc:LineExtensionAmount` | Line net amount (BT-131) | present |
| `cac:Item/cbc:Name` | Item name (BT-153) | **missing** |
| `cac:Price/cbc:PriceAmount` | Item net price (BT-146) | **missing** |

Plus three optional ones now added: BT-127 (line note), BT-132
(referenced order line), BT-154 (item description).

### Two of those absences were worse than gaps

**A quantity with no unit says nothing.** 100 hours and 100 pallets are
both `100`. BT-130 is a mandatory *attribute* rather than an element,
which is how it was missed — the parser read elements and never looked
at attributes at all.

**And without BT-146 a line cannot be checked against its own
arithmetic.** Quantity times unit price should equal the line net
amount; with no unit price there is nothing to multiply. A test now
asserts exactly that on a parsed line.

---

## The mistake this started from

The keying screen offered *"description"* and *"amount"* — my names, not
the standard's. When it turned out the vocabulary had no field for
description, **I recorded that as settled** rather than as a gap.

It was a gap. `cac:Item/cbc:Name` is **mandatory** in the specification,
and `cbc:Description` exists beside it. Taking an absence in our own
list as though it were an absence in the standard is exactly backwards,
and it is the thing this decision exists to correct.

The screen now offers item name, quantity, unit, item net price and line
net amount — the standard's fields, by their own names.

---

## The convenience columns are derived, not typed

`invoice_lines` keeps `description`, `amount` and `cost_centre` as
columns because a person reads them back and a query sorts on them. They
are now **derived from the facts** rather than typed separately.

Letting somebody fill a column and a fact independently is how the two
come to disagree — and decision 0109 already found what happens when a
line's columns are populated and its facts are not.

---

## What caught it, and what did not

**A question, not a test.** *"Is the invoice line table based on the
Peppol BIS 3.0 definition?"*

But one test did its job the moment the vocabulary changed.
`field-coverage.test.ts` refuses any declared field the parser cannot
produce:

> Declared in the vocabulary and populated by no intake path... Either
> map it, or add it to `DELIBERATELY_UNMAPPED` with the reason. **A
> field nothing can produce is a rule nobody can write.**

Adding seven terms failed it immediately, and mapping them in the parser
is what made it pass. That test is the reason this change could not be
half-done.

Two existing parser assertions also grew — `BT-126` and `BT-130` were
**always in the sample document** and were being discarded. The
assertion changed because more of the document is read, not because the
document did.

---

## Expense stays as it is

Decision 0022 chose plain names for the expense vocabulary — `category`,
`amount`, `submitted_date` — over an invented `EX-N` scheme, because
that *"would falsely imply an external standard that doesn't exist."*

That survives this principle rather than contradicting it. The rule is
**where a recognised standard exists, it is the vocabulary; where none
exists, use plain names and say so** rather than manufacturing an
authority a tax adviser could look up and not find.

---

## What is still not the standard

- **Header fields.** This decision covered BG-25. The header carries
  BT-1, BT-2, BT-5 and so on, and has not been audited against the tree
  the same way. **Likely to have similar gaps.**
- **Line allowances and charges** (BG-27, BG-28), the line period
  (BG-26), and item identifiers (BT-155 to BT-158). Real terms, not yet
  needed by anything.
- **Purchase orders** use UBL element names rather than BT ids
  (decision 0081), because BIS Order Only has no BT codes. Consistent
  with the principle, inconsistent in appearance — worth knowing before
  somebody tries to unify them.
