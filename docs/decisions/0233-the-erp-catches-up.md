# 0233 — The ERP catches up

**Status: built.** A supplier recorded from an invoice gains its ERP
identifier when the next load names it.

---

## The sequence, in the operator's words

> A new invoice from a new supplier could be received. We want a way to
> capture the supplier information and save it, but that would trigger a
> 'new supplier' process somehow. The new supplier would be created and
> the record here updated to include the ERP Identifier retroactively.

**Decision 0231 built the state and left the sequence broken.** It
recorded the gap as the largest hole in itself:

> A customer who records a supplier by hand and then loads the ERP file
> gets two.

---

## Adoption is the retroactive part

A load now looks for a supplier **with no ERP identifier** carrying the
same VAT id or electronic address, and **fills that row in** rather than
inserting a second.

**Matched on what both rows carry**, because a local row has no ERP
identifier by definition — which is the entire reason it exists.

**And it keeps its own id** (decision 0217's argument): invoices matched
to it yesterday still mean that supplier, and a new id would orphan them.

### Only a row with no identifier

One that has one is found by decision 0217's lookup. **Treating it as
local would let a load rewrite an identifier decision 0231 refuses a
person to change** — and a load is not more trustworthy than a person
about which supplier a row is.

---

## Captured where somebody notices

The unmatched Seller card's pop-out now offers **record this supplier
from the invoice**, pre-filled from `BT-27`, `BT-31`, `BT-34` and
`BT-40`.

**Pre-filled because a person who has just read the document should not
retype it** — and because those facts are exactly what the team creating
the ERP record needs.

**An offer, not a default.** It sits below the search, because somebody
should look for the supplier before recording a second one.

---

## What still has to be a customer's own rule

**Nothing triggers the new-supplier process.** `supplier.awaitingErp` is
a fact in the closed vocabulary and no rule reads it.

**That is deliberate.** *"Route an invoice whose supplier awaits the
ERP to the supplier-setup team"* is a sentence a customer writes, with
`route_to` and `assign_task` — and their team, their stage, their
permission. Building it here would be guessing at three things they
know and we do not.

---

## What is not built

- **The load reports adoptions and nothing acts on them.** An invoice
  that became payable when its supplier was adopted **stays wherever a
  rule put it** — decision 0211's re-match corrects the fact and not the
  queue, and this is the same boundary.
- **Two local rows for one company** are still possible: somebody
  records the same supplier twice from two invoices, and nothing
  notices. A load would adopt one of them.
