# 0374 — Which legal entity a purchase order belongs to

**Status: built.** The operator's own question, before any code was
written: *"does it make sense to explicitly state the Org / Legal
entity in the PO fields, or derive it from the VAT reference?"* Derived
— the exact answer invoices already settled (decisions 0111, 0226),
reused rather than re-decided, with one real difference in what happens
when it can't be resolved.

---

## Reused, not re-derived: `matchLegalEntity()`

`derive-org.ts`'s own invoice-matching logic — VAT compared without
case or spacing, against `org_units WHERE kind = 'legal_entity'` — is
now a small, shared, exported function both invoices' `deriveOrgUnit()`
and this decision's own PO logic call. Extracted deliberately: a
purchase order's buyer tax reference and an invoice's `BT-48` are the
same kind of fact, checked the same way, and a second, hand-written
copy of that comparison is exactly the kind of thing that drifts the
first time one is updated without the other. Confirmed
behavior-preserving before building anything new on top of it — all 33
of invoices' own existing org-derivation tests, unchanged, still pass.

---

## Where this genuinely differs from invoices

Invoices leave an unmatched or missing buyer identifier as a stored
`null` — a fact for a person to notice later, because an inbound
invoice is a document a third party could genuinely misaddress, and
guessing would mean processing it under the wrong books unnoticed.

A purchase order is different in exactly the way the operator's own
framing named: it describes the buyer's own purchasing system to
itself. There is no third party who could misaddress it. So a missing
or unmatched buyer tax reference is **refused outright, never stored
unassigned** — `org_unit_id` on `purchase_orders` is the real invariant
here, not merely nullable-for-now the way `invoice_headers.org_unit_id`
still is.

This reuses a mechanism that already existed rather than inventing a
new one: the CSV loader already refused a line with no item name, or
duplicate line numbers, one order at a time while every other order in
the same file still loaded — the operator's own follow-up question
confirmed this was exactly the reporting shape wanted for a bad buyer
reference too. Two new reasons, same array, same UI: *"no buyer tax
reference..."* and *"...does not match any known legal entity."* The
XML path gets the equivalent: a clean 422 with the same wording, since
it ingests one order at a time and has no batch to report partial
success within.

`storeOrder()` itself now requires a resolved org id as a real
parameter — a type-level guarantee that it is structurally impossible
to call without one, rather than a runtime check that could be
forgotten at a new call site later.

---

## The list, scoped the same way every other screen already is

`GET /purchase-orders` accepts `?org=`, applies `scopedToChosenOrg` /
`unitClause` — the exact mechanism Tasks (0314), Documents (0315), and
Suppliers (0317) already use — and nothing new. No permission-scoped
visibility layer on top of it: `AP.Validate` is not, today, grantable
scoped to a single unit the way `AP.Supplier` is (decision 0358), so
`visible` is always `null` here and the chosen org is the only
restriction, exactly what was asked for.

**A pre-existing, unassigned order stays visible regardless of which
org is chosen** — the same exception decision 0255 established and
0317 carried forward. Reachable only for data that predates this
decision, since every path that stores a new order now refuses one it
cannot place — but real, and worth keeping rather than special-casing
away.

The screen itself needed no new wiring for "reload when the org
switcher changes": `relaunchAfterOrgChange()` already re-dispatches to
whatever screen is current, and Purchase Orders was already part of
that generic routing.

---

## What the screens show now

The list gained an **Org** column, alongside the raw buyer VAT already
shown — the resolved name for at-a-glance reading, the raw reference
still there for verifying against the document. The detail pop-out
gained the same field. The CSV format reference (decision 0373) now
correctly marks `buyer_party_id` as required, since a file missing it
is refused the same way one missing `order_number` already is.

---

## A second test-infrastructure gap, found the same way as the first

Wiring the new migration into `vf-app`'s own test setup surfaced the
exact same class of bug decision 0371 already found in `vf-licence`:
seven migrations — including this decision's own new one — were never
imported into `vf-app/test/setup.ts` at all. Four of the seven turned
out to be documentation-only corrections with no real SQL body at all
(0054, 0062, 0063, 0066, 0067) — narrative and assertions, nothing to
execute — which the real `apply_migrations.py` never notices, because
it always appends a bookkeeping `INSERT` after every migration's own
body, so a genuinely empty `exec()` call never happens there. This test
harness calls `exec()` directly with no such padding, so those five are
skipped by name rather than sent as an empty statement. The two with
real bodies (0060, 0068 itself) are applied normally.

---

## Tests

`derive-org.test.ts` / `invoice-org.test.ts` — unchanged, all 33
passing, confirming the `matchLegalEntity()` extraction changed nothing
about invoice behavior.

`purchase-order-route.test.ts` — 11 new tests: both refusal reasons on
both ingestion paths (XML and CSV), a CSV refusal leaving a sibling
order in the same file to load normally, the matched org id actually
stored on success (both paths), a VAT normalized across case and
spacing to the same match, the chosen org narrowing the list correctly
in both directions, every order showing when none is chosen, a
pre-existing unassigned order staying visible regardless of which org
is chosen, and the resolved org name reaching the detail view.

`purchase-orders.test.ts` (browser) — 3 new tests: the resolved legal
entity's own name shown rather than just the raw VAT, the chosen org
appended as `?org=` when one is set, and no query param at all when
none is.

vf-app: 1,775 tests (was 1,764). vf-ui: 72 worker tests (unchanged),
584 browser tests (was 581). vf-licence: 320 tests, unchanged — two new
migrations (`0114`, the "Org" label) are new keys only.
