# 0326 — The write side of Roles: a permission of its own

**Status: built.** The first write capability on the role-management
screen decision 0319 deliberately left read-only.

---

## What was asked

> Shall we look at write permission for the Role screen. It should be
> limited to the Administrator (Global) role. Perhaps with
> Admin.RoleManagement permission

Checked before building anything: `Admin.RoleManagement` did not
exist — only `Admin.RuleManagement` did, a genuinely different
permission (rule definitions, not roles) whose name is one character
away from what was proposed. Confirmed which was meant rather than
guessing from the similarity.

## What was found

Mapping out every write this screen would need surfaced a real design
tension. `Admin.UserManagement` already exists and is deliberately
**delegable** (decision 0201) — a France-scoped administrator can
assign an existing role to a person within France without needing
global access. Making `Admin.RoleManagement` the gate for
*everything*, including assignment, would have quietly undone that.

Resolved with the operator directly: `Admin.RoleManagement`,
global-only, gates the things that had no permission model at all —
creating and editing a role's own definition. Assigning an *existing*
role to a person keeps its own, already-deliberate
`Admin.UserManagement` gate, unchanged. Scoped to start with editing a
role's own permissions specifically — the single most acute pain
point this whole session's own raw-SQL work stood in for, repeatedly.

**Two more instances of decision 0212's own gap, found before they
could be reported live.** `/org/roles` (create) had existed in
`vf-app` since before this session and was never on `vf-ui`'s own
proxy allow-list either — unreachable from a real browser this entire
time, the same shape as decision 0324's `/org/overview`. Added both
the existing create route and the new update route to the allow-list
together, and to `index.test.ts`'s own `reachable` list, decision
0212's mechanism, rather than waiting for a real request to fail.

**The same standing-invariant drift decision 0325 already found,
found again.** Adding `Admin.RoleManagement` to the vocabulary broke
`stage-permissions.test.ts`'s own exact-match check against migration
0048's hand-written enumeration, for the same reason `Admin.RuleActivation`
did. Migration 0063 restates the same invariant with the vocabulary as
it now stands; the test reads all three migration files together.

**A CSS rule I wrote broke a real test, correctly.** `typography.test.ts`
checks that every font size in this codebase traces to a defined scale
token — `--text-sm`, `--text-base`, and so on — rather than a bare
pixel value. Two rules for the new permission checkboxes used `12px`
and `14px` directly; both values happened to already match
`--text-sm` and `--text-base` exactly, so the fix was using the token
that already meant what the number meant.

## What was built

- `Admin.RoleManagement`, added to the closed vocabulary
- `handleUpdateRole` — a full replace of a role's own name and
  permissions, the same "replace, not merge" discipline decision 0208
  already gives a supplier load, never a partial patch
- `PUT /org/roles/:id`, and the existing `POST /org/roles` gated for
  the first time, both behind `Admin.RoleManagement`
- `/org/overview` now returns `knownPermissions` — the real, closed
  vocabulary, so an edit form offers checkboxes rather than a
  free-text field. This session's own raw SQL caught a typo
  (`AP.TaskManager` for `AP.TaskManage`) and a near-miss permission
  name by hand, more than once; a checkbox cannot be mistyped
- `roles.js`: a single `openRoleForm()` shared between create and
  edit, permissions grouped by category (`AP.*`, `Admin.*`, and so
  on) the same way the vocabulary itself is already namespaced, write
  controls appearing only for `Admin.RoleManagement` holders
- `hasMyPermission()`, exported from `tasks.js` for the first time —
  `frame()`'s own nav-visibility check has read `me?.permissions`
  since decision 0313; this is the same data, now reachable from a
  screen deciding something other than which nav item to show
- A `newrole` icon — deliberately not `newsupplier`'s person shape: a
  role is a badge of permission, not somebody

## What has coverage

Backend: 5 unit tests for `handleUpdateRole`, 7 real HTTP-level tests
through the actual router for both routes — including that a
delegated `Admin.UserManagement` holder, sufficient for `/org/overview`,
is deliberately *not* sufficient here. Each probed directly: bypassing
the permission check failed exactly the tests built to catch it.

Frontend: 12 new browser tests — gating (no button, no click, without
the permission), the create form (empty, grouped, posts the right
body, shows a real error and stays open on failure, closes without
saving), the edit form (pre-filled name and checked permissions, the
id shown but disabled, a full replace PUT on save). Probed directly:
removing the permission gate failed the gating tests; corrupting the
POST body failed the body test.

`vf-app`: 1539 tests (was 1526). `vf-ui`: 52 Worker (was 50), 437
browser (was 425).

## What is not built, and this matters

**Assigning or revoking a role, through the screen, still does not
exist.** Every role in the system — including the four built this
session — still has no UI path to reach a person; every assignment
made so far has been raw SQL. That gap was named, not closed, and
`Admin.UserManagement`'s own delegation model is exactly why it
deserves its own, separate treatment rather than reusing this one.

**A genuine, pre-existing issue, unrelated to this work, surfaced
while testing it.** `viewer.js` calls `buildActivityTab()` without
awaiting it, and `documents.test.ts` does not stub every route it can
reach — an unhandled rejection that occasionally surfaces against a
different, unrelated test depending on suite timing. Confirmed
directly: reproducible without any change from this decision, and
unaffected by the fix above. Not touched here — a different file, a
different concern — but worth its own fix.
