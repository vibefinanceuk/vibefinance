# 0209 — Naming a supplier to the ERP

**Status: built.** An arriving invoice is matched to a mirrored
supplier, and a rule can test whether it was.

---

## What *matched* means, and it is narrower than it sounds

> Key to the mirror is having an ERP Identifier. If we do not have that,
> it indicates a new supplier record. Otherwise when we pass the
> information to the ERP, it will not know who it belongs to.

**Not *"we recognise this company"*.** An invoice we cannot name to the
ERP **cannot be paid**, however familiar the name on it — so the
identifier is the reason the record exists rather than a column on it.

`erp_identifier` is `NOT NULL`, and a standing invariant says so again
where a reader of the migrations will see it. **A row without one is a
note about a company**, and this table would then be a master
pretending to be a mirror.

---

## Decision 0204's mechanism, with the fields reversed

That record matched the **buyer** on `BT-49` and `BT-48` to place an
invoice in an org. This matches the **seller** on `BT-34` and `BT-31` to
attach it to a supplier.

**The same asymmetry holds.** The electronic address is unambiguous and
trusted first; the VAT id is the one real documents actually carry. A
photographed invoice has a VAT number on it and almost never an
endpoint.

And the same three failures, **named apart because they need three
different actions**:

- **`no_identifier`** — the document named no seller at all.
- **`no_match`** — nobody in the loaded list. **This is what routes a
  new supplier for review.**
- **`ambiguous_site`** — several sites share that VAT number.

### The last one is harder here than on the buyer's side

Decision 0207 predicted it. A company has **one VAT registration across
every site**, and Oracle's site is the relationship rather than the
address — so several matches is **normal, not a data fault**.

Picking one would attach an invoice to terms nobody agreed for it, so it
refuses and says so.

---

## A stale mirror lies confidently

Decision 0208 named this and it is built: an unmatched supplier is
reported **with the date the list was loaded**.

A supplier added to the ERP on Monday and loaded here on Friday means
four days of invoices routed for review, each correct according to this
system and wrong in fact.

***"The supplier list was loaded eleven days ago"* is the fact that
tells somebody what to do.** Without it, *"unknown supplier"* reads as
advice to create one — which, as a mirror, is exactly what we must not
suggest.

**And never loaded is a different thing from stale.** One means *"we
were told and this supplier was not in it"*; the other means *"we have
never been told anything"*, and only the second is fixed by asking the
customer for a file.

---

## The rule the operator described now has a fact to test

> If supplier does not exist, flag as new supplier and require review.

`supplier.matched` is a derived field in the closed vocabulary, so that
sentence is expressible with `assign_task` and `route_to` — both of
which have existed since decision 0031.

**Nothing else was needed.** The workflow for a new supplier was never
missing; what was missing is that nothing knew a supplier was new,
because nothing recorded suppliers.

---

## Four tables nobody had classified

Decision 0118's check found `ledgers`, `stage_rule_set_overrides`,
`stage_field_visibility_overrides` and `org_user_roles_new`
unclassified — **all added by me today**, and found only because this
record's tables made me run `shared`'s tests.

**Four migrations went out with a check unrun.** The check did its job
and the gap was between running it and not.

`org_user_roles_new` is the interesting one: it is not a table but an
**intermediate**, created and renamed because SQLite cannot alter a
primary key. It is classified anyway, because decision 0118 reads
`CREATE TABLE` statements rather than the schema they produce — and an
unclassified name is an error whether or not the table survives.

---

## What is not built

- **The load itself.** There is no route and no spreadsheet parser, so
  the only way to populate this is `INSERT`. **The table exists and the
  mirror cannot yet be filled.**
- **Re-matching after a load**, which decision 0208 called *part of the
  feature rather than a refinement*: an invoice sitting in review stays
  there after its supplier arrives.
- **Nothing reads the terms, hold, match option or tolerances.** They
  are stored and inert — the fields a process should act on, held and
  not yet acted on.
- **No screen.** A supplier is invisible, and so is the load date that
  an unmatched one depends on.
