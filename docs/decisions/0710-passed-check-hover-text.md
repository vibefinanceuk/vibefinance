# 0710: A passed check says what passed on hover

**Status: live** at `6e414d2`, pushed and deployed 10 October 2026, migrations applied. vf-ui (`viewer.js`); vf-licence migration
`0319_passed_check_strings.sql`.

## What was asked

Dan, 10 October 2026, on INV-16356 at AP Review, with screenshots:

> I've noticed that when I hover over any header fields, and line fields - even when they
> match perfectly, the hover text reports an error.

Hovering the green Purchase order field read *"Does not match the purchase order"*; the
green Due date read *"Due date is before the issue date"*.

## Why

`markFields()` (0400) marks a field a check passed (`confirms`) green, and set its hover
text to `check.<name>`: the label written for the check's **failure**. One string was
serving both outcomes.

## What changed

A passed check's hover text is `check.<name>.ok`, falling back to `check.ok` ("Checked")
for a check with no wording of its own. A failure still says `check.<name>`, unchanged.

| Check | Passed, on hover |
| --- | --- |
| `vat_arithmetic` | Net plus VAT equals the total |
| `amount_due_mismatch` | Amount due agrees with the total |
| `date_order` | Due date is on or after the issue date |
| `line_sum` | Lines add up to the total |
| `po_mismatch` | Matches the purchase order |
| `code_list` | A code the standard recognises |

These are the six checks `validation.ts` confirms. The same text shows on line-table
cells, which are marked by the same code.

## Tests

vf-ui `viewer.test.ts`: a passed `vat_arithmetic` says its own wording; a passed check
with none says "Checked". vf-licence: the 7 keys in string coverage.
