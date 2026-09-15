# 0333 — Access: tabs, a rename, and every team a real org

**Status: built.** Three separate, related pieces, each confirmed
before building rather than assumed: a screen renamed and
restructured into tabs; two of those tabs hidden from anyone but a
global administrator; and teams — built customer-wide only one
decision ago (0332) — given a real org of their own.

---

## The conversation this started from

A mockup, first: "are these sections one screen, or should they have
their own configuration?" Discussed rather than built immediately —
the case for one screen (a role assignment already names a person
*and* an org unit; splitting them would mean bouncing between
screens for one ordinary task) against the case for splitting (the
permissions genuinely differ per section; the screen will get long
the way permissions already needed a scrollbar past thirty items).
Landed on tabs within one screen, plus a new, more general side-menu
entry — "Roles" no longer named what the screen now held.

## The rename

"Roles" doesn't fit a screen holding org units, roles, people, and
teams. "Access" was chosen over "Organization" and "Setup" — it
matches the screen's own existing subtitle, *"who can do what,
where, and up to how much,"* rather than naming only one of the four
things it now holds. `Accessibility` was floated once and caught
before it was built: that word already has a strong, specific,
universal meaning in software (screen readers, contrast, keyboard
navigation) that has nothing to do with this screen.

Renamed structurally, not just relabelled: `roles.js` → `access.js`,
`roles.test.ts` → `access.test.ts`, the nav's own screen key
`roles` → `access` throughout `tasks.js` (routing, `NAV_PERMISSIONS`,
the `SCREENS` array), a new `nav.access` string (migration 0100).
`nav.roles` itself was left in place, unused rather than deleted —
an orphaned string is harmless; deleting rows in a migration isn't
this project's own pattern.

## Tabs

Four tabs — Org Units, Roles, People, Teams — replacing four
sections stacked on one long scroll. A real bug was found and fixed
building this, not before: the tab-correction logic first lived
inside `tabBar()`, which ran *after* the active section's own content
had already been computed from a stale `activeTab` in the same
function body. Caught by the simplest test in the file — the screen
not rendering its own subtitle at all on a first, permission-less
render — and fixed by moving the correction earlier, before the
active section is ever picked.

## Org Units and Roles, hidden from a global administrator only

Checked against the code directly before building anything, not
assumed: both tabs were already correctly scoped or non-sensitive for
a delegated administrator. Org units are genuinely filtered to only
what a delegated `Admin.UserManagement` holder administers — a France
scoped administrator cannot see Germany's own unit today. Role
*definitions* are never scoped at all, by design (0326's own
reasoning) — what a role grants isn't sensitive, only who holds it
is. Hidden anyway, at the operator's own confirmed choice, for a
simpler delegated-admin view rather than because either was unsafe.

Gated on `Admin.Configure` specifically — the permission that already
means "unscoped, instance-wide standing" everywhere else in this
app — confirmed explicitly as a permission check, never a literal
check against the role named "Administrator (Global)" itself, which
is one bundle of permissions among others that could hold the same
one.

## Every team belongs to exactly one org

Reported live, discussing how a delegated administrator's own view
should narrow: "There should never be a null-org team." Unlike
`org_user_roles.unit_id`, where null deliberately means "held
everywhere" (0196), there is no "everywhere team" here —
`org_teams.unit_id` is `NOT NULL` in the schema itself (migration
0064).

**The migration itself, and what it found live.** SQLite cannot add
a `NOT NULL` column without a default to a table that may already
hold rows — recreated instead, the same pattern migration 0047 used
for `org_user_roles`, with a safety assertion that `org_teams` is
empty. It genuinely wasn't: two real teams existed in production —
`ap-team` and `AP team` — one holding 23 real tasks across several
process stages, not the simple seed data first assumed. Confirmed
directly against the live database rather than guessed, in three
steps: which teams exist, who is a member of each, and which real
tasks each one owns. The operator confirmed this was build-mode test
data and authorized removing it; the delete itself was validated
against a local reproduction of the exact live shape (teams, members,
and tasks together, in the right order) before being handed over,
since `tasks.owner_team_id` is also a foreign key into `org_teams`
and deleting in the wrong order would have failed the same way the
first, incomplete delete attempt did live.

**The permission split — confirmed, not assumed.** Creating or
renaming a team is `Admin.RoleManagement` — instance-wide, never
delegated, the same reasoning that permission already gives editing
a role's own definition, since a team's own name and org mean the
same thing to everyone. Adding or removing a *member* is
`Admin.UserManagement` — the same permission, and the same delegable
shape, that already assigns a role to a person. Reading the list
accepts either, mirroring `/org/overview`'s own established "either A
or B" shape rather than inventing a new one.

**Scoped the same way people already are.** `handleListTeams` takes
a `scopeUnits` parameter exactly like `handleGetOrgOverview` — an
unscoped caller sees every team; a delegated `Admin.UserManagement`
holder sees only teams whose own org they administer.
`handleAddTeamMember` and `handleRemoveTeamMember` carry the same
boundary `handleAssignRole` already has: a delegated administrator
may act only on a team within their own scope, checked against the
team's own `unit_id`.

## What has coverage

Backend: every new function and gate has dedicated tests, including
the cross-check the split exists to enforce — `Admin.RoleManagement`
alone is correctly insufficient for touching membership, and
`Admin.UserManagement` alone is correctly insufficient for renaming a
team or reassigning its org. Nine other test files across the whole
backend suite broke because they had used team creation as incidental
setup for scenarios that were never about teams at all — task
claiming, a full process run, return and discard routes, session
routes, scoped-role tests — fixed by giving each a real org, not by
weakening what any of them check.

Frontend: the tab-visibility gate, the org picker's own required
field and pre-selection, and the team list's new org column each have
dedicated coverage, probed directly — bypassing the gate, and removing
the org column, each failed exactly the test built to catch it.

`vf-app`: 1594 tests (was 1565). `vf-ui`: 60 Worker (unchanged), 481
browser (was 461).

## What is not built, and this matters

**Nothing here added org-scoping to anything else.** Roles, org
units, and permission definitions all remain exactly as scoped or
unscoped as they already were — this decision touched only which
tabs are visible and how teams themselves are scoped, not the
underlying data model for anything else.

**Rules and Sources were discussed as future tab candidates, and
deliberately not built.** The mockup that started this conversation
showed six tabs; the operator scoped this piece down to the four
already living on one screen, treating folding in Rules and Sources
as its own, later decision — each has its own compiler UI, worked-
examples flow, and intake-channel setup that a tab move would need
to account for, not just a label change.
