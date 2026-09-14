# 0320 — Roles is instance-administrator standing, not delegable

**Status: built.** A correction to decision 0319, caught before it
caused a real problem rather than after.

---

## What was asked

> I think the roles menu item is at parent level permission, i.e.
> instance administrator, because is permits the setup and
> configuration of the Org hierarchy.

Checked against the codebase rather than taken on faith, and it held
up precisely. `Admin.Configure` already gates `/org/units` on exactly
this reasoning, and already gates Sources in the nav — the app's own,
established "instance administrator" permission. It is never scoped
or delegated anywhere: no route ever calls `unitsWherePermitted` or
passes `granterUnits` for it.

`Admin.UserManagement`, what decision 0319 used instead, is the
opposite kind of thing on purpose. Decision 0201 made it delegable — a
person can hold it scoped to one unit and grant roles only within it.
The Roles screen shows every unit and person in the org at once,
which is not something a scoped grant of `Admin.UserManagement` was
ever meant to unlock; a France administrator holding it only in France
would have opened a screen built to show the whole org and seen none
of the rest of it.

## What was built

The route (`GET /org/overview`) and the nav gate both moved from
`Admin.UserManagement` to `Admin.Configure`. Five existing frontend
tests updated to match — each had hard-coded the nav's own screen
list or permission-to-label mapping, and Roles sharing `Admin.Configure`
with Sources broke the assumption that one permission unlocks exactly
one item. Not a bug in the assumption generally; genuinely the first
time two screens have shared one permission, so the test needed a real
shape change, not a patched constant.

## What has coverage

The six backend tests written for `handleGetOrgOverview` call the
function directly and were unaffected — the permission check lives in
`index.ts`'s own route handler, not the function itself. All still
pass. Five frontend tests updated and reverified: the flat nav lists
seven screens now, not six; every real nav item still gets an icon;
`Admin.Configure` held alone unlocks Sources and Roles together, not
Sources alone; a person missing `Admin.RuleManagement` still sees
Roles alongside everything else `Admin.Configure` unlocks.

vf-app: 1513 tests, unchanged. vf-ui: 49 Worker, 423 browser (five
updated in place rather than added). No migration.

## What is not built, and this matters

**The write-side gaps decision 0319 already named remain open** —
setting an approval limit still has no permission check, and there is
still no way to revoke a role once granted. Separately found in this
same investigation: `POST /org/units` itself has no permission check
either, the same shape of gap as the authority-limits one.
