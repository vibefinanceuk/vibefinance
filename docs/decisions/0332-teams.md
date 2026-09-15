# 0332 — Teams

**Status: built.** The remaining piece of the original request —
"a UI for creating Users, allocating user variables, allocating roles
to user, and assigning users to teams. creating and maintaining
teams" — after users (0328), role assignment (0327), and permission
descriptions (0331) each became their own, deliberately separate
piece of work.

---

## What was found

`team-route.ts` already had a create-team and add-member route, both
completely unauthenticated — the same bootstrap-deadlock reasoning
`/org/units` and the original `/org/roles` carried before decision
0326, applied to something that never actually needed it: nothing
about creating the first account in a new instance depends on a team
existing. There was no route at all to list teams, remove a member,
or rename one, and — the now-familiar shape — neither existing route
was on `vf-ui`'s own proxy allow-list.

**The permission split, confirmed before building anything.**
`org_teams` carries no `unit_id` — teams are customer-wide, with
nothing today to scope them to an org. That makes creating or
renaming a team more like editing a role's own definition
(`Admin.RoleManagement`, instance-wide, since "AP Team" means the
same thing everywhere) than like adding a person. Adding or removing
a *member*, though, is the same shape as assigning a role to a person
— already `Admin.UserManagement`, already delegable. Confirmed
directly rather than assumed.

## What was built

- `handleUpdateTeam` (rename), `handleRemoveTeamMember`, and
  `handleListTeams` (every team with its own real members) — none
  existed before
- All five routes gated per the confirmed split; `GET /org/teams`
  accepts either permission, mirroring `/org/overview`'s own
  established "either A or B" shape rather than inventing a new one
- All five added to `vf-ui`'s proxy allow-list — the seventh through
  tenth instances of this exact gap this session
- `roles.js`: a "Teams" section, visible only holding one of the two
  relevant permissions, since an `Admin.Configure`-only holder can
  see everything else on this screen and correctly not see this.
  Clicking a team opens one popout that holds two different
  permissions' worth of controls at once — the name editable only
  holding `Admin.RoleManagement`, the member list (add, remove) only
  holding `Admin.UserManagement` — rather than two separate screens
  for what is, from a person's own point of view, one team

## What has coverage

Backend: 10 new unit tests for the three new functions (including
that removing one team's own membership leaves a second team's
membership of the same person untouched), 10 new real HTTP-level
tests confirming each route's own gate — including that
`Admin.RoleManagement` alone is correctly insufficient for adding a
member, and `Admin.UserManagement` alone is correctly insufficient
for renaming, the cross-check the split itself exists to enforce. Ten
pre-existing tests elsewhere in the suite broke because they used
team creation as incidental setup for scenarios that were never about
teams at all (task claiming, a full process run, a cost-centre rule)
— fixed by authenticating their own setup calls, not by weakening
what they check. Every new gate probed directly: bypassing each of
the five in turn failed exactly the test built to catch it.

Frontend: 14 new browser tests, including that the member picker
correctly excludes people already on the team, that the name field is
disabled and no Save button appears holding only
`Admin.UserManagement`, and that no member picker or Remove control
appears holding only `Admin.RoleManagement`. Probed directly: removing
the section's own visibility gate, and removing the picker's own
already-member filter, each failed exactly the test built to catch it.

`vf-app`: 1583 tests (was 1565). `vf-ui`: 60 Worker (was 56), 475
browser (was 461).

## What is not built, and this matters

**Teams remain customer-wide.** Nothing here added org-scoping to a
team — that was never asked for, and would be a real schema change
(a `unit_id` on `org_teams`) rather than a UI gap. If a customer
eventually wants "AP Team (France)" distinct from "AP Team
(Germany)," that is its own, later decision.
