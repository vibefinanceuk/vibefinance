# 0708: The line net amount is suggested from quantity × price, and a VAT-inclusive figure recognised

**Status: live** at `c8672d7`, pushed and deployed 9 October 2026. vf-ui (`line-calc.js`, the line table); vf-licence
migration `0317_line_net_suggestion_strings.sql`.

## What was asked

Dan, 9 October 2026, working INV-16356 (The Thornbury Deli):

> The line net amount is not displayed, only the line total amount inclusive of vat.
> This means the user needs to manually calculate the line total amount, less tax at
> 20% … How best to update the UI … 1. we could auto-calculate the line net amount
> from Item net price * quantity. Or 2. we could include a Line total amount field?

On that invoice the printed amounts were in fact already net (21 × 2.90 = 60.90; the
four lines sum to the 399.20 subtotal; the "20%" beside each is the rate). The question
stands for suppliers that do print a VAT-inclusive line figure. Recommended, and agreed
(*"please build the suggestion"*): option 1 as a **suggestion**, never a silent fill, with
option 2's purpose met by recognising a VAT-inclusive figure rather than adding a
non-standard column.

## What it does

Under each editable line's **Line net amount**:

| Situation | Shown |
| --- | --- |
| Empty, with a quantity and unit price | `= £60.90 (21 × 2.9)` · **Use** |
| Equal to quantity × price + VAT at the line's rate | `Includes 20% VAT: net £138.70` · **Use** |
| Different from both | `= £58.00 (20 × 2.9)` · **Use**, and the amount's box outlined amber |
| Equal to quantity × price, or no quantity or price | nothing |

- Quantity × unit price, divided by the price's base quantity (BT-149) where there is one.
- **Use** puts the figure in as if typed, so the line totals and Save see it the usual way.
- It is redrawn as soon as the quantity, price, rate or amount on that row changes.

## Why a suggestion, not a calculation

The net amount (BT-131) is what the invoice says. EN 16931 makes it quantity × price
less allowances plus charges, so on real invoices with a discount, a delivery charge or
a per-pack price the two differ, and the printed figure is the one that is right. A
filled-in figure would hide exactly the lines worth looking at; a suggestion with an
amber box draws the eye to them.

No line gross column: EN 16931 has no line total including VAT, so a stored one would be
non-standard and empty on most invoices. Recognising one when it is typed (or boxed in
from the page) covers the case.

## Checked

- `line-calc.test.ts`: quantity × price for an empty amount; nothing when they agree
  (numbers or text); a VAT-inclusive amount recognised with its net; a different amount
  flagged; the base quantity; nothing without both quantity and price.
- `viewer.test.ts`: the three rows of a table show the right suggestion or none; Use fills
  the amount and the suggestion goes; changing the quantity redraws it, amber.
