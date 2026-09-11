# 0224 — The Buyer card

**Status: built, and partly superseded the same day.** Read the last
section.

---

## Written after the fact

**This record is the one the code was already citing.**

Seventeen references — in `derive-org.ts`, `invoice-facts-route.ts`,
`viewer.js`, migration 0053 and three later records — all pointing at a
decision that was never written down. It was found by a citation check
while bringing the handover current, not while writing any of them.

**Which is worth recording as itself.** The convention is that a comment
citing a number can be followed to a record; seventeen comments could
not.

---

## What was built

The mirror of decision 0219's Seller card: **our own record of who this
invoice is for**, set beside the image so a person can see the document
is addressed to us.

**The same layout** — inline labels, an address block, and since
decision 0221 a phone number. **Deliberately shared**, because the two
cards answer the same question from either side and a second layout
would say they did not.

**`org_units` gained contact details** (migration 0053). Decision 0036
had given it the identifiers an invoice is **matched on** — `vat_id`,
`buyer_endpoint`, `buyer_reference` — and **nothing a person reads**. An
invoice printing *"Acme UK Limited, 1 Handover Street"* cannot be
checked against a VAT number alone.

**And a search, with re-routing**, which the operator asked for:
*"sometimes re-routing is needed."* Offered even when a unit was found,
because **a wrong one is worse than none** — none stops at the org gate
(decision 0037), and a wrong one sails through every org-scoped stage
after it behaving correctly on the wrong answer.

---

## Superseded within hours

**Decision 0226 moved the header from a department to a company**, and
took two things with it.

**The entity-and-unit sub-line** (decision 0227). It existed because an
invoice was assigned to an operating unit beneath a legal entity, so a
card naming one of them named a department with no identity or a company
with no department. **When they became the same row it said a name
twice.**

**And the pop-out's reasons.** `ambiguous_unit` and `no_operating_unit`
were written here as sentences a person could act on, and decision 0226
deleted the states they described.

**What stands** is the card itself, its contact details and its search —
which is most of it, and the part that was about a person reading a
document rather than about where an invoice is filed.
