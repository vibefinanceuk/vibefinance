# 0276 — The Vibe AP group, undone; the nav, underpinned with real permissions

**Status: built.**

---

## What was asked

> I've decided that the sub menu, entitled "Vibe AP" looks bad... I'd
> like to revert that change, so that no sub menu exists and the menu
> items beneath it are always displayed. Additionally could you
> increase the size on the icons... and look at the alignment...
> Another thing worth considering, is the menu item permissions... now
> seems like a sensible time to underpin with some kind of role, menu
> mapping so that we can control who sees certain menus.

Two changes, confirmed separately: the flat list and larger icons via
a mock-up first; the permission model after a short investigation into
what already existed.

## The group, reverted

Decision 0274's "Vibe AP" group — folder icon, expand/collapse
chevron, indented children — is gone. Icons sized to 24px, labels to
`--text-lg` (16px, the closest real step on the scale — the mock-up
used 17px, which does not exist as a step and would have needed its
own justified addition for a 1px difference nobody would see). The
whole-nav fold-to-icons toggle from the same decision stayed; only the
group wrapper inside it was reverted. Dead code removed alongside it:
`vibeApExpanded`/`setVibeApExpanded`, the `vibeap` folder icon, and the
group-only CSS.

## What already existed, found before anything was built

Real infrastructure predates this decision entirely: `org_roles` (a
customer-named permission container), `org_user_roles` (many-to-many),
a closed permission vocabulary every route already checks, and
`/whoami` already returning a user's full flattened permission list.
"Underpinning" was smaller than it might have felt — the foundation
was already there, just never consulted by the nav.

**One real mismatch surfaced before mapping anything**: the operator's
own example was "an administrator can access Rules and Sources, but
the AP user should not." Sources already matched that
(`Admin.Configure`). Rules didn't — `GET /rules` required only
`AP.Review`, the same permission ordinary AP review work already
carries; only compiling a rule required `Admin.RuleManagement`. Raised
directly rather than mapped around silently.

## Three new permissions, four routes gated

`AP.Dashboard`, `AP.TaskView`, `AP.Supplier` — added to the closed
vocabulary, each gating both a nav item and the route behind it.
`GET /dashboard`, `GET /tasks`, and `GET /suppliers` had no permission
check before this beyond authentication; each now has one.
`AP.TaskView` is deliberately distinct from the already-existing
`AP.TaskManage` (releasing others' tasks, a more privileged
capability) — seeing your own task list at all is the lesser thing.

`GET /rules` and `GET /rules/stages` tightened from `AP.Review` to
`Admin.RuleManagement`, at the operator's own follow-up: "tighten the
API too." The old routes' own comment reasoning — that reading which
rules run is not configuring them — was correct on its own terms and
is not disputed; it is simply overridden by treating Rules as an
administrative screen end to end, matching `/rules/compile`'s existing
gate rather than sitting apart from it.

**A cross-file consistency check caught a real gap.** A SQL migration
hand-mirrors the TypeScript permission list specifically because
SQLite cannot import a TypeScript constant, and a test asserts the two
never drift. Adding three permissions to one side without the other
failed that test immediately — found and fixed, not worked around.

## Backward compatibility, decided deliberately per permission

A new migration grants `AP.Dashboard`, `AP.TaskView`, and `AP.Supplier`
to every existing role, so nobody who could already reach Dashboard,
Tasks, or Suppliers loses that ability as a side effect of the
vocabulary now existing to describe it. Restricting a specific role
from a specific screen going forward is exactly what the future Role
permissions screen is for — not something a migration should decide on
anyone's behalf.

**`Admin.RuleManagement` is deliberately excluded from that grant.**
Auto-granting it to every role that already carries `AP.Review` would
defeat the very tightening just requested. Stated plainly, not left
implicit: whichever real role should keep seeing Rules needs
`Admin.RuleManagement` granted to it explicitly — there is no admin UI
yet to do this through, so today that means a direct database update
against the one real deployed customer, once, by hand.

## What was actually proven, not just written

**Every one of the four route changes has a positive and negative
test** — `seedUserWithPermissions` with the specific permission,
succeeding; the same helper with a deliberately wrong one, 403ing.
None of these routes had any test coverage of their permission
boundary before this — confirmed by grepping for the new permission
names across every test file and finding zero hits before this work.
Two gates were probed directly: removing the `AP.Dashboard` check and
reverting `Admin.RuleManagement` back to `AP.Review`, confirming the
right test fails each time.

**The frontend filter has equivalent coverage**: a person with all six
permissions sees the full flat list; a person missing exactly one
(`Admin.RuleManagement`) sees everything except Rules; a person with
none sees nothing but the logo (a real, expected state for an account
with no AP role assigned yet, not a bug to guard against); and each of
the six permissions was checked in isolation, unlocking exactly and
only the one screen it names.

**A hardcoded font-size was caught by an existing test, not missed.**
The mock-up's 17px label size was written directly into the CSS before
this record was drafted; the project's own typography test refused it
immediately, and it became `--text-lg` instead.

**Two pre-existing test files broke for a real reason, not a
coincidental one.** `rules.test.ts` and `sources.test.ts` open their
own screen directly, bypassing `start()` — the one function that
actually populates the signed-in user. Decision 0276's nav filter was
the first thing in `frame()` to depend on that user being real, so
`me` being `null` in these tests silently emptied the nav. Fixed by
making both tests go through the same `start()` a real person always
does before reaching any screen, rather than special-casing `null` in
`frame()` itself to paper over a test artifact that does not occur in
real use.

vf-app: 1511 tests. vf-ui: 49 Worker, 329 browser. vf-licence
untouched.
