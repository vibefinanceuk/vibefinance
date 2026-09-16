# 0358 — Real, Permission-Based Scoping for Suppliers

**Status: built.** Reported live: "We recently added the org unit, at
supplier site level. would it be possible to filter the supplier by
org permissions. We also have a supplier card on the Dashboard, which
I think should be filtered by org (if possible)."

---

## What was investigated first

Both requests followed directly from an earlier investigation
(decision 0357's own research turn) that had already confirmed the
gap precisely: reading the supplier list has never been unit-scoped
at all. Decision 0276 gated it on `AP.Supplier` alone, with no
permission-based visible set to intersect against — unlike `AP.Review`,
which Documents, Tasks, and the dashboard already narrow correctly.
Decision 0317's own comment in the code said this plainly at the
time: *"there is no permission-based `visible` set to intersect
against first... this is the first restriction of any kind."*

The dashboard's own supplier card (`suppliers_awaiting_erp`) was
confirmed separately as one of only two cards never given the shared
`scope` every other card already threads through. The other,
`unplaced_documents`, is deliberately unscoped — a document with no
unit at all is unscopable by definition, the whole reason `unitClause`
treats a null unit as visible to everyone. The supplier card had no
such excuse: it was a plain, unexplained gap.

## What was built

**A real refactor first.** `Scope` and `unitClause` moved out of
`dashboard-route.ts` into `enforce.ts`, the established home for
`unitsWherePermitted` and `scopedToChosenOrg`. Reading suppliers now
needed the identical logic; duplicating it risked the "unassigned
stays visible" exception drifting apart between two copies over time.

**`handleListSuppliers`** now computes a real, permission-based scope
from `AP.Supplier` — walked down through the org tree the same way
`AP.Review` already is — and narrows further by whichever org is
currently chosen, the same "intersect, never replace" shape already
proven for Documents and Tasks. `userId` is optional, defaulting to
unrestricted, so no existing caller was forced to change.

**A real design question caught before it shipped, not after.** The
dashboard's own shared `scope` is computed from `AP.Review` — the
wrong permission for a supplier card. Using it as-is would have made
the card's own count silently disagree with what the Suppliers screen
itself shows the same person. `scopeFor` was generalised to take the
permission as a parameter, and a second, separate `AP.Supplier`-based
scope is now computed specifically for this one card.

## A real, pre-existing gap in the test schema, found while writing tests

Both changed functions had zero prior test coverage for exactly the
behaviour being added. Writing the first real test for the dashboard
card hit a `CHECK` constraint failure naming a card-type list that
still included `needs_somebody` and excluded `suppliers_awaiting_erp`
entirely — migration 0057, which replaced that list over a year of
decisions ago, had never been applied in `setup.ts` at all. No test
could ever have inserted one of the three real, live card types that
migration introduced, which is the actual reason none of them had any
coverage before now, not merely an oversight in this one decision.
Fixed by applying the missing migration in the test schema itself.

## What has coverage

Suppliers: the same shape of tests already proven for Documents and
Tasks — narrowed to a directly-held unit, an unscoped ("everywhere")
grant seeing everything, an unassigned supplier staying visible
regardless of scope, and the exact security case (held only in
Germany, focused on France, sees nothing) — each probed directly by
reverting the fix. The dashboard card: the same set, plus a dedicated
test for the wrong-permission bug this decision's own build caught —
confirmed that holding only `AP.Review` grants nothing through this
card, probed by reverting to the shared, wrong scope and watching five
of six new tests fail at once.

`vf-app`: 1719 (was 1706). `vf-ui` and `vf-licence` untouched — no
frontend or string changes were needed for either fix.

## Deliberately not decided here

- **`handleSearchSuppliers`**, used when manually assigning a supplier
  to a specific invoice, is not scoped by this decision — a
  genuinely separate question (whether picking a supplier for one
  invoice should be restricted the same way browsing the full list
  now is) that was not asked here.
