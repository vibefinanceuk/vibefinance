# 0514 — Coding is required only at stages offered Account Coding, and never on a PO invoice

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
changes `vf-app` only. There is no migration and no string change.

## What was asked

Reported live, the day decision 0513 deployed:

> I have a situation, where account coding is being prompted at the
> validation stage on a PO invoice, when the validation stage is not
> configured to Offer Account Coding Restrictions for this stage. So
> there are two issues - 1) Requiring account coding for a PO invoice.
> 2) Requiring account coding for an invoice at validation, when
> validation is not configured to offer coding at that stage

## What was found

**0513's check read the customer-wide default as "required".**
`codingGapsForTask` requires every coding field the stage lets a person
edit. What a stage lets a person edit comes from field visibility.
Stage Restrictions (0483) can only ever narrow that, and 0485's "Offer
Account Coding restrictions for this stage" decides whether the
Stage Restrictions screen shows a stage at all. So a stage *not*
offered (Validation, here) cannot be restricted. Its coding fields keep
the customer-wide default, usually `edit`, and 0513 turned that into a
demand for coding at a stage nobody treats as a coding stage.

**A PO invoice was treated like any other.** Its lines are charged
through the order it references. Nothing in 0513 distinguished it.

## What was decided

Both changes are in `codingGapsForTask`, and both go ahead of anything
else it checks.

- **A stage with `offer_field_restrictions = 0` demands no coding.**
  That flag is how an operator marks the stages where coding is
  configured at all, so it is the right switch for where coding is
  required. `NULL` reads as offered, the column's own default.
- **An invoice carrying an order reference (BT-13) demands no
  coding.** This is the same test Non-PO approval routing already uses
  (`poReferenced`, 0469/0471), so the two can never disagree about
  which invoices are PO ones.

Everything else about 0513 is unchanged. A non-PO invoice at an
offered stage with coding editable is still refused until every line
is coded with valid values.

## What was verified, and how

Three new end-to-end tests in `index.test.ts`, through the real
router:

- Complete succeeds at a stage not offered Account Coding restrictions.
- Complete succeeds on a PO invoice.
- A non-PO invoice at an offered stage is still refused.

The first two **failed** with `coding-validation.ts` stashed. The third
is the unchanged 0513 behaviour, which passes either way.

## What was not built

- **Editing is unchanged.** A stage not offered restrictions still lets
  a person *edit* coding if the customer-wide default allows it, as
  0485 decided. This decision only stops *requiring* it there.
- **Mixed invoices.** An invoice with an order reference on some lines
  (BT-132) but no BT-13 on the header is still treated as non-PO. The
  header reference is what Non-PO routing reads too.
- **Make sure Coding itself is offered.** If the Coding stage has
  "Offer Account Coding restrictions" turned off, it now requires
  nothing either.

## Verification

- **`vf-app`**, a full, unfiltered whole-suite run: 125 files and 3069
  tests, of which **3067 passed**. The two failures are the ones
  already confirmed on untouched `origin/main` (0511): `capture-pdf`'s
  "writes the corrected value back" and `stage-permissions`'s "names
  exactly the permissions the code defines".
- **`npx eslint`** on both touched files: clean.
- **`check-citations.py`**: 514 records, none dangling.
- **`vf-ui` and `vf-licence`**: untouched.
