# 0544 — The invoice-level PO check leaves Non-PO lines out

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence` (one string, migration
`0199`); no `vf-app` migration.

## What was asked

> Can you fix the "The invoice-level PO check still counts Non-PO
> lines, so a large freight line can push it over tolerance."

Left open by 0537: a line marked Non-PO no longer fails line matching,
but `po.matched` still compared the invoice's whole total (BT-112) with
what is left on the PO.

## What was decided

- **One definition of what an invoice takes from its PO**:
  its total less its Non-PO lines (`poShareOfTotal` in code,
  `poShareSql` in SQL, held to the same answer by a test).
  - A Non-PO line carries a net amount (BT-131) and BT-112 is gross, so
    the line is grossed up by the invoice's own total-to-net ratio
    (BT-112 over BT-106, or over the sum of its line nets when BT-106 is
    absent), taking its VAT with it. With no net to scale by, the net is
    taken as it is.
  - A Non-PO marker counts only against the PO it was made for (0537).
- **Used everywhere a PO's use is counted**, so they cannot disagree:
  - **this invoice's header check** (`po.matched`, `po.variance_pct`),
    through `mergePoMatchFacts` on every evaluation and in the panel;
  - **other invoices' use of the PO** (`loadPoConsumption`), so a PO is
    not "used up" by someone else's freight;
  - **the PO matching panel's usage bar**: this invoice's share, what is
    left, and a note: "This invoice's Non-PO lines (240.00 with VAT) are
    left out";
  - **the PO search** in the panel (how much of each candidate is left);
  - **the Purchase Orders screen** status (Invoiced (Part)/(Full)).
- An invoice with no Non-PO lines is counted exactly as before.

## Not built / worth knowing

- Line matching and per-line consumption (0533) already left Non-PO
  lines out; this makes the header agree with them.
- Still open: a closed or on-hold PO still matches.

## Verification

- **`vf-app`**:
  - `po-match-panel.test.ts` (4): an invoice of 1,440 (1,200 net) on a
    1,200 PO is 20% over, and matches at 0% once its 200 freight line is
    marked Non-PO (240 with VAT left out); the panel shows a share of
    1,200, 240 left out and 0 left; another invoice sees 1,200 used, not
    1,440; code and SQL give the same share, with and without BT-106.
  - `purchase-order-route.test.ts` (1): the Purchase Orders screen goes
    from Invoiced (Full) to Invoiced (Part) once the freight line is
    Non-PO.
  All 5 **failed** with the previous `po-matching.ts`,
  `po-match-panel-route.ts` and `purchase-order-route.ts`.
- **`vf-ui` `po-match.test.ts`** (1): the note shows with the amount,
  and not at all without Non-PO lines. It **failed** with the previous
  `po-match.js`.
- `vf-licence` 0199 checked on a replay (2 rows). Browser 1278/1279 (the
  known `typography.test.ts` 10px gap). Worker 75/75. `vf-licence`
  320/320.
- **`vf-app`**, a full, unfiltered run: 131 files and 3168 tests, of which **3166 passed**. The two failures are the ones already known on untouched `origin/main` (0511).
