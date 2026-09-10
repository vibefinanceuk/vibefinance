# 0194 — The org model has a name already

**Status: comparison, no code.** What this project calls units, Oracle
Fusion calls an enterprise structure — and it named the same things
first.

---

## The suggestion

> Perhaps there is a way to align the build to existing pre-designed
> ideologies from other solutions.

**This project has done that twice and both paid.** Decision 0031 took
the rule vocabulary from EN 16931 rather than inventing field names.
Decision 0184 took Concur's *Level* and *Limit* rather than designing
approval from scratch.

The org model was invented. Here is what it would have been given.

---

## Where decision 0036 landed on Oracle's own answer

| This project | Oracle Fusion |
| --- | --- |
| `legal_entity` | **Legal Entity** — files statutory accounts, registered, carries the tax identity |
| `operating_unit` | **Business Unit** — *"financial transactions are processed in business units"* |

**And Oracle's older name for a Business Unit is literally *Operating
Unit***: *"In Oracle apps we do call Operating Unit; in Oracle Fusion we
do call the Business Unit."*

Decision 0036 reached the same two-level split, with the same rule —
*"if you set up business units at a higher level than legal entities,
your financial transactions may fail"* is Oracle's version of that
record's invariant that an operating unit's parent is a legal entity.

**Arrived at independently, which is a reason to trust it rather than a
coincidence to enjoy.**

---

## And Oracle answers the question decision 0192 left open

Decision 0192 records the hardest part as undecided: does `AP.Approve`
become a pair, `AP.Approve` *in France*?

**Oracle's answer is neither a pair nor a global permission:**

> Business units are often identified with security. Users are given
> access to the data they handle through **data roles**. A data role is
> associated with a specific BU. A user can be granted access to several
> BUs through the assignment of **multiple data roles**.

So a role **is** scoped to a business unit, and a person holds **several
roles** rather than one role with several scopes.

**Which fits this project's schema almost unchanged.** `org_user_roles`
is already `(user_id, role_id)` — a person may hold many. Adding
`unit_id` to `org_roles` makes *AP Approver (France)* and *AP Approver
(Germany)* two rows, and a group treasurer holds both.

**No change to `hasPermission`'s signature**, no permission pairs, and
the answer to *"may Alice approve this German invoice"* becomes *"does
Alice hold a role scoped to this invoice's unit that grants it."*

That is a materially better answer than the one decision 0192 was
circling, and it came from reading rather than thinking.

---

## Three things Oracle has that this does not

**A ledger.** *"A legal entity accounts for itself in the Primary
Ledger"*, and a ledger is a chart of accounts, a calendar and a
currency. **Two legal entities may share one.** This project has no
ledger at all — `BT-133` is a cost centre string with no chart of
accounts behind it, which the operator's own question named.

**A division**, which *"can correspond to a collection of legal
entities"* and is *"independent"* of them. **A tree cannot express
this**: a node has one parent, so a division spanning France and Germany
has nowhere to live. Oracle represents it with a cost centre hierarchy
in the chart of accounts instead — a second axis, not a place in the
tree.

**A department**, which *"tracks your employees"* and is separate from a
business unit. This project points `org_users.unit_id` at a unit, so a
person's home and a transaction's processing scope are **the same
column** — which works while they coincide and has no way to say
otherwise.

---

## And one place this project is stricter than Oracle

> A business unit can process transactions on behalf of **many legal
> entities**.

That is the shared service centre: one AP team paying invoices for
France, Germany and the UK. Oracle requires it to be a business unit and
lets it serve several entities.

**Decision 0036's invariant forbids it** — an operating unit has one
parent, so it belongs to exactly one legal entity.

**Not obviously wrong.** The invariant's reason still holds: *"a
hierarchy that can nest arbitrarily is a hierarchy nobody can reason
about."* But a shared service centre is a real and common shape, and
this model cannot hold one.

---

## Reference data sets, and what decision 0192 proposed instead

Decision 0192's inheritance is a **tree walk**: look for configuration
at this unit, then its parent, up to a group default.

Oracle does not do that. It has **reference data sets**:

> Reference Data Sets allow organisations to share or restrict common
> business information... Instead of duplicating data across business
> units, organisations can centrally manage shared reference
> information.

A business unit is assigned a **set per kind of data** — payment terms
from one set, tax codes from another — with a *common* set as the
default.

**Which is more flexible and less obvious.** A tree walk answers *"where
does this come from"* with one path; a set assignment lets France share
payment terms with Germany while keeping its own approval rules, and
needs a screen to be comprehensible at all.

**Not proposed here.** The tree walk covers the case in front of this
project and reference data sets are what it should become if a customer
ever needs France and Germany to share one thing and differ on another.
Recorded so that arrives as a known design rather than an invention.

---

## What this changes

**Nothing built.** This is a comparison, and its value is in what it
saves later:

- **Decision 0192's permission question is answered** — roles scoped to
  a unit, held severally. That is the one to adopt.
- **A ledger, a division and a department are named absences** rather
  than things nobody thought of.
- **The shared service centre is a known limitation** of decision 0036's
  invariant, with the trade-off stated.
- **Reference data sets are where inheritance goes** if the tree walk
  stops being enough.
