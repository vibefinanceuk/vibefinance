# 0319 — Who can do what, where, and up to how much: a first, read-only view

**Status: built, read-only.** The role-management screen decision
0276 named as future work, its first half.

---

## What was asked

> Can you consider a UI for Role Management? I think Role permissions
> (including approval limits) fall into this category as a sub task.

Investigated before building anything, following the arc's own
established pattern. Only *write* routes existed — create a unit,
create a user, create a role, assign a role, set an authority limit —
and nothing at all to list any of it. Every question this screen needs
to answer ("who holds what, where") required reading the database
directly, which is exactly how this whole session's own investigations
have worked so far.

A real discrepancy surfaced in that investigation, worth stating
plainly since it shapes everything downstream: approval limits are
not stored per role. Decision 0009 settled that deliberately —
`(user_id, currency) → max_amount`, *"the real accounts-payable
concept: this person can approve up to X"* — a limit belongs to the
individual, not their job title. Two people holding the same role can
carry different limits, or none at all. Shown as a mock-up before
building the real thing, and confirmed directly: the operator agreed
this was their own mistake in the framing, not the schema's — a limit
is a property of the person.

**Also found, not fixed here:** the existing endpoint for setting
someone's approval limit has no permission check of any kind — a real
security gap, separate from this record's own scope, worth flagging
rather than leaving silent.

## Read-only first, confirmed before building

Given the size of the full feature — read and write, across five
different kinds of data — the operator chose to build the read side
first, mock it up before writing the real implementation, and treat
writes as later, separate work.

**The mock-up used the real design tokens**, not a generic style —
`tokens.css`'s own colours, Calibri/Carlito, the app's own `.panel`
and table shapes — specifically so what was being confirmed was the
actual product, not an approximation of it. The one design question it
surfaced (limits per role or per person) was resolved before a single
line of the real screen existed.

## What was built

**`handleGetOrgOverview`**, a single new backend function returning
every org unit, person, role, role assignment, and approval limit in
one call — the same "compute once, one round trip" reasoning decision
0240's own dashboard already established, joined to real names rather
than raw ids, so a screen showing "Alice — AP Manager — Acme France"
does not need three lookup tables to say it.

**`GET /org/overview`**, gated by `Admin.UserManagement` — the same
permission `handleAssignRole`'s own route already checks, since seeing
who holds what is the same trust boundary as granting it.

**`roles.js`**, a new screen with three sections matching the
confirmed mock-up: org units indented by hierarchy (the same
"indented list, not an invented tree widget" choice this app already
makes everywhere a hierarchy needs showing); roles with their own
permissions listed; people with their role assignments (named to a
real unit, or "everywhere" where unscoped) and their own approval
limits shown beside them — never borrowed from a role, matching what
was just confirmed.

Wired into the nav, gated by the same permission as the backend route.
A new icon (two people, the same "borrow a known, recognisable shape"
reasoning `building` already gave itself) and new strings in English
and German.

## What has coverage

Six new backend tests: an empty picture for a customer with nothing
configured; every unit, user, and role returned; an assignment joined
to real names rather than ids; an unscoped assignment's own unit shown
as null rather than omitted; a role with unparseable permissions
survives rather than breaking the whole response, the same fallback
`permissionsFor` already uses; every authority limit joined to the
person's own name. Two probed directly — the `LEFT JOIN` that keeps
unscoped assignments visible, and the unparseable-permissions
fallback — each fails exactly the test written to catch it.

Eleven new frontend tests: the screen renders; a top-level unit gets
no indent and a child gets one; a role's own permissions join into one
readable list, and an empty one reads distinctly rather than as a
blank cell; a person's own assignment is named to a real unit, or
shown as held everywhere; a person's own approval limit shows beside
them; a person holding nothing shows distinct empty states rather than
blank cells; and — the property just confirmed — one person's own
limit is never shown against another holding the same role. Two probed
directly, including that last one.

vf-app: 1513 tests (was 1507). vf-ui: 49 Worker, 423 browser (was
412). One migration.

## What is not built, and this matters

**Nothing on this screen can change anything.** Every write this data
needs — assigning a role, revoking one, creating a unit or user or
role, setting a limit — either already exists as a raw route or does
not exist at all (there is still no way to revoke a role once
granted). That is deliberate, separate, later work, not an oversight.

**The permission gap found on `POST /org/users/:id/authority-limits`
remains open.** Anyone who can reach that endpoint today can set
anyone's approval limit, unauthenticated. Worth fixing regardless of
when the write side of this screen gets built.
