# 0667: Access Control's actions, as an icon with its word

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026:

> On the Access Control screen, please can you alter in the same way,
> the buttons - New org, New role, New person, New team. Also in the
> People tab in the same screen alter the buttons entitled - Roles,
> Properties, Invite and Invite again. All should be the smaller icon
> with text to the right. In the Teams tab, when I select a row it
> launches the Team details. Please can you change the Remove and Add
> buttons to include a small icon, and text to the right.

## What was built

These are now `compactLink`s (0662, vf-ui `access.js`): a 16px icon with
its word to the right, softer at rest and brighter on hover (0664).

| Where | Actions | Icon |
| --- | --- | --- |
| Each tab's head | New org, New role (and the ready-made *Add the AP Receiving role* beside it), New person, New team | their own, as before |
| People, per person | Roles, Properties | `roles`, `properties` |
| People, Signing in | Invite, Invite again | `post` |
| Team details | **Remove** a member | `discard` |
| Team details | **Add** a member | `newperson` |

- **A person's roles form gets the same Remove.** Its Remove, beside each
  role a person holds, was the same plain button as a team's, so it now
  matches.
- **Unchanged:** the pop-outs' own Save, Create, Assign and Close keep
  their larger, stacked form.

## Verification

- **`vf-ui`** browser `access.test.ts`, existing tests extended:
  - New org and New person are compact;
  - **People tab:**
    - each person's Roles and Properties are compact;
    - Invite and Invite again are compact;
  - **Team details:** Add and Remove are compact, each beginning with
    its icon.
  - All 99 pass.
- **Screenshots** of the People tab and of a team's details, in Day and
  Night.
- **Full run**: vf-ui browser 1616, of which 1615 pass (the known
  `typography.test.ts` 10px gap).
