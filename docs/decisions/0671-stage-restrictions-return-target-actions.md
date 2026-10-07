# 0671: Stage Restrictions — Add and Remove as an icon with its word, and the toggles aligned

**Status: live** at `e6149fb`, pushed and deployed 7 October 2026. It is
`vf-ui` only, with no migration.

## What was asked

Dan, 7 October 2026:

> In the Stage Restrictions tab on the AP Setup screen, could you update
> the Add button on each card so that it is smaller, and with text to
> the right. Move the icon to the right of the sentence "No return
> targets configured for this stage yet.". Also, please can you update
> the Remove button, to have an icon and text to the right.

And while it was being built:

> When the stage restrictions cards are unchecked for "Offer Account
> Coding restrictions for this stage" the three sentences with check
> boxes are not aligned, and the check boxes appear at the end of the
> sentence. When I select the check box … the fields appear aligned,
> and with horizontal lines between. Could we keep the alignment and
> horizontal lines in both cases.

## What was built

Each stage card's Return targets (vf-ui `ap-setup.js`, `app.css`):

- **Add is a `compactLink`** with the `addcard` plus (as 0669 and 0670),
  softer at rest and brighter on hover (0664). It was a large `create`
  action link on a line of its own under the sentence.
- **Where Add sits** (`.returntargetadd`):
  - with no targets yet, on the right of "No return targets configured
    for this stage yet.", on the same line;
  - once a stage has targets, the sentence is gone, and Add sits on the
    right under the rows' Remove.
- **Each target's Remove is a `compactLink`** with the `discard` icon,
  as Access Control's and the override cards' Remove (0667, 0670).
- **Unchanged:** Add opens the same picker (0507), and is still only
  offered when there is another stage and a team. The picker's own Add
  and Close keep their larger form.

### The three toggles, the same in every card

*Offer Account Coding restrictions*, *Recheck the rule* and *Allow
Discard* are now the same full-width rows in every stage card (in
`.stagetoggles`): sentence on the left, checkbox on the right, a line
under each.

- **Before**, a stage not offering restrictions (`.stageslim`, 0507)
  wrapped them beside its explanation, each checkbox at the end of its
  sentence.
- **The explanation** ("Not configurable here …") now sits above them,
  as the field chips do in a stage that offers restrictions.
- **`.stageslim`'s tighter padding is gone**, so the two kinds of card
  match. The class stays, still marking which stages these are.
- **The last row keeps its line**, setting the toggles apart from
  Return targets below.

## Verification

- **`vf-ui`** browser `ap-setup.test.ts` gains 3 tests and changes 2:
  - with no targets, the row holds the sentence first and a compact Add,
    beginning with its icon, after it;
  - with a target, its Remove is compact with its icon, the sentence is
    not shown, and Add is compact under the rows;
  - a stage offering restrictions has the same three `.assignmentrow`
    toggles in `.stagetoggles`;
  - changed: a stage not offering them has its toggles as three rows,
    checkbox last, after the explanation; and the stylesheet no longer
    has `.stageslimtoggles`.
  - The existing return-target tests (open the picker, add, remove)
    pass unchanged: 87 of 87.
- **Screenshots** of the tab in Day and Night: two stages with no
  targets and not offering restrictions, and one offering them, with a
  target.
- **Full run**: vf-ui browser 1623, of which 1622 pass (the known
  `typography.test.ts` 10px gap).
