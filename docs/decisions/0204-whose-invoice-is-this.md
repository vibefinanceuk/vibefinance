# 0204 — Whose invoice is this

**Status: built.** A source places documents in a fixed org, or reads
the recipient off the invoice.

---

## Decision 0036 designed this and built half of it

> During source configuration, it would be good to have an Org
> drop-down which allows a user to specify the `default_org_unit_id`
> from already configured Orgs, with an additional entry entitled
> `<Automatic>` which would identify the org automatically.

**The columns have been waiting since September.** Decision 0036 added
three identifiers to a legal entity and said what they were for:

> The identifiers an arriving invoice can be matched against, each named
> as the standard names it.

`BT-49` the buyer's electronic address, `BT-48` their VAT id, `BT-10`
their own routing reference. **Nothing has ever read them.**

The default on a source was built in the same record and is how every
document is placed today.

---

## `<Automatic>` is an entry, not a mode

The operator's own framing, and it is the better one: *"one email per
org"* and *"one email for everybody"* are **the same setting**, chosen
from one dropdown, rather than two mechanisms with a switch between
them.

So `null` on a source means **automatic**, not *nowhere*.

**That reading is strictly better than the old one.** A source with no
default used to leave every document unplaced — which decision 0193
showed is unhelpful, since every row read *Unassigned*. Now the document
gets a chance to say whose it is.

---

## The strongest identifier is the one real documents lack

**`BT-49` is trusted first**, because Peppol routes on it and it is the
reason an invoice reached this enterprise at all.

**`BT-48` is the one that actually appears.** A photographed invoice
carries a VAT number and almost never an electronic address — the real
freight invoice had `DE273445064` as the buyer's VAT id and no endpoint
whatsoever.

**`BT-10` is last**, because a buyer's own routing reference is whatever
the buyer told the supplier to write.

Compared without case or spacing, because `GB 907 856 199` and
`GB907856199` are the same number and neither person should have to know
what the other typed.

---

## A match names an entity, and an invoice needs a department

**The identifiers belong to a legal entity** — they are what a company
files under — and decision 0036's standing invariant says an invoice
belongs to an **operating unit**.

So a match on *Acme UK* is not yet an answer:

- **Exactly one operating unit beneath it** — unambiguous, and assigned.
- **Several** — the document belongs to the entity and to no particular
  department. **A real answer, not a failure**, reported rather than
  guessed at.
- **None** — named apart, because it needs a different fix: one needs a
  department created, the other needs somebody to say which.

---

## And it says why, where it cannot place one

`org.unplaced` records the reason on the document.

**Decision 0162's lesson**: that record found a refusal reporting
*"unreadable"* while the reason sat in a field nobody read. A document
nobody can see is one somebody has to explain, and *"no identifier"*,
*"no match"* and *"ambiguous"* need three different actions.

---

## What is not built

- **No screen reads `org.unplaced`.** It is stored and unread, which is
  the exact shape decision 0162 recorded — the third time this month.
- **A rule cannot assign an org.** `org_assigned_by` has allowed
  `'rule'` since decision 0036 and the vocabulary has no action for it,
  so derivation borrows that value for want of a better one.
- **Nothing re-derives.** A document that arrived before its entity was
  configured stays unplaced, and re-running would need a route.
- **The dropdown lists every operating unit in the customer**, not the
  ones a person administers — decision 0201 scoped granting and not
  this.
