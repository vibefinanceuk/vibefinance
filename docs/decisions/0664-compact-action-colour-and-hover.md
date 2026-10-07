# 0664: Compact actions rest in one colour and brighten on hover

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was reported

Dan, 7 October 2026, after 0663:

> Some buttons, for example Upload Receipts and Record a receipt seem to
> have a lighter font. When hovered over, there is no change. However, if
> you look at the Record a return button, the unhovered button has a
> softer text colour, and brightens when hovered over. Can you diagnose
> why this would occur?

## Why it happened

The behaviour comes from **`primary`**, which those two buttons carry:

- **Every action link rests** in `--text-secondary`, the softer colour.
- **Hover** sets `--text-primary`, the bright one
  (`.actionlink:hover:not(:disabled)`).
- **A primary action** (decision 0108: one dominant action per place)
  **rests in `--text-primary` already** (`.actionlink.primary`), with a
  bolder icon.

On these screens Upload receipts and Record a receipt are primary, and
Record a return is not:

- **A primary one** is already bright at rest. In Night that reads as
  lighter text, and hovering moves it to the colour it already has, so
  nothing visibly changes. Only the faint hover background does.
- **Record a return** starts soft and brightens, which is the response a
  person expects.

So the difference is not the font. It is the primary emphasis meeting
the hover rule.

## What was built

For compact actions (`compactLink`, 0662–0663):

- **Every compact action rests in `--text-secondary`**, primary or not
  (`.actionlink.compactlink.primary`), and brightens to `--text-primary`
  on hover.
- **The primary action is still told apart, by its bolder icon**
  (`.actionlink.primary svg`, decision 0108, unchanged).

This covers:

- **The Goods Receipts screen:** Upload receipts, Set up Warehouse
  Receipts, Record a return, Record a receipt and Find.
- **The invoice viewer's card actions.**

**Left as they were:**

- **The larger, stacked actions** (the viewer's top bar, the receipt
  pop-out) still rest bright when primary. Each place has one of them,
  and it is meant to stand out.
- **The Agents screen's header**, where New agent is primary.

Both can be given the same rule if Dan wants it everywhere.

## Verification

- **`vf-ui`** browser `goods-receipts.test.ts`:
  - the stylesheet rests a compact primary in `--text-secondary` and
    brightens every compact action on hover;
  - Upload receipts is `actionlink primary compactlink`.
- **Screenshots** of the Goods Receipts screen in Night, at rest and
  with Upload receipts hovered.
- **Full run**: vf-ui browser 1613, of which 1612 pass (the known
  `typography.test.ts` 10px gap).
