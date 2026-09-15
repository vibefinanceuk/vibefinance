# 0335 — Create Org and Manage Org

**Status: built.** "Is there a possibility to have a Create org and
manage org button, available only to the Administrator (Global)
role."

---

## What was found before anything was built

Checked directly, not assumed: `handleCreateUnit` already existed —
live since decision 0003 — and `POST /org/units` had **no permission
check of any kind**. Not a gap this decision introduced; a real,
already-known one, named in this project's own handover notes more
than once ("`POST /org/units` still has no permission check of any
kind") and never closed until now. `GET /org/units` was already
gated to `Admin.Configure`; the write side never was. Nothing let an
existing unit be edited at all — there was no "manage" half to this
capability before this decision, only "create."

The frontend matched the backend exactly: `unitRow()` had no click
handler, and the Org Units section had no "New org" action — every
unit shown on the Access screen's own Org Units tab (decision 0333)
was, until now, genuinely read-only.

## What "Administrator (Global)" means here

Gated on `Admin.Configure` — the same permission that already means
"unscoped, instance-wide standing" everywhere else in this app, and
the same one already used to hide the Org Units and Roles tabs from
anyone else (decision 0333). Never a literal check against the role
named "Administrator (Global)" itself, for the same reason decision
0333 already gives: a role is a bundle of permissions, not a fixed
identity, and a permission check survives that role being renamed or
a second role holding the same permission.

## Backend

`handleUpdateUnit` built new, matching `handleCreateUnit`'s own
validation exactly rather than a looser version of it — a unit's own
kind and hierarchy rules (an operating unit sits under a legal
entity, not another operating unit) do not relax just because the
unit already exists. A unit cannot be named as its own parent, the
same self-reference check this session has now given a manager
(0334) and a team's own org (0333). `POST /org/units` gated for the
first time; `PUT /org/units/:id` added with the same gate.
`/org/overview`'s own `units` query extended to also return
`buyerEndpoint`, `vatId`, and `buyerReference`, so the edit form can
show what is already there rather than opening blank.

**A real, load-bearing duplicate found in `vf-ui`'s own proxy
allow-list while adding the new route — caught by a probe, not
assumed correct.** A pre-existing `/^\/org\/units$/` pattern already
covered the bare path, from decision 0193, for an entirely different
reason (a document's own unit picker, a `GET`). The proxy allow-list
does not discriminate by HTTP method, so `POST /org/units` was
already reachable from a real browser before this decision — the gap
here was only ever the backend's own missing permission check, not a
second instance of the recurring allow-list problem this project has
found repeatedly. Only the genuinely new route,
`PUT /org/units/:id`, needed adding.

## Frontend

`openUnitForm()` — id (disabled once created, matching every other
entity form on this screen), name, kind, a parent-unit picker that
excludes the unit itself, and the three invoice-matching fields.
Save and Close (or Create and Close) together in the header, the
established shape. `unitRow()` made clickable, gated the same way the
New org action is.

## What has coverage

Backend: every new validation path on `handleUpdateUnit`, and both
new routes' own gate, probed directly — bypassing each in turn failed
exactly the test built to catch it. Frontend: the parent-picker's own
self-exclusion, and the row's own click gate, both probed the same
way; one test written against the row's own gate was found, via
probing, to actually only be testing the tab-level gate one layer up
(decision 0333) rather than anything unique — removed rather than
left as coverage that looked meaningful and wasn't.

`vf-app`: 1629 tests (was 1616). `vf-ui`: 63 Worker (was 62), 493
browser (was 486).
