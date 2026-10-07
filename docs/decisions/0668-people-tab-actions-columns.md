# 0668: The People tab's actions, after Signing in, one column each

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026, after 0667:

> You can also see the Not invited, Invitation cancelled, text under the
> Signing In column. I would like all button / actions to appear to the
> right of that, Roles, Properties and the Invite / Reinvite button.

And then:

> Give each button a column so they are aligned.

## What was built

The People tab's rows (vf-ui `access.js`, `personRow`):

- **The order of the columns** is Person, Roles held, Approval limits,
  Signing in, then **Roles**, **Properties** and **Invite / Invite
  again**, each in a column of its own (`td.personaction`).
- **Before**, Roles sat beside Roles held, Properties beside Approval
  limits, and Invite inside the Signing in cell, under its words.
- **The cells hold their buttons tight** (`width: 1%`, no wrapping), so
  each button lines up with the one above it.
- **No button in a row:** someone who can already sign in has no Invite,
  and their Invite cell stays empty, so the columns still line up.
- **The Signing in cell holds only the words and the note** that says
  whether an invitation went (`invitation()` returns the words' cell and
  the button apart).
- **The header** has a column for each, the three action columns
  without titles.
- **Without Admin.UserManagement**, none of the four last columns is
  shown, as before.

## Verification

- **`vf-ui`** browser `access.test.ts`:
  - for each person, the Signing in cell holds no button;
  - it is followed by exactly three `personaction` cells, which for
    someone not yet invited read Roles, Properties and Invite;
  - Invite and Invite again are found in their own column and still
    send (the invite tests now click them there);
  - the header has as many columns as a row has cells.
  - All 99 pass.
- **Screenshots** of the People tab with someone who can sign in,
  someone invited and someone not, in Day and Night.
- **Full run**: vf-ui browser 1616, of which 1615 pass (the known
  `typography.test.ts` 10px gap).
