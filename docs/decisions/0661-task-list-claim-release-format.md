# 0661: Claim and Release in the task list, as an icon with its word

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026, with a screenshot of the Agents screen's header
actions (Everyone's agents, Ready-made, New agent):

> In the Tasks UI, please can you update the claim and release buttons
> in the table of tasks. I like the format exhibited in the Agents
> window. There is a small icon and text to the right.

## What was built

The task list's **Claim** and **Release** (the only actions the list
offers, 0523) are now drawn as the Agents screen draws its header
actions:

- each is an `actionlink`, with its 16px icon on the left and its word
  on the right;
- the icons are the `claim` and `release` ones, as in the viewer and the
  receipt pop-out (0659);
- they sit in a `.dobuttons` row, as on the Agents screen.

**What stays the same:**

- The buttons keep their `act` class, so everything that finds them
  still does.
- Clicking one still claims or releases without opening the row.
- `.taskactions` drops the old button's minimum height and margin, and
  keeps the small text size.

## Verification

- **`vf-ui`** browser `tasks.test.ts`: Claim is an `actionlink`, its
  first child is the icon, and it sits in a `.dobuttons` row. The
  existing tests that read the list's labels pass unchanged.
- **Screenshots** of the task list with a Release and two Claims, in Day
  and Night.
- **Full run**: vf-ui browser 1610, of which 1609 pass (the known
  `typography.test.ts` 10px gap). vf-app, vf-licence and the vf-ui worker
  are unchanged by this decision.
