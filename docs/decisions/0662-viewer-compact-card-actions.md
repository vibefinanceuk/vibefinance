# 0662: The invoice viewer's card actions, as an icon with its word; Add line top right

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026, after 0661:

> Can you make the same icon alterations in the Invoice viewer screen,
> specifically Change Seller, Change Buyer, Header Fields, Expand
> buttons. Also create an icon for the Add line button, and move it to
> the top right of the Invoice lines card.

## What was built

### `compactLink` (vf-ui `viewer.js`)

`compactLink` is `actionLink` with the class `compactlink`: a 16px icon
with its word to the right, in a row, as the Agents screen's actions and
the task list's Claim and Release (0661) are. It is used for each card's
own actions:

| Card | Actions |
| --- | --- |
| Seller | Change Seller, and New Seller beside it when the invoice names no PO, so the pair match |
| Buyer | Change Buyer |
| Invoice header | Header Fields (when there are more fields than the card shows) |
| Document | Expand |
| Invoice lines | **Add line** |

The task's own actions in the top bar (Save, Complete, Release, Back)
keep their larger, stacked form, as Dan's screenshot of the Agents
screen keeps for its top bar.

### Add line

- **It has an icon of its own**, `addline`: lines of a list with a plus.
- **It moved from under the table to the top right of the Invoice lines
  card**, in its head beside the title, as the other cards' actions sit.
  It has the id `addline`.
- **It still shows only to someone who may edit the invoice.** Lines
  total stays where it was, under the table.

## Verification

- **`vf-ui`** browser `viewer.test.ts`:
  - Change Seller and Expand are `compactlink`s, each beginning with its
    icon;
  - Add line is a `compactlink` in the Invoice lines card's head, and
    nothing is left in the foot;
  - clicking Add line adds a line.
- **Icons:** the existing "draws a glyph for every action on the page"
  test covers the new `addline` icon.
- **Screenshots** of the viewer, editable, in Day and Night.
- **Full run**: vf-ui browser 1611, of which 1610 pass (the known
  `typography.test.ts` 10px gap).
