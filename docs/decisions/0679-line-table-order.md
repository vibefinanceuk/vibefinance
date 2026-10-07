# 0679: The invoice lines in reading order, without coding columns

**Status: live** at `e97b1d5`, pushed and deployed 7 October 2026. It is
`vf-ui` only, with no migration.

## What was asked

Dan, 7 October 2026, with a screenshot of *Invoice lines*:

> Next could we change the order of fields on the line items to make
> more sense. I think it would be better to order as - Line no., Item
> Name, Description, Unit, Item Price, Quantity, Line net amount, VAT
> Category. I don't think we need cost centre as that appears on the
> coding line? Can we also reduce the width of the Quantity field.
> Finally - is there a line total price, or any other line item fields
> that might be displayed?

## What was built

### Column order (vf-ui `viewer.js`, `lineTableFields()`)

The columns now follow a fixed order (`LINE_TABLE_ORDER`), rather than
the order the field-visibility API returns:

1. Line no. (BT-126)
2. Item name (BT-153)
3. Description (BT-154)
4. Unit (BT-130)
5. Item net price (BT-146)
6. Quantity (BT-129)
7. Line net amount (BT-131)
8. VAT category (BT-151)

VAT rate (BT-152), if a stage shows it, comes next. A field not named
(a customer's own) sorts after these.

### No coding columns

**Cost centre (BT-133) is no longer a column**, and nor are project,
commodity code or GL code, should a stage show them. All four are
chosen in the line's Coding pop-out, which already shows them.

They stay in `lineFields`, so these still see them:

- the Coding pop-out;
- the "is this line coded" check (0541);
- Save.

A check about one of them, other than account coding (which already
marked the Coding button, 0511), now marks the line's Coding button
too, since there is no cell to mark. It can be a warning (amber, new)
or danger.

### Widths

**Column widths are set by field, not position** (`th.lf-<field>`). The
old rule widened "the fourth column", which was the unit only in the
old order. Now:

- Quantity: 6em;
- Unit: 9em;
- VAT category: 11em;
- VAT rate: 6em;
- money columns: 8.5em (0677);
- Item name and Description share the rest.

### Dan's question: a line total, or other line fields

**There is no line total with VAT.** EN 16931 gives a line its net
amount (BT-131), its VAT category (BT-151) and rate (BT-152), but no
VAT amount or gross total. VAT is totalled per category for the invoice
as a whole. A *Line total incl. VAT* could be shown, worked out as net ×
(1 + rate). It would be a calculated figure, right only where the line
carries its rate.

**Other line fields the system already holds**, which a stage can show
through field visibility:

- *Line note* (BT-127);
- *Order line* (BT-132), the purchase order line it refers to;
- *VAT rate* (BT-152).

EN 16931 has more line data that the system does not read yet, for
example:

- the seller's and buyer's item identifiers (BT-155, BT-156);
- the invoicing period (BT-134, BT-135);
- line allowances and charges (BG-27, BG-28);
- the gross price before discount (BT-148).

## Verification

- **`vf-ui`** browser `viewer.test.ts`:
  - gains 1 test: given the fields out of order, with a cost centre and
    a GL code, the header columns are the eight in Dan's order with no
    coding column, Quantity is 6em, and no positional width rule
    remains;
  - updates 2: the marked-cell test now finds Line net amount after
    Quantity, and a split line no longer has "Split" cells, since its
    coding is not in the table.
  - 304 of 304 pass.
- **Screenshots** of the line table in Day and Night.
- **Full run**: vf-ui browser 1646, of which 1645 pass (the known
  `typography.test.ts` 10px gap).
