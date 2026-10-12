# 0734: Choose the invoice line columns

**Status: built**, awaiting deploy. vf-ui (`viewer.js`, `icons.js`, `app.css`), vf-app
(`field-visibility-route.ts`), vf-licence (strings migration 0336); vf-portal's copies of
`app.css` and `icons.js`.

## What was asked

Dan, 12 October 2026: *"How many invoice line fields are there stored in the system, and not
displayed in the UI? I wondered if it makes sense to provide a way to show more fields via tick
box in the top right of the lines table. Similar to the documents screen"*. Twelve EN 16931
line terms are read; the table showed seven; four were hidden by default (Item description,
VAT rate, PO line, Line note) and the matching verdicts had no column. The mock-up, with
*"item description, total line amount and tax rate"*: *"looks great"*.

## What changed

- **A column picker** at the top right of Invoice lines, beside Add line, as on Documents:
  *From the document* (every line field this person may see, in reading order, and **Line
  total with VAT**, worked out) and, on an invoice that names a PO, *Matching* (PO line found,
  Price matched, Price variance %, Quantity matched, Quantity variance %, Unit matches, Non-PO
  line). Remembered for the person in this browser; **Reset to standard**.
- **Standard:** the seven columns as before. Line ID, Item name and Line net amount cannot be
  turned off. A field the customer or a stage chose to show is a column until turned off.
- **Line total with VAT:** net plus VAT at the line's rate (the net where there is no rate),
  read-only, following what is keyed.
- **Field visibility still decides who may see what.** Item description and VAT rate are now
  editable by default, PO line and Line note read-only (they were hidden): offered in the
  picker, not columns until chosen. A customer can still hide any of them.

## Not in this

The receipt verdicts (Received, Receipt shortfall %, Credit expected): the line summary the
viewer has does not carry them yet.

## Tests

vf-ui `viewer.test.ts`: the standard seven, the twelve offered, the three always on; Item
description, VAT rate and Line total with VAT added (£73.08 on 60.90 at 20%) and remembered;
a customer-chosen field still a column. Checked in Chromium, Day and Night.

## To deploy

Migration: vf-licence `0336_line_columns_strings.sql`. Deploy vf-app, vf-licence, vf-ui (and
vf-portal, whose copies of the stylesheet and icons changed).
