# 0670: Approval Hierarchy's two override cards, side by side, Add and Remove compact

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026:

> On the AP Setup screen, under the Approval hierarchy tab, please can
> you change the Add button, in the Supervisor Overrides and Approval
> Limit Overrides cards, to be small with text to the right. Please can
> you also change these cards to be 50% width and sit side by side?

## What was built

vf-ui `ap-setup.js` and `app.css`:

- **Add is a `compactLink`** (0662) in both cards: the `addcard` plus,
  as the coding lists' Add has had since 0669, softer at rest and
  brighter on hover (0664). It was a large `create` action link.
- **The two cards sit side by side** in `.overridepair`, half the width
  each: Supervisor overrides on the left, Approval limit overrides on
  the right.
  - The grid spaces them, so their own bottom margin goes (0179).
  - They stretch to the taller one's height, so their borders line up.
  - Below 900px wide they stack again, one above the other.
- **Ids**, for the tests: `supervisoroverrides` and `limitoverrides`.
- **Each row's Remove is a `compactLink`** too, with the `discard`
  icon, as a team's Remove has had since 0667. Dan asked for it while
  this was being built: *"The remove button needs an icon also in with
  text to the right."*
- **Unchanged:** what Add and Remove do, the search, and the list's
  cap.

## Verification

- **`vf-ui`** browser `ap-setup.test.ts` gains 3 tests:
  - the two cards are, in that order, the children of `.overridepair`,
    each with a compact Add beginning with its icon;
  - the stylesheet gives `.overridepair` two equal columns, and one
    below 900px;
  - each row's Remove, in both cards, is compact and begins with its
    icon.
  - All 84 pass.
- **Screenshots** of the two cards in Day and Night.
- **Full run**: vf-ui browser 1619, of which 1618 pass (the known
  `typography.test.ts` 10px gap). Remove was made compact after it and
  `ap-setup.test.ts` was run again: 84 of 84.
