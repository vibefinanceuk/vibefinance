# 0329 — A popout's own icons, relocated and completed

**Status: built. Superseded in part by decision 0330.** This
record's own close-icon relocation is correct and current. Its
choice to leave Save/Create/Assign as a separate, bottom-of-form
button was wrong — the operator's own follow-up wanted that action
beside Close, both top right, matching the supplier popout's own
established shape (decision 0306). Read 0330 for the corrected
layout.

---

## What was asked

> In the edit role and edit person pop-out, please can you review the
> icons, and relocate to the top right of the pop-out box. I think
> Assign and Save buttons need icons

## What was found

The close icon already existed, but sitting beside the primary button
at the bottom of the popout, via `actionLink("close", ...)` — every
popout this session built followed that same shape without
questioning it. A better version of exactly this pattern already
existed elsewhere in the app: the org switcher's own popout
(`orgs.js`) already puts its close icon in a `.cardhead` — title
left, an icon-only button right, `title` carrying the tooltip rather
than a visible label. Reused rather than reinvented, so every popout
in the app now closes the same way.

The primary buttons (Create, Save, Assign, Done) had never carried an
icon at all — `el()`'s own `text` prop sets `textContent`, which
would silently overwrite an icon appended as a child, the same
reason `actionLink` builds its own button by hand rather than through
that prop.

## What was built

Two small, shared helpers — `popoutHeader()` (title plus a top-right
close icon, `.cardhead`) and `primaryButton()` (an icon plus text,
never `text` alone) — applied consistently across all three popouts,
not only the two named:

- **Role popout** (create/edit, decision 0326): `save` for Save — an
  exact semantic match, already designed for this. `complete` (a
  checkmark) for Create.
- **Assignments popout** (decision 0327): `complete` for Assign.
- **New-person popout** (decision 0328): `complete` for Create, and
  the one-time key view's own `Done` button, for the same reason —
  all four are, underneath the specific verb, the same "confirm this"
  role a form's primary button always plays.

## What has coverage

4 new browser tests confirming the icon actually sits in the header
rather than beside the primary button, and that each primary button
carries one. Probed directly: reverting the header helper to a plain
title, and removing the icon from the primary-button helper, each
failed exactly the tests built to catch them. One pre-existing test
("closes without saving anything") queried for a button by its own
visible "Close" text — no longer true once the icon lost its label —
fixed to query the new structure directly rather than loosened.

`vf-ui`: 56 Worker (unchanged), 458 browser (was 454). No backend
change; nothing in `vf-app` touched or re-run.
