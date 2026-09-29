# 0545 — An invoice against a PO on hold or closed does not match

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui`, `vf-licence` and `shared` (vocabulary and
rule validation), and needs **`vf-licence` migration `0200`** (strings);
no `vf-app` migration.

## What was asked

From the PO matching test pack: "closed or on-hold POs still match".
`computePoMatch` compared amounts only and never read the PO's status,
so an invoice against a PO on hold, or a closed one, matched whenever
the amounts agreed. The operator chose that **both stop at matching**,
and asked:

> I wonder if we also might add a rule to the AP Review stage, to check
> for closed / on hold purchase orders being used?

## What was decided

- **`po.matched` is false while the PO is not active** (`on_hold` or
  `closed`), whatever the amounts. The amounts are still compared, so
  `po.variance_pct` and the panel's usage bar still say how they stand.
- **Two new facts**, `po.status` (`active`, `on_hold`, `closed`) and
  `po.hold_reason` (only while on hold), merged by `mergePoMatchFacts`
  wherever `po.matched` is, so they are fresh at every stage visit. Both
  are absent when the invoice names no PO held here.
- **A closed set of values for `po.status`.** A rule saying "po.status
  is on hold" (with a space) would compile and never fire, so rule
  validation refuses any other value and names the three that exist
  (the decision 0148 argument, applied to a value the platform sets
  rather than a standard's list).
- **A new validation check, `po_status`**, "The purchase order is on
  hold or closed": danger, on BT-13, shown in the exceptions list at
  every stage, with the hold reason as its value. While it fails, the
  header-level `po_mismatch` is not reported as well (it would read
  "0.00%", which says nothing); line-level `po_mismatch` is unchanged.
- **A fifth standard matching rule**, "Standard rule: Purchase order on
  hold or closed" (fact `po.status`), suggested as "If the invoice's
  purchase order is on hold or closed, assign a task to the AP Matching
  team requiring AP.Match." The wording names no stage, so the same
  rule can be authored on Matching and on AP Review; AP Setup's
  standard rules card already lists every stage a standard rule is
  found on. This answers the AP Review request: a PO put on hold after
  Matching is caught when the invoice reaches AP Review.
- **Warnings.** The PO matching panel shows, above the PO card, "This
  purchase order is on hold: {reason}. The invoice is not matched until
  the order is released." (or the closed wording). A line's Match
  pop-out shows the same. The view carries `po.holdReason`; the
  invoice's `poMatch` summary carries `poStatus` and `holdReason`.

## Not built / worth knowing

- **The standard rule is not created automatically.** It is authored
  like the other four, from AP Setup's suggestion, on whichever stages
  are wanted (Matching, AP Review, or both).
- **Line chips are unchanged.** Each line still says how it compares
  with its PO line; the warning above says why the invoice does not
  match.
- Linking to a closed PO was already refused (0530); linking to one on
  hold is still allowed, and now shows the warning.

## Verification

- **`vf-app`**:
  - `po-match-panel.test.ts` (4): matched and `po.status` active; on
    hold stops the match (amounts still at 0%) and carries the reason;
    closed stops it; the panel and the `poMatch` summary show status and
    reason, and a stale reason on an active PO is never shown.
  - `validation.test.ts` (4): not checked without a PO held here;
    passes when active; fails as danger on BT-13 for on hold (with the
    reason) and closed; no 0.00% header mismatch alongside it.
  - `matching-config-route.test.ts`: five standard rules; the new one's
    name, fact and stage-neutral wording, found when authored on both
    Matching and AP Review.
- **`shared`**: `closed-values.test.ts` refuses "on hold" and "Closed"
  and accepts the three real values.
- **`vf-ui`**: `po-match.test.ts` (2): the panel warning with and
  without a reason, closed, none when active; the pop-out warning.
- With the previous production files, 14 of the 15 new tests
  **failed**. The one that passed checks that nothing is reported when
  no PO is held here, which the old code also never did.
- Strings: `vf-licence` 0200 (10 rows) checked on a replay.
- Browser 1280/1281 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 320/320. `shared` 298/301, the 3 known failures.
- **`vf-app`**, a full, unfiltered run: 131 files and 3177 tests, of
  which **3174 passed**. Two failures are the ones already known on
  untouched `origin/main` (0511); the third, in `po-matching.test.ts`,
  compared `computePoMatch`'s whole result and now expects the status
  fields too (the file then passed 29/29).
- Day and Night screenshots of the panel with a PO on hold checked by
  eye.
