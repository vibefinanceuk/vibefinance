# 0680: The line table's Description column back after Item name

**Status: live** at `8ccf2ea`, pushed and deployed 8 October 2026 (with
0681). It is `vf-ui` only, with no migration.

## What was asked

Dan, 7 October 2026, with a screenshot after 0679 was deployed:

> That's odd - Description seems to be in the wrong place? Can you
> confirm the changes made correctly?

His screenshot showed *Description* last, after VAT category, rather
than after Item name.

## Why

**The *Description* column is not BT-154 (*Item description*).**

- It is its own field, `description`. It is read-only and
  display-only (decision 0171, label from vf-licence `0045`), and it
  holds the description a scanned or photographed invoice's line was
  read with (`extraction.ts`).
- The resolver gives it to every line table (`field-visibility-
  route.ts`).
- 0679's `LINE_TABLE_ORDER` named BT-154 for "Description", and not
  `description`. Any field not named sorts last, so this one did.
- It shows "—" on an e-invoice (XML), whose lines are not read from an
  image.

## What was built

- **`LINE_TABLE_ORDER`** (vf-ui `viewer.js`) names `description` after
  Item name, then BT-154 should a stage show it:
  1. Line no.
  2. Item name
  3. Description
  4. Item description (if shown)
  5. Unit
  6. Item net price
  7. Quantity
  8. Line net amount
  9. VAT category
- **VAT category is 12.5em wide**, up from 11em, so "S · Standard rate"
  is not cut off (`th.lf-bt-151`).

## Verification

- **`vf-ui`** browser `viewer.test.ts`: the order test now includes the
  read-only `description` field and expects it third, after Item name.
  304 of 304 pass.
- **Screenshots** of the line table with Dan's fields, in Day and Night.
- **Full run**: vf-ui browser 1646, of which 1645 pass (the known
  `typography.test.ts` 10px gap).
