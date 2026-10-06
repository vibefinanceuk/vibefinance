# 0649: Receipt facts at intake, once the supplier is known

**Status: built and tested locally, not yet pushed or deployed.** It
touches only `vf-app`, with no migration and no strings.

## What was reported

> *"I partially receipted a purchase order, and was expecting the
> invoice to trigger the awaiting receipt rule, but it did not seem to
> stop in the Matching queue."*

## Why

At intake (`handleCaptureIntake`, which every capture path uses), the
facts are built in this order:

1. The PO facts are merged (`mergePoMatchFacts`).
2. The enricher runs. It places the invoice in its org and **matches its
   supplier**, which supplies `supplier.matchOption` and the supplier's
   tolerances.

So when the receipt facts were worked out (0647), nothing yet said that
the supplier was Receipting required:

- the invoice's `supplier_id` was not set;
- the facts held no `supplier.matchOption`.

The receipt facts were therefore left out, as for any two-way supplier,
and *Awaiting receipt* could not fire when the invoice first visited
Matching.

Every later evaluation was already correct. Those are a visit after a
task completes, the Complete guard and the re-check (0648). They read
the invoice's supplier as it is stored.

## What was built

`mergeReceiptFactsForInvoice` (vf-app `po-matching.ts`) works out the
receipt facts again, given the enriched header facts. Intake calls it
straight after the enricher, so the first stage visit sees them, and
with the supplier's own quantity tolerance.

Nothing else moved. The PO facts still come before the enricher, which
may depend on that order.

## Verification

**`vf-app`** `receipt-recheck.test.ts`, one new test, through the real
intake path:

- PO-300 line 1 has 30 received;
- an invoice for 40 arrives, with the supplier known only from the
  enricher (as the email and route paths give it);
- it stops at Matching with an open *Awaiting receipt* task on line 1.

**The test fails without the change**, confirmed by running it with the
change stashed.

The intake, receipt-facts and re-check tests are 35 of 35.

**Full runs:** vf-app 3633, of which 3631 pass (the two known failures).
