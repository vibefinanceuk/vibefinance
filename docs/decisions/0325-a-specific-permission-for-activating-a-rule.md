# 0325 — Activating a rule gets its own permission

**Status: built.** A real gap found while defining new roles for the
read-only screen decision 0319 first made this kind of thing visible.

---

## What was asked

> There should be a specific permission for activating rules, such as
> Admin.RuleActivation.

Raised while defining a new "Administrator (Global)" role and finding
that the only route that checked `rules.activate` — a name that turns
out not to exist anywhere in the closed vocabulary — actually checked
`AP.Approve` instead.

Investigated before building anything. `AP.Approve` is checked in
exactly one place in this entire codebase: the route that activates a
rule. It never gates invoice approval anywhere — that happens through
a task's own `required_permission`, a separate, data-driven mechanism
this route never touched. The name implied something the permission
never did. `Admin.RuleManagement`, the closest-sounding existing
permission, gates compiling, reading, and renaming a rule — never
activating one. The operator's instinct was correct: activation is
genuinely its own concern, wearing a borrowed, misleading name.

**A real risk confirmed before changing anything live.** Alice
currently holds `AP.Approve` and can activate rules today. Replacing
the gate outright, without also granting her the new permission,
would have taken that away the moment this shipped. Confirmed
directly: replace the gate; who receives the new permission is
handled separately, as its own piece of work.

## What was built

`Admin.RuleActivation` added to the closed vocabulary. The route that
activates a rule now checks it instead of `AP.Approve` — replaced, not
layered alongside it, at the operator's own request.

## What has coverage

Two new tests, through the real HTTP route: holding only
`Admin.RuleActivation` succeeds; holding only the old `AP.Approve`
now correctly fails, proving the replacement rather than an addition.
The existing 403 test's own wording updated to match. Both existing
tests that already exercised this route continued to pass unchanged,
since the one test helper that grants every real permission
(`seedFullyAuthorizedUser`) reads the vocabulary dynamically rather
than a hard-coded list, and picked up the new permission automatically.

**A second, real gap found by the test suite itself, not by
inspection.** A standing invariant from decision 0200 — migration
0048's own hand-written enumeration of every permission, checked
forever against `permissions.ts`'s own list — caught the new
permission immediately: the two lists disagreed, exactly the drift
that invariant exists to prevent. Migration 0048 itself was not
edited; an already-applied migration's own assertion is a historical
record, not something to change in place. A new migration, 0062,
restates the same standing check with the vocabulary as it now
stands, and the test that compares the two now reads both files
together.

vf-app: 1526 tests (was 1524). No frontend change. One migration —
schema-inert, restating a standing invariant rather than altering any
table.

## What is not built, and this matters

**Nobody holds `Admin.RuleActivation` yet.** Replacing the gate
without granting the new permission to anyone means rule activation
is, for the moment, unreachable by anyone until it is explicitly
assigned — deliberate, per the operator's own choice to handle that
separately, but worth being direct about: this is a real, live gap
until it is closed.
