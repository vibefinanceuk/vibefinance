# 0663: The Goods Receipts screen's actions, as an icon with its word

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026, after 0662:

> Please can you do the same to the Goods Receipt screen, and adjust the
> Upload Receipts, Record a return and Record a receipt buttons.

## What was built

The screen's own card actions use `compactLink` (0662): a 16px icon with
its word to the right, in a row.

| Card | Action | Icon |
| --- | --- | --- |
| Load receipts | **Upload receipts** | `load`, as before |
| Load receipts | **Set up Warehouse Receipts** (Admin.Configure, while it is not set up) | `addcard`, as before |
| Receipts and returns | **Record a return** | `return`: goods going back, in place of the shared `create` |
| Receipts and returns | **Record a receipt** | `goodsreceipts` (the menu's package with a tick): goods coming in, in place of `create` |
| Record form | **Find** an order | `search`, as before |

Record a return and Record a receipt no longer share an icon.

**The receipt pop-out's actions keep their larger, stacked form**, as
the invoice viewer's top bar does (0662). These are Register, Reject
receipt, Claim, Release, Cancel receipt and Close.

## Verification

- **`vf-ui`** browser `goods-receipts.test.ts`:
  - Upload receipts, Record a return and Record a receipt are each a
    `compactlink` beginning with its icon;
  - the two Record icons differ.
- **Screenshots** of the screen, with the process set up and without
  (showing Set up Warehouse Receipts), in Day and Night.
- **Full run**: vf-ui browser 1612, of which 1611 pass (the known
  `typography.test.ts` 10px gap).
