# 0328 — Creating a person

**Status: built.** The first slice of a much larger request — creating
users, allocating "user variables," roles, and teams — scoped
deliberately narrow: a person, with the fields that already existed
somewhere in this system (name, email, org, approval limit).

---

## What was asked

> Please can you take a look at a UI for creating Users, allocating
> user variables, allocating roles to user, and assigning users to
> teams. creating and maintaining teams

Investigated the true scope before proposing anything. Role
allocation was already built (decision 0327). Teams exist as a
concept (`org_teams`, `org_team_members`) with create and add-member
routes, but no list, no remove, and — like every other setup route in
this family — no authentication at all. "User variables," once
clarified, turned out to span fields that already exist (name, email,
org, approval limit), one that exists but is inert (`locale`, sitting
unused since early in this project), and several that do not exist
anywhere: cost-centre allocation for a person, a picture, a forename/
surname split, a business title. Confirmed explicitly to start with
only the first category — real, already-loadbearing fields — rather
than guess at priority across new schema, new infrastructure, and
several genuinely separate screens.

## What was found and decided

**`handleCreateUser` was completely ungated** — the same
bootstrap-deadlock class as `/org/units` and the original `/org/roles`
before decision 0326. Confirmed directly: gate it with
`Admin.UserManagement`, the same delegable permission already used
for assigning a role, so a France-scoped administrator can create a
person and assign them a role within France under one consistent
model — and confirmed that a delegated administrator's own scope
should also limit which org a new person can be assigned to, the same
boundary `handleAssignRole` already enforces granting: a person
created with no org, or one outside what the administrator
administers, would not be visible to that same administrator again
afterward (decision 0321's own scoping) — invisible the moment they
are created is worse than merely restricted.

**A second, real security gap surfaced while building this, not
before.** `POST /org/users/:id/authority-limits` had no permission
check of any kind — flagged in decisions 0319 and 0327 as a known
gap, and about to become reachable from a real browser for the first
time as part of this same UI. Confirmed directly before building on
top of it: gated with `Admin.UserManagement` too, the simple form for
now — a permission check, not yet the fuller per-person delegation
scoping creation and role-granting already have. A real
simplification, named rather than made in passing.

**A sixth instance of decision 0212's own gap**, found the same way
as every other one this session: `POST /org/users` and `POST
/org/users/:id/authority-limits` both existed in `vf-app` and were
never on `vf-ui`'s own proxy allow-list.

**The returned API key changed the shape of the form itself.**
Creating a person generates a real credential shown in the response
exactly once — never recoverable after, only rotatable. Every other
form on this screen closes and reloads on success; this one cannot,
because the value that matters would already be gone by the time
anyone could copy it. The popout instead replaces its own contents
with the key and a clear warning, and only closes (and reloads) once
the person confirms they are done with it — the form and the key are
never both on screen together, so there is no lingering "submit
again" affordance once the credential has already been issued.

## What was built

- `handleCreateUser` takes a `granterUnits` parameter, mirroring
  `handleAssignRole`/`handleRevokeRole`'s exact delegation logic
- `POST /org/users` gated with `Admin.UserManagement`, bootstrap-aware
  like the role routes — this is, after all, the route that creates
  the very first account decision 0010's own exception describes
- `POST /org/users/:id/authority-limits` gated with
  `Admin.UserManagement`
- Both routes added to `vf-ui`'s proxy allow-list
- `roles.js`: a "New person" form (name, email, org, an optional
  approval limit set in the same action) gated to
  `Admin.UserManagement`, followed by the one-time key display
- A `newperson` icon, deliberately identical to `newsupplier`'s own
  shape — both mean "add a person," and the two never appear on the
  same screen, so sharing the visual is not drift

## What has coverage

Backend: 4 new `handleCreateUser` delegation tests mirroring the
existing assign-side ones exactly; 7 real HTTP-level tests through
the actual router for both newly-gated routes. Five pre-existing
tests broke because they relied on these routes being ungated —
fixed by authenticating their own setup calls, not by weakening what
they check. Every new gate probed directly: bypassing the
authority-limits check, and removing `handleCreateUser`'s own
delegation boundary, each failed exactly the tests built to catch
them.

Frontend: 7 new browser tests, including that a blank currency and
amount correctly send no authority-limit request at all, and that the
key display genuinely replaces the form rather than sitting beside
it. **A real bug was found and fixed in the test harness itself
while building these**: `stubFetch`'s own detection of an
already-response-shaped stub checked only for a `status` key, missing
the equally common `{ ok: true, json: ... }` shape every earlier
success-case stub in this file already used — harmless everywhere
that shape's caller never read the response body, and silently wrong
the first time a test needed to (this one, reading the created
person's own `id` to make the follow-up authority-limits call).
Fixed at the root rather than worked around in the one test that
happened to expose it.

`vf-app`: 1565 tests (was 1554). `vf-ui`: 56 Worker (was 54), 454
browser (was 447).

## What is not built, and this matters

**Everything else this request named remains open by design**:
teams (list, remove a member, rename — and closing the same
unauthenticated-route gap this decision closed for users), and every
field that does not exist yet — cost-centre allocation, a picture,
forename/surname, a business title. None of these were declined;
they were deliberately deferred to their own, later pieces rather
than folded into a form that was already carrying a real security
fix and a one-time-secret UX pattern of its own.
