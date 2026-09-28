# 0533 — PO matching, phase 3: matching against what is left, and how much of each PO line is used

**Status: pushed (`388bfa0`), deployed, and migration `vf-licence` `0190` applied, as confirmed by the operator on 28 September.**

## What was asked

After 0532 was confirmed live: "Please proceed with phase 3". Phase 3
of the four agreed at 0530:

- track how much of each PO line has been used;
- fix what 0530 found, that a line invoicing part of a PO line read as
  a mismatch.

## What changed in matching (`po-matching.ts`)

**Matching now asks "is this over-billing what is left?"** rather than
"does this equal the whole PO line?". Less is a partial delivery, not
a disagreement.

- **What is left.** `loadPoConsumption` counts every *other* invoice
  whose BT-13 names the PO, except one whose process ended unpaid:
  discarded (`archived`, 0078) or returned to the supplier
  (`returned_manually`). It counts:
  - their BT-112, for the PO total;
  - their lines, per PO line, by the reference in force (a saved
    pairing, 0532, before the supplier's BT-132), summing quantity
    (BT-129) and amount (BT-131).
- **Quantity** may not exceed the PO line's ordered quantity less what
  others have taken, beyond tolerance. `po.line_quantity_variance_pct`
  is the excess as a share of the quantity ordered, and 0 at or under.
- **Price.** Two checks, both only against over-billing:
  - the line's amount may not exceed what is left of the PO line's
    amount;
  - where both sides give a unit price (BT-146 ÷ BT-149 base quantity,
    or amount ÷ quantity; the PO's price ÷ base quantity, or amount ÷
    quantity) and the units agree, the invoice's unit price may not
    exceed the PO's.

  `po.line_variance_pct` is the larger excess. A partial invoice at a
  higher unit price is still caught.
- **The invoice total** (`po.matched`, `po.variance_pct`) may not
  exceed the PO total less what others have taken.
- **`mergePoMatchFacts` takes `{ invoiceId }`**, so the invoice never
  counts itself. Every caller that knows the invoice passes it:
  - `loadLiveInvoiceFacts`, used by every re-evaluation after a task
    completes;
  - the invoice read path;
  - the stage-visit route;
  - the header-only evaluate route;
  - keying's advisory verdict;
  - intake.

  Without it, nothing counts as taken. That is only right for an
  invoice not yet stored, and no production caller relies on it.
- **Fact names are unchanged**, so every compiled rule keeps working.
  Their descriptions in `shared/interpreter/vocabulary.ts`, which the
  rule compiler reads, now say what they mean.

**Every existing matching test passes unchanged.** They were all exact
or over-billing cases.

## The panel, and the Purchase Orders screen

- **Each paired PO line shows how much of it is used**: a small bar
  (invoiced before grey, this invoice blue, red once over) and
  "Ordered 60 · invoiced before 4 · this invoice 50 · left 6".
  Quantities are used, or amounts for a line with no quantity. The
  figures come from the same `loadPoConsumption` the rules use.
- **PO lines this invoice does not use** show how many are left, when
  others have taken some.
- **The PO-level bar** uses the same consumption, so a discarded or
  returned invoice no longer counts. The search results do the same.
- **The Purchase Orders screen's "Invoiced (Part/Full)"** (0377) now
  leaves out discarded and returned invoices too, so the screen and
  matching never disagree about what an order has used.
- **`vf-licence` migration `0190`**:
  - adds `pomatch.lineuse` and `pomatch.unusedleft`;
  - rewords `pomatch.r.price` and `pomatch.r.qty` to "Over the PO by
    {pct}" and "Quantity over what is left by {pct}", since a variance
    is now always an excess.

## Worth knowing

- **Matching is re-computed at every evaluation, never stored** (0370).
  A Matching task already raised for a partial invoice is not closed by
  this change. Its rule is re-checked when the task is completed, and
  only if the stage re-checks on Complete (0487).
- **The supplier PO variance report** (`supplier-po-variance-route.ts`)
  keeps its own variance of invoice total against PO total, so it still
  reports what it always did. Whether that report should also move to
  "over what is left" is its own question.
- **Units.** Quantities from other invoices are summed as given. A line
  invoiced in a different unit from the PO line is already flagged by
  `po.line_unit_mismatch`, and its quantity is never compared.

## Verification

- **`vf-app`**, a full, unfiltered run: 127 files and 3112 tests, of
  which **3110 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- **`vf-app` `po-matching.test.ts`**, 6 new tests:
  - a partial line and a partial total match;
  - a higher unit price on a partial invoice is caught (16.7%);
  - other invoices' quantity and amount are counted, per line and in
    total;
  - discarded, returned and self invoices never count;
  - another invoice's saved pairing counts;
  - with no invoice id, nothing is counted as taken.

  5 **failed** with `po-matching.ts` stashed. The sixth, no invoice id,
  is unchanged behaviour. All 23 existing tests pass unchanged.
- **`vf-app` `po-match-panel.test.ts`**: per-line use (ordered, before,
  this, left), and a discarded other invoice no longer counted.
  **`purchase-order-route.test.ts`**: an archived invoice leaves the
  order Active. All 3 **failed** with the routes stashed.
- **`vf-ui` `po-match.test.ts`**, 3 new tests: the usage row and bar,
  red when over, and amounts for a line with no quantity. All
  **failed** with `po-match.js` stashed. Browser 1236/1237 (the known
  `typography.test.ts` gap). Worker 75/75.
- **`vf-licence`**: 320/320.
- **`apply_migrations.py --replay-only`**: all assertions held.
- **A Playwright screenshot** of the real panel: lines at 100%, part
  used, and over.
