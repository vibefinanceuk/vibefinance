# 0735: The line table keeps to its card: long text on a second row, and scrolling inside

**Status: live** at `181d174`, pushed and deployed 12 October 2026. vf-ui (`viewer.js`, `app.css`); vf-portal's copy of
`app.css`.

## What was asked

Dan, 12 October 2026, against a screenshot of Invoice lines with his columns chosen (0734):
*"there is overlapping and fields cannot be read. This also spill over the boundaries of the
card. Should we wrap across a second row?"*, then *"or permit scrolling to the right?"*. The
mock-up of both together: *"looks good"*.

## Why it happened

The table is `table-layout: fixed`. Every chosen column has a fixed width; Item name had none,
so it took what was left, which with Item description, VAT rate, Order line, Line note and Line
total with VAT chosen was almost nothing, and the Coding column went past the card's edge.

## What changed

- **Item description and Line note on a second row** under each line, starting under Item
  name, each with its own small label, when either is chosen. The first row keeps the short
  fields and amounts in line.
- **Item name has a width of its own** (16em); VAT category is narrower (9em).
- **Never wider than the card:** the table sits in a box that scrolls sideways only when more
  columns are chosen than fit; nothing overlaps and nothing spills.
- A line's checks still mark the right place: a first-row cell, or the field on its second row.

## Tests

vf-ui `viewer.test.ts`: Item description on the second row, labelled, with the value; the
second row spans the first row's columns; the table inside its scrolling box. Checked in
Chromium at 1700 and 1280 pixels wide, Day and Night.

## To deploy

Deploy vf-ui and vf-portal (its copy of the stylesheet). No migrations.

## Afterwards: read-only values as tall as the inputs beside them

Dan, once deployed: *"give the line note field equal height as the line description"*. Line
note (read-only by default) drew as the shorter read-only box beside the Item description
input; Order line did the same among the first row's inputs. A read-only value in the line
table is now the inputs' height, its text centred. Deploy vf-ui and vf-portal.
