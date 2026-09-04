# 0081 — Purchase orders

**Status: built** — storage, parsing and ingestion. **Matching is not
built**; that is the next piece and needs its own decision.

---

## What this unblocks

Decision 0079 found `po.matched` and `po.variance_pct` declared in the
closed vocabulary and computed by nothing. A matching rule compiled,
passed the activation gate, fired on the right invoices and **did
nothing** — because there were no purchase orders in the system at all.

Decision 0080 then made Matching a real stage with nothing to do.

This is the missing data.

---

## Grounded in Peppol BIS Order Only 3.3

Read from `docs.peppol.eu` before anything was written, not recalled —
the discipline `ubl-parser.ts` established, and the reason decision
0059's `cac:TaxTotal` cardinality trap was found there rather than by a
customer.

Four things differ from the invoice side in ways that would have bitten
if assumed:

| | Invoice | Order |
| --- | --- | --- |
| Namespace | `Invoice-2` | `Order-2` |
| Totals | `cac:LegalMonetaryTotal` | `cac:AnticipatedMonetaryTotal`, and **optional** |
| Lines | `cac:InvoiceLine` | `cac:OrderLine/cac:LineItem` — a level deeper |
| Field naming | EN 16931 Business Terms | UBL element names |

### There are no BT codes

The invoice vocabulary is built on EN 16931 Business Terms. BIS Order
Only derives from **CEN BII Profile 03** and addresses everything by UBL
element name.

So the columns are named for what they are — the same decision
`EXPENSE_FIELDS` took (decision 0022) and for the same reason:
**inventing a "PO-n" numbering would falsely imply a standard that does
not exist for this document.**

### The totals class is optional

`cac:AnticipatedMonetaryTotal` may be absent entirely, and where present
only `LineExtensionAmount` and `PayableAmount` are mandatory. Every
amount column is therefore nullable — a `NOT NULL` would reject
conforming documents, and a test asserts an order with no totals is
accepted.

---

## A separate parser, not a parameterised one

`ubl-order-parser.ts` sits beside `ubl-parser.ts` rather than sharing
it. A single parser taking a "document kind" would branch on all four
differences above, which is a worse thing to read than two files that
each say what they parse.

The `PartyIdentification` handling records the same trap twice found
elsewhere: the element repeats, the first is taken, and **that choice is
stated rather than assumed** — as with the repeating `PartyTaxScheme`
and the 1..2 `TaxTotal`.

---

## Ingestion is not capture

`POST /purchase-orders`, deliberately **not** a fourth structural
channel under `/sources/:id/capture`.

An order is not a document arriving for processing. Nothing extracts
from it, no rule evaluates it, no person approves it, and it never
enters a process instance. It is **reference data invoices are matched
against**.

Routing it through capture would bring detection, intake channels,
provenance and an instance — all describing a document with work to be
done, none of which applies.

`Admin.Configure` for the same reason: loading orders is setting up what
invoices are matched against, not accounts payable work. Reading one
back is `AP.Validate`, because that is who needs to see it.

---

## A re-sent order replaces, never appends

The order number is unique by construction, and a buyer re-sending an
order means a **revised** one.

Two versions in storage would make matching ambiguous in the worst
possible way: silently picking one. Watched to fail — appending instead
of replacing breaks the test directly.

---

## Three invariants worth their length

- **An order number is never blank.** A blank one cannot be matched
  against and sits in storage looking like data.
- **Every line has an item name or an identifier.** The spec's own rule,
  and a *disjunction* — which is why it is a standing invariant rather
  than a `NOT NULL` on either column, since a column constraint cannot
  express "one or the other".
- **A quantity always carries its unit.** The spec requires a valid unit
  for every quantity, and 120 of something is not a quantity.

---

## What is not built

**Matching itself.** `po.matched` and `po.variance_pct` remain
uncomputed, so decision 0079's finding is half-closed: the data now
exists, and nothing computes the fields from it.

That is deliberately separate, because matching has real design
questions this decision does not answer:

- **Header or line level?** An invoice total against an order total is
  easy and weak. Line-against-line is what catches a supplier billing
  for more than was ordered, and needs a line-correspondence rule.
- **What counts as matched?** `po.variance_pct` implies a tolerance, and
  a tolerance is a customer setting — like `currencyTolerance` before it
  (decision 0053).
- **Computed when?** The same question `party.first_document` faces
  (decision 0079): at capture it is a fact about the moment, at
  evaluation it changes as orders arrive. The interpreter's
  reproducibility property says compute once and store.
- **Which order does an invoice belong to?** `BT-13` is the obvious key
  and it is optional on invoices — and absent entirely on documents
  nobody could read.

**Also not built:** any way to load orders in bulk, or from an ERP. One
document per request, which is enough to prove the shape and not enough
for a real customer.
