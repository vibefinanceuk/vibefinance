# 0208 — A mirror, not a master

**Status: designed, not built.** Suppliers are loaded from the
customer's ERP and held as a small subset.

---

## The answer decision 0207 was waiting for

> We are the mirror. A customer would need to supply us with a supplier
> master file (spreadsheet to load), and we would hold a small subset of
> the information that impacts workflow.

**This removes most of decision 0207's eighty attributes.** We are not
maintaining suppliers, so there is no create, no merge, no duplicate
resolution, no approval of a new vendor — all of that is the ERP's, and
reimplementing it would be reimplementing the ERP.

**What is left is a lookup table with opinions**: enough to recognise a
supplier on an arriving invoice, and enough to change what happens to
that invoice.

---

## And the rule the operator described already fits

> If we receive a new invoice, from a new supplier, and we cannot
> identify it already lives in the ERP, then I foresee it will sit in
> the AP Review stage. We can have a business rule that checks *"if
> supplier does not exist, flag as new supplier and require review."*

**That sentence is expressible in the closed vocabulary today**, save
for one field. `route_to` moves it to a stage, `assign_task` raises the
review, `flag` marks it — all exist (decision 0031).

What is missing is a fact to test. **`party.first_document` is the wrong
one**, and decision 0207 said why: a supplier absent from our records is
*unknown*, while a known supplier's first invoice is a *first document*.
The second is interesting; the first is what routes to a team.

So: **`supplier.matched`** as a derived field, and a rule reading *"if
the supplier is not matched, assign a task to the AP team requiring
AP.Review."*

---

## The first trap: a stale mirror lies confidently

**A mirror that is out of date reports a real supplier as unknown**, and
the consequence is not a blank field — it is **a task on somebody's
queue that should never have existed**.

A supplier added to the ERP on Monday and loaded here on Friday means
four days of invoices routed for review, each one correct according to
this system and wrong in fact.

**So a load must record when it happened**, and an unmatched supplier
should be reported with that date beside it: *"no supplier matches this
VAT number; the supplier list was loaded eleven days ago."*

**Eleven days is the fact that tells somebody what to do.** Without it,
*"unknown supplier"* is advice to create one — which, as a mirror, is
exactly what we must not suggest.

---

## The second trap: nothing re-checks

Decision 0204 recorded this about org placement and it is sharper here.

**An invoice sitting in AP Review because its supplier was unknown stays
there after the supplier is loaded.** The fact that sent it there is no
longer true, and nothing looks again.

With one customer and a handful of invoices, a person clears them by
hand. **With a monthly load and a hundred suppliers, that is a queue
that grows between loads and never shrinks by itself.**

**Re-matching after a load is part of the feature, not a refinement of
it.**

---

## What a load looks like

**A spreadsheet**, because that is what a customer can produce from any
ERP without an integration.

**Keyed on the ERP's own identifier**, not ours. A mirror whose primary
key is local has nothing to reconcile against, and the whole point is
that the ERP can say *"supplier 40118 has changed."*

**Matched on what an invoice carries** — `BT-31` the seller VAT id and
`BT-34` the seller electronic address, which is decision 0204's
mechanism with the fields reversed.

**Replace rather than merge.** A load is the ERP's current truth, and
attempting to reconcile row-by-row invents a conflict resolution nobody
asked for. A supplier absent from a new load is **inactive**, not
deleted — an invoice already pointing at it must still say who it was.

---

## The subset, and why each field is in it

| Field | Why it is not the ERP's business alone |
| --- | --- |
| ERP identifier | What a payment instruction must carry |
| Name | What a person recognises |
| VAT id, electronic address | **What an arriving invoice is matched on** |
| Country | Reverse charge and intra-community supply behave differently |
| Payment terms | `BT-9` is the supplier's **claim**; terms are what was **agreed** |
| Hold, hold reason | An invoice from a held supplier **routes differently** |
| Match option | Two-way or three-way — **decides which stages it visits** |
| Tolerances | When a match fails, and by how much before it does |
| Status, inactive date | An invoice from a closed supplier is an exception |

**Everything else is carried and forwarded or not held at all.** Bank
details are the ERP's payment run; consignment ageing and carriers are
buying, and this product starts when an invoice arrives.

---

## Sites, and whether they are needed yet

Decision 0207 found that Oracle's site is `(supplier, procurement BU)` —
the relationship rather than the address.

**A customer's spreadsheet may have one row per supplier or one per
site**, and that decides whether this needs two tables or one.

**Not decided here**, and it can be deferred honestly: a single table
with a nullable site identifier holds the one-row case exactly and
extends to the second without a migration that moves data.

---

## Deliberately not decided

- **One table or two**, above.
- **Whether terms override `BT-9`** or merely disagree with it visibly.
  Decision 0170's argument suggests the second: a disagreement is
  information, and silently preferring one hides it.
- **Whether a hold blocks or routes.** A rule reading `supplier.held`
  keeps it in the vocabulary where a customer can see it; a property on
  the stage makes it structural, as decision 0143 did for read-only.
- **What a load does to invoices already in flight**, beyond
  re-matching the unmatched. A supplier whose terms changed mid-month
  has invoices assessed under the old ones.
