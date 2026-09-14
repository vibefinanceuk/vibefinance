# 0327 — Assigning and revoking a role, the other half of decision 0201

**Status: built.** The gap decision 0326 named and deliberately left
open: every role assignment in the system, including the four built
that session, still had no UI path to reach a person.

---

## What was asked

> Continue.

Following on directly from decision 0326's own closing note.
Confirmed the scope explicitly before building: assign and revoke
together, as one piece of work, rather than assign now and revoke as
a separate, later gap of its own.

## What was found

**A real, documented precedent already existed for revoke's own
shape**, and it was checked before writing anything. Decision 0133,
elsewhere in this same codebase, deliberately chose a query parameter
over a `DELETE` body for exactly this kind of situation — *"a query
parameter rather than a body, because DELETE with a body is carried
inconsistently by proxies."* Confirmed this risk is real for this
app specifically, not just a general caution: `vf-ui`'s own proxy
does forward a DELETE body correctly, but the browser and any
intermediary between it and this app are not the same guarantee, and
no route in this codebase uses a DELETE body today. `roleId` lives in
the URL path, where it is always reliably delivered; `unitId` — the
only other thing a revoke needs, to say which of possibly several
scoped assignments of the same role to remove — is exactly the kind
of qualifier `?releaseAddress=true` already solved this same way.

**A fourth instance of decision 0212's own gap**, found before a real
request could fail on it: `POST /org/users/:id/roles` (assign) has
existed in `vf-app` since decision 0201 and was never on `vf-ui`'s own
proxy allow-list either — unreachable from a real browser this entire
time, despite every backend test treating it as a working route.

## What was built

- `handleRevokeRole` — mirrors `handleAssignRole`'s own delegation
  logic exactly rather than inventing a second rule for the same
  boundary: a delegated administrator may revoke only a scoped
  assignment at or within a unit they administer, never an
  "everywhere" one, the same asymmetry that route already enforces
  granting
- `DELETE /org/users/:userId/roles/:roleId?unitId=<unit>`, gated the
  same way assign already is; both routes added to `vf-ui`'s own
  allow-list together
- `roles.js`: clicking a person, gated to `Admin.UserManagement`,
  opens a popout listing their own current assignments — each with a
  `Remove` control — beside a form to add a new one. The org picker
  offers exactly `units`, which `/org/overview` itself already
  returns pre-scoped to a delegated administrator's own reach
  (decision 0321); no scope logic is re-derived client-side, and a
  refusal the backend still enforces — granting or revoking
  "everywhere" beyond what someone administers — surfaces through the
  same real-error handling every other form on this screen already
  uses

## What has coverage

Backend: 4 unit tests for `handleRevokeRole`, including that
targeting one of a person's two assignments of the same role at
different units leaves the other untouched; 4 delegation-boundary
tests mirroring the existing assign ones exactly, on the revoking
side; 8 real HTTP-level tests through the actual router for both
routes — the existing "assigns a role... through the real router"
test only ever exercised the 401 bootstrap-ends case, never a real
authenticated success, for either route. Each probed directly:
removing the SQL's own unit-matching logic failed exactly the test
built to catch it; removing the delegation boundary in
`handleRevokeRole` failed exactly the two tests that depend on it.

Frontend: 10 new browser tests — gating, the role and org pickers
offering exactly what the backend returned (including `Everywhere`
posting a `null` unitId), a real error shown and the form staying
open on failure for both assign and revoke, and — the one this
decision's own design turned on — confirming a revoke's request
carries `unitId` as a query parameter with no body at all. Probed
directly: removing that query-parameter construction failed exactly
that test.

`vf-app`: 1554 tests (was 1539). `vf-ui`: 54 Worker (was 52), 447
browser (was 437).

## What is not built, and this matters

**Creating a new person still has no UI path.** Assignment now works
for anyone already in `org_users`, but every person in the system
today — Alice included — still exists there only because of a raw
SQL insert. A form can only assign a role to somebody already listed;
it cannot introduce somebody new.

**Setting an authority limit through the screen remains unbuilt.**
The real, flagged security gap from decision 0319 — `POST
/org/users/:id/authority-limits` has no permission check of any kind
— was not touched here. Building a UI for it now would mean giving
every `Admin.UserManagement` holder a working path to a route this
session already knows is unguarded, which is a reason to close the
gap first, not a reason it was in scope for this piece.
