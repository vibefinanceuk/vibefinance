# 0337 — Roles and Properties, Split Back Into Two

**Status: built.** "For the People Grid, I would rather have an icon
in each row saying Roles (to the right of roles), and another saying
Properties (to the right of Approval Limits). Then split the manage
screen so that role allocation and property assignment are two
separate pop-out boxes. The current popout is not very user friendly
I think."

---

## What changed

Decision 0334 merged what had been `openAssignmentsForm` (decision
0327 — role assign/revoke) with a new properties, approval-limit, and
spend-limit editor into one combined pop-out, `openPersonForm`,
reached by clicking anywhere on a person's own row. That merge is
undone here, reported live as the reason: one pop-out holding a
person's own name, org, manager, cost centre, address, Budget Holder,
two separate limit editors, and role assignment all at once was too
much in one place.

**The row itself is no longer clickable.** Each of the two columns
that used to summarize what the popout held now carries its own,
explicit action instead — `actionLink`, the same icon-and-label
button every other write action on this screen already uses, dropped
directly into the cell: "Roles" beside what roles a person already
holds, "Properties" beside their own approval limit. Two new icons
— `roles` (the same shield `newrole` already uses, centered rather
than sharing space with a plus) and `properties` (a small ID card) —
so each action reads as what it does, not a generic edit pencil.

**Two functions where one stood, restoring the original split.**
`openPersonRolesForm` is `openAssignmentsForm` under a new name, with
its own header again: "Assign" moves back to primary-in-the-header,
undoing decision 0334's own note that moved it out when the pop-out
briefly held more than one purpose. `openPersonPropertiesForm` keeps
everything decision 0334 added — name, org, manager, cost centre,
address, Budget Holder, and both limit editors — with "Save" as its
own, unchanged primary action. Neither function lost anything the
other one already had; the split is purely which icon reaches which
one.

Both remain gated to `Admin.UserManagement` exactly as the combined
pop-out was — nothing about who may act on a person's own roles or
properties changed here, only how many pop-outs it takes to reach
them.

## What has coverage

The describe block covering the old, combined pop-out was split the
same way the UI was: one block for role allocation, one for
properties and limits, each now opening its own pop-out via its own
icon rather than a row click. Every test that existed before this
decision still exists, updated only in how it reaches the pop-out —
none of the underlying assertions about what gets posted, listed, or
shown changed. Two new tests confirm each action is absent entirely
without `Admin.UserManagement`, rather than merely inert. The Roles
icon's own presence was probed directly: removing it from the row
failed exactly the test built to catch it.

`vf-app`: unchanged (this was a frontend-only decision). `vf-ui`: 63
Worker (unchanged), 495 browser (was 493).
