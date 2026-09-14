# 0321 — Scoped visibility for a delegated administrator

**Status: built.** The gap decision 0201 itself named, still open
after decisions 0319 and 0320.

---

## What was asked

> What would be logical next step for the read-only part?

Investigated rather than listed options from memory. Decision 0201's
own closing notes already named this exact gap: *"No screen. Roles
are granted by `POST`, and 'AP Manager (France)' is a pairing nobody
can see listed."* Decision 0319 closed that only for an instance
administrator; decision 0320's own correction — moving the screen to
`Admin.Configure` — meant a delegated administrator, the person
decision 0201 was specifically written for, still could not see the
screen at all. They could grant a role in France by raw API call and
have no way to see what they had granted, or what anyone else
administering France already held, without reading the database
directly — the exact problem this whole screen exists to solve, just
unreachable by the person it matters most to.

Confirmed with the operator before building: extend the same
read-only view to delegated administrators, scoped to what they
administer, rather than a separate screen or a new concept.

## What was built

**`handleGetOrgOverview` takes an optional scope** — `null` for no
restriction (an instance administrator, or someone holding
`Admin.UserManagement` unscoped), or a list of unit ids for a
delegated one. The filtering mirrors `handleAssignRole`'s own
delegation logic exactly rather than inventing a second rule for the
same boundary: an assignment is visible only where its own `unitId`
is one of the units passed in, and an unscoped ("everywhere")
assignment is never included — the same shape as that route's
existing `cannot_grant_everywhere` refusal. A person is in scope by
either door: holding a scoped assignment, or having their own home
unit within it, so a delegated administrator can see a colleague
nobody has assigned a role to yet.

**Roles themselves are never scoped.** A role's own name and the
permissions it grants are a global definition, not a fact about any
person or org — showing "AP Manager: AP.Approve, AP.Review" to a
delegated administrator reveals nothing about who holds it or where.

**The route itself now accepts either standing.** `Admin.Configure`
sees everything; failing that, `Admin.UserManagement` computes the
person's own administered units via `unitsWherePermitted` — the same
function `handleAssignRole` already uses for the identical purpose —
and passes that as the scope. Holding neither is the only real
refusal.

**A gap in the nav gate, found before it would have made the backend
work invisible.** The backend fix alone would have done nothing: the
nav's own permission check only tested for `Admin.Configure`, so a
delegated administrator would never see the "Roles" item at all,
regardless of what the route now permits. `NAV_PERMISSIONS.roles` now
names either permission, and the nav's own filter checks whether any
one of them is held — the first screen in this app unlocked by more
than one permission, so the filter itself needed a real shape change,
not a second hard-coded case.

## What has coverage

Seven new backend tests: units narrow to the scoped list; an
assignment at a scoped unit is visible and an unscoped one is not,
mirroring the write-side refusal directly; a person whose own home
unit is in scope appears even unassigned; a person entirely outside
the scope does not appear at all; role definitions are never
filtered, even for a role held only outside the scope; an
out-of-scope person's own approval limit is never returned, not just
hidden by the frontend; nothing is passed shows the full, unscoped
picture, confirming the instance-administrator path is unchanged.
Two probed directly — removing the assignment filter and removing the
authority-limit filter — each fails exactly the test written to catch
it.

One new frontend test: a person holding only `Admin.UserManagement`,
no `Admin.Configure`, still sees the Roles nav item. Probed directly
by reverting the nav gate to a single permission — the test correctly
fails.

vf-app: 1520 tests (was 1513). vf-ui: 49 Worker, 424 browser (was
423). No migration.

## What is not built, and this matters

**Still read-only.** A delegated administrator can now see their own
slice of who holds what, but nothing on the screen lets them act on
it — granting, revoking, or setting a limit all remain raw API calls,
the same as for an instance administrator.

**The write-side gaps named in decisions 0319 and 0320 remain open**
— no permission check on setting an approval limit, none on creating
an org unit, and no way to revoke a role once granted.
