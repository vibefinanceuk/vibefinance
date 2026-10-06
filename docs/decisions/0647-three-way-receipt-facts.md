# 0647: Three-way matching — the receipt facts and two standard rules

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`. It needs
**vf-licence migration `0290`** (strings) and no vf-app migration.
Deploy vf-licence, then vf-app and vf-ui.

## What was asked

This is Stage 2 of the Goods Receipts proposal (0643). Asked whether the
Matching stage needed a suite of new rules, I answered: *"two standard
rules, three facts and an automatic re-check, rather than a suite"*.
Dan agreed. His Stage 2 choices were to override with a reason (that
is, resolve the AP.Match task) and to re-check automatically; part-
payment is left for later.

This decision is the facts and the rules. The re-check when a receipt
arrives is the next one.

## What was built

### Three facts on each invoice line (`shared` vocabulary, vf-app `po-matching.ts`)

They apply to an invoice whose supplier is **Receipting required**
(`match_option = 'three_way'`, 0643). Each line that found its PO line
gets three facts:

- **`po.line_receipt_matched`**: everything invoiced against that PO
  line so far is within what is held there, allowing the supplier's
  quantity tolerance, or else the organisation's.
  - *Invoiced so far* means other invoices, counted as two-way matching
    counts them (`loadPoConsumption`), plus this invoice's lines on that
    PO line up to and including this one.
  - *Held* means net received: received less returned, on receipts not
    cancelled.
- **`po.line_receipt_shortfall_pct`**: how far it goes beyond what is
  held, as a percentage of the quantity ordered. It is 0 when it does
  not go beyond.
- **`po.line_credit_expected`**: goods were returned from that PO line,
  and what is invoiced goes beyond what was kept.

**They are absent, not false,** in these cases:

- any other supplier;
- a Non-PO line;
- a line whose PO line was not found;
- a line with no quantity.

So a receipt rule can never fire on a two-way supplier, which is the
convention 0466 set for the line facts.

**They are read live:**

- **Whether the supplier needs receipting** comes from the invoice's
  supplier as it is now, the same way `supplier.projectOnly` is read. If
  Dan marks a supplier, invoices already in hand are judged by it.
- **The facts themselves** are worked out afresh on every evaluation,
  so a receipt recorded since then changes the answer.

`mergePoMatchFacts` adds them for every caller, so every stage that
evaluates sees them.

### Two standard matching rules (vf-app `matching-config-route.ts`)

They are offered on AP Setup's Matching tab beside the five already
there. As with those five, they are authored, compiled, confirmed and
activated as any rule is (0474); nothing is created unasked.

- **Awaiting receipt**: *"If a line has been invoiced beyond what has
  been received, assign a task to the AP Matching team requiring
  AP.Match."*
- **Credit expected**: *"If goods on a line were returned after it was
  invoiced, assign a task to the AP Matching team requiring
  AP.Match."* This also suits AP Review, where a return recorded after
  Matching is still caught.

Neither sentence needs a supplier condition, because the facts are
absent for any other supplier. A task either one raises names the
standard rule as its open reason, in English and German. Resolving that
task with a reason is the override Dan chose.

**The existing quantity-mismatch rule is unchanged.** It compares with
what was ordered; these compare with what was received.

**These are not a validation failure.** Awaiting receipt is a state of
the world, not an error in the invoice's data, so `validation.passed` is
untouched. Making it a failure would have changed the routing of every
rule that reads it. What happens is the stage's rules to decide.

### In the PO matching panel (vf-app `po-match-panel-route.ts`, vf-ui `po-match.js`)

For a Receipting required supplier:

- the linked order says *Receipting required*;
- each line shows its verdict, worked out by the same `mergeReceiptFacts`
  the rules read:
  - *Received: 10 kept, 10 invoiced*;
  - *Awaiting receipt: 30 kept, 50 invoiced*;
  - *Credit expected: 5 returned, 50 invoiced*;
- the lines section notes how many lines are invoiced beyond what was
  received.

For any other supplier, none of this shows.

### Words (vf-licence `0290`)

Seven keys, in English and German.

## Not built (next)

- **The re-check when a receipt arrives.** When a receipt, return or
  cancellation is saved, the open invoices on that PO will be
  re-evaluated at their stage. A task raised by a receipt rule that no
  longer fires will close on its own, with a Timeline entry. Until
  then, such a task is resolved by hand.

## Verification

- **`vf-app`** `receipt-facts.test.ts`, 5 tests:
  - the facts are absent for a two-way supplier and for a line with no
    PO line;
  - matched and shortfall, counting another invoice, and two lines of
    one invoice on the same PO line in order;
  - credit expected after a return, and the supplier's 5% tolerance;
  - the supplier's setting is read as it is now, and a cancelled receipt
    counts for nothing;
  - the panel's per-line verdict with what was received, returned and
    invoiced, and nothing for a two-way supplier.

  `matching-config-route.test.ts` now expects seven standard rules.
- **`vf-ui`** browser `po-match.test.ts`, 3 tests: the supplier's
  Receipting required and each line's verdict and the warning; credit
  expected; nothing for another supplier.
- **`shared`**: the vocabulary tests pass. The three failures are known
  and predate this work (two in `licensing/token.test.ts`, and
  `table-classes`, which has many tables unclassified since well before
  goods receipts).
- **Full runs**:
  - vf-app 3626, of which 3623 pass: the two known failures, and the
    same `index.test.ts` *supplier mappings* test timing out under load
    (5s) as in 0646, which passes on its own;
  - vf-ui browser 1575, of which 1574 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - shared 436, of which 432 pass, with 1 skipped;
  - migrations replay to vf-licence 290.
