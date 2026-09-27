# 0515 — Each Return stage is offered once, however often the invoice visited it

**Status: pushed (`d11ae2c`) and `vf-app` deployed, as confirmed by the operator on 27 September.**

## What was asked

Reported live, with a screenshot of Return's "Return to" list opened at
the Approval stage. It showed *Coding — AP Coding* three times and
*Validation — AP Validation* twice:

> I've noticed that the Return button includes duplicates - three
> Coding options, and 2 validation options.

## What was found

`handleReturnTargets` (`return-route.ts`, decision 0490) offers a
configured return target only if the invoice has actually been at that
stage. That is the visited-only rule decision 0075 set. It checked this
by joining `stage_visits`, which returns one row per *visit*. An
invoice that has been returned and resubmitted revisits the same
stages, so each earlier visit added another copy of the option.

`handleReturnToStage`'s own check (`SELECT 1 … LIMIT 1`) was never
affected, so returning to any of the duplicates always worked. Only the
list was wrong.

## What was decided

The join is replaced by `EXISTS`: "has this invoice been at that stage"
is a yes/no question. Everything else is unchanged: which targets are
configured, the team each one goes to, the sort order, and the standing
Return requires.

## What was verified

- **New test in `return-route.test.ts`:** a target visited three times
  is offered once. It **failed** with the fix stashed.
- **`return-route.test.ts` and `index.test.ts` together:** 250/250.
