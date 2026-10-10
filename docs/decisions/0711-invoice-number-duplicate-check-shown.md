# 0711: The invoice number shows its duplicate check

**Status: built**, not yet deployed. vf-app (`validation.ts`, `invoice-facts-route.ts`,
`key-fields-route.ts`); vf-licence migration `0320_duplicate_check_strings.sql`. No vf-app
migration.

## What was asked

Dan, 10 October 2026, after 0710:

> I've noticed that the invoice number and lines do not show up as green. Arguably, if the
> invoice number is not a duplicate it should also show as green. Also the lines if they
> are not in error. However, I'm torn between flagging an item as green, over simply
> leaving it as unhighlighted and only highlighting fields in error.

Recommended, and agreed (*"Yes please."*): keep three states, each meaning something.

| On screen | Means |
| --- | --- |
| Red or amber | A check ran and failed |
| Green | A check ran and passed |
| Plain | Nothing checks this field |

The invoice number was plain because the duplicate check (decision 0028) never reported to
the screen. **Lines stay as they are**: green on every cell of every line would be noise,
and each line's pass already shows in its Match column (`L1 ✓`). Line cells still turn red
or amber when a check fails.

## What it does

The invoice screen (on opening, and after Save) reads the duplicate score decision 0028
stores on every save, `invoice_headers.duplicate_confidence`, and compares it with the bar
the Possible duplicates card and the Documents filter already use
(`POSSIBLE_DUPLICATE_THRESHOLD`, 0.4):

| Score | Invoice number | On hover |
| --- | --- | --- |
| Below 0.4 | Green | Not a duplicate of an earlier invoice from this supplier |
| 0.4 or more | Amber, and listed with the other exceptions | Possibly a duplicate of an earlier invoice from this supplier |
| Never scored | Plain | — |

Because Save re-scores the invoice (it goes through `handleUpsertInvoice`), correcting the
invoice number updates the colour straight away.

**Advisory only, like the rest of the screen's verdict.** `duplicateVerdict` is added by
the two screen routes, not inside `validateInvoiceFacts`, so stage visits, rules and the
recorded verdict are unchanged. A rule on `invoice.duplicate_confidence` is still how a
duplicate stops an invoice.

## Tests

- vf-app `duplicate-check.test.ts` (3): the verdict at, below and above the bar and
  unscored; a first invoice confirmed; a second with the same number from the same supplier
  warned.
- vf-ui `viewer.test.ts`: the invoice number green with its hover text.
- vf-licence: the 2 keys in string coverage.
