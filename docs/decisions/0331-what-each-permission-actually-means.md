# 0331 — What each permission actually means, beside its own name

**Status: built.**

---

## What was asked

> The Permissions are sometimes a little difficult to understand what
> capability is provisioned. I wondered if listing the Permission
> next to a short description in a list format, with two columns,
> and each row with a check box would help? There are a lot of
> permissions, so a scroll bar on the pop-out would be needed to work
> down the list.

A well-founded concern, not a hypothetical one — this exact session
had already had to explain several permissions' real meaning by hand
more than once: `AP.TaskView` versus `AP.TaskManage`,
`Admin.RuleManagement` versus `Admin.RuleActivation` versus
`Admin.RoleManagement`, and `rules.activate` turning out not to be a
real permission at all.

## What was built

**Every description sourced directly from `permissions.ts`'s own
comments, not invented.** That file already carried the real,
detailed meaning of each permission — which routes enforce it, which
are placeholders, which category is entirely unbuilt. Thirty-one
descriptions drafted from that source and shown to the operator for
review before anything was built, since wording accurate enough to
resolve real confusion was the part most worth getting right.

`PERMISSION_DESCRIPTIONS`, a new export from `permissions.ts` typed
as `Record<Permission, string>` — the type system itself refuses a
build missing a description for any permission in the closed
vocabulary, or one for a permission that doesn't exist, the same
protection `isKnownPermissionList` already gives the vocabulary
itself. Kept beside `PERMISSIONS` rather than duplicated into the
frontend by hand, so a description can never drift from what its own
permission actually gates — the exact failure mode this session has
now caught in three other places (the proxy allow-list, the
standing-invariant vocabulary check, a stubbed test response) this
arc alone.

`/org/overview`'s own `knownPermissions` field changed shape: an
array of `{ name, description }` rather than bare strings. The
permission list a form offers was already exposed for exactly this
reason (decision 0326); this extends it rather than adding a second,
parallel endpoint.

`roles.js`'s own permission checkboxes rebuilt as two columns per
row — name and checkbox together on the left, description on the
right — still grouped by category as before, now inside a scrollable
container (`max-height`, `overflow-y: auto`) rather than however tall
thirty-one rows with real sentences happen to be.

## What has coverage

Backend: the existing test asserting the full vocabulary now checks
the richer shape, plus that every description is a real, non-empty
sentence and never just a repeat of the permission's own name.
Frontend: two new tests — that a permission's own real description
renders beside its name, and that the list sits in the scrollable
container — both probed directly, showing the wrong value and
removing the scrollable class each failed exactly the test built to
catch it.

`vf-app`: 1565 tests (unchanged — existing assertions rewritten, not
added to). `vf-ui`: 56 Worker (unchanged), 461 browser (was 459).
