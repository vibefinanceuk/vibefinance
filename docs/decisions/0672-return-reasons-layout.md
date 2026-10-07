# 0672: Return Reasons — AP team email first, the two lists side by side, Save compact

**Status: live** at `e6149fb`, pushed and deployed 7 October 2026. It is
`vf-ui` only, with no migration.

## What was asked

Dan, 7 October 2026:

> On the return reasons screen, in AP Setup, can we move the AP Team
> Email to the top of this tab section. Also, please make put the Return
> Reasons and Goods Return Reasons next to each other side-by-site, each
> occupying 50% of the available width. Please also change the save
> icons on this page, so that they are smaller, with text to the right,
> as done in previous sections.

## What was built

AP Setup's Return Reasons tab (vf-ui `ap-setup.js`, `returnReasonsTab`):

- **The AP team email card is first** (`#ap-team-email`). It used to sit
  between the two lists.
  - **Its Save moved to the card's head, top right**, as Matching's
    Save (0669). It sat beside the address in a two-column grid.
- **Return reasons and Goods return reasons sit side by side**, half the
  width each, in the same two-column row as Approval Hierarchy's
  overrides (`.overridepair`, 0670, here also `.reasonpair`). They are
  the same height, and stack below 900px.
  - The invoice list gains the id `return-reasons`.
- **Every Save is a `compactLink`** (`save` icon): the AP team email's,
  and each reason row's.
- **Each list's Add is a `compactLink`** too, with the `addcard` plus,
  so the rows' actions all match.
- **Unchanged:** what Save and Add send, the Active checkbox, and the
  "add a reason" row's fields.

## Verification

- **`vf-ui`** browser `ap-setup.test.ts` gains 1 test: the panels are,
  in order, the AP team email, Return reasons and Goods return reasons;
  the two lists are the children of `.reasonpair`; the email's Save is
  in its head; and all six Save and Add buttons (the email's Save,
  the Save on two invoice reasons and one goods reason, and each list's
  Add) are compact,
  each beginning with its icon. The existing Return Reasons tests pass
  unchanged: 88 of 88.
- **Screenshots** of the tab in Day and Night.
- **Full run**: vf-ui browser 1624, of which 1623 pass (the known
  `typography.test.ts` 10px gap).
