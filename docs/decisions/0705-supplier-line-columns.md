# 0705: A supplier's line table is learned, and its quantity, unit price and VAT rate are read

**Status: built**, not yet pushed. vf-app `supplier-layouts.ts` (`learnColumns`,
`supplierColumns`), `field-regions.ts`, `layout-hints.ts`, `extraction.ts`,
`intake-capture-route.ts`; vf-ui; vf-licence migration `0316_line_columns_strings.sql`.
No vf-app migration: line places use 0701's table.

## What was asked

Step 4 of `docs/design/supplier-layout-learning.md`, as proposed on 9 October 2026 and
agreed by Dan: *"yes please - go ahead with 4"*. The proposal:

1. record where line values are, as header values are (0701);
2. learn each supplier's columns from that: where each is across the page, and its
   heading;
3. ask for quantity, unit price and VAT rate **only** for suppliers whose columns are
   learned, with the headings as hints. Asking every reading for them is what made
   scans time out in 0686.

## 1. Where line values are

The same table and route as 0701, with the field named by line and column:
`line.3.BT-129`. Recorded for the columns a table is learned from: quantity (BT-129),
line amount (BT-131), unit price (BT-146), VAT rate (BT-152) and the item's name
(BT-153). Any other line field is refused.

- **Found**: a line cell clicked whose value is found **on its own row**, beside the
  line's description (0697 finds it there), counts as no doubt.
- **Boxed in**: a value boxed into a line cell.
- **Labelled by its column's heading**, not the words beside it: `columnHeading` goes
  up from the value to the first line that reads like a heading row (three or more
  words, none an amount) with a word over the value's column.
- **Current** while the value is still that line's (compared with `invoice_lines`).
- A line's place is never a header field's: header layouts (0702) and the Timeline
  line (0701) read header fields only.

## 2. Learning the columns

`learnColumns`: only **across** matters, since a column is a band down the page.

- **One vote per invoice per column**: the middle of its rows, at the strongest
  weight it gave. A twenty-line invoice does not outvote nineteen one-line ones.
- Columns agree within 4% of the page across, with the same heading where both have
  one; learned at the same threshold as a header field (three invoices, or one
  correction), with more agreement than disagreement.
- From the supplier's recent invoices, since its learning was last forgotten (0702's
  Forget forgets columns too).

## 3. Reading them

When the supplier is known before reading (0703, from the sender) and its table has a
learned quantity, unit price or VAT rate column:

- the **lines reading** (0688) asks for those columns too, each in its schema as a
  nullable number and required like the others, and the prompt says which heading
  each is under;
- its answer is allowed 400 more tokens per column asked (the row is longer);
- the **text reading** of a PDF with text asks for them the same way;
- each column read goes into its field on the line (`BT-129`, `BT-146`, `BT-152`). A
  column that cannot be read is left out; it **never discards the row**, unlike an
  unreadable amount (0685).

Suppliers whose table is not learned are read exactly as before: item name and amount.
`intake.layoutHint` now also names the line columns asked for
(*"…: no header fields; line columns BT-129"*).

## The supplier's page

The learning section names the columns known: *"Line columns known: Quantity
("menge"), Unit price ("einzelpreis")"*, and offers Forget even when only columns are
learned.

## Not done here

- The viewer's "usually here" (0702) is for header fields; a line column's band is not
  outlined yet.
- VAT category (BT-151) and unit of measure (BT-130) are not learned or asked for.

## Also in this change: 0704's interface tests

0704's record lists `suppliers.test.ts` checks that were not in fact committed with
it (the command that added them did not run). They are added here, with this
decision's own: the section's layouts, fields, both comparisons and Forget; nothing
learned still showing the keying figure; and the columns with their headings.

## Checked

- `line-columns.test.ts` (12): a column learned from three invoices, each counted once
  however many lines; from one correction; ordered across the page; two headings not
  one column; disagreement leaves it out; schema and prompt carry only the columns
  asked; the text reading's schema too; columns read into their fields, an unreadable
  one not losing the row; only quantity, unit price and VAT rate asked; a line region
  recorded and current against its line; an unknown line field refused; columns
  learned apart from the header layout and the Timeline; end to end through
  `handleCaptureFromSource`: the lines reading asked for the quantity under "menge",
  and the line stored with it.
- `doc-words.test.ts`: a column heading found past rows of numbers; none without a
  heading row.
- `lasso.test.ts`: a line value found on its row recorded under its column's heading; a
  value boxed into a line cell recorded likewise; a line field not learned from is
  not recorded.
- `suppliers.test.ts`: as above.
