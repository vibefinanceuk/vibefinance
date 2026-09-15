# 0334 — User Properties

**Status: built.** "A way to specify User Properties, including Org
Unit / Company Code, Cost Center, Supervisor / Manager, Spend Limit /
CCY, Approval Limit / CCY, Office Address Location, Budget Holder
(True/False)." Checked against the real schema before building
anything — three of the seven already existed, one needed no schema
at all, and the remaining three needed real, new work.

---

## What was already there, and what genuinely wasn't

Investigated before proposing anything, not assumed:

- **Approval Limit / CCY** — exact match, `org_authority_limits`,
  already editable on the person form.
- **Org Unit** — already the `unitId` assignment every person
  already has. "Company Code" confirmed as the operator's own name
  for the same thing, not a separate field.
- **Cost Center** — a real, important distinction found here: the
  schema already had `cost_centres.owner_user_id`, the *reverse*
  relationship (who approves a cost centre's own charges, decision
  0184). What was asked for is the *forward* one — which cost centre
  a person's own spend is charged against — genuinely missing.
- **Supervisor / Manager** — nothing like this existed at all.
- **Spend Limit / CCY** — confirmed live as genuinely distinct from
  Approval Limit: how much a person may request or spend themselves,
  not how much they may approve for others. Not a rename.
- **Office Address Location** — free text was never considered; the
  exact structured shape org units already have (`address_line`,
  `city`, `postal_code`, `country`, migration 0053) was reused
  instead.
- **Budget Holder** — confirmed live as *derived*, not a new column:
  true if this person owns any cost centre
  (`cost_centres.owner_user_id`), "one source of truth" rather than a
  second flag that could disagree with it.

**Full create-and-edit, not just an extended creation form.** Nothing
before this decision let any of a person's own properties — including
the pre-existing Approval Limit and Org Unit — be changed once they
were created; the New Person form was the only place any of it was
ever set. Properties like these change (a manager changes, someone
moves office), so this decision built `handleUpdateUser` as new,
general infrastructure rather than only adding fields to the existing
create-time form.

## Schema (migration 0065)

`cost_centre_id` and self-referential `manager_id` on `org_users`,
the latter with a `CHECK` constraint tested directly rather than
trusted: nobody can be recorded as their own manager. Four address
columns, matching org units' own shape exactly. A new
`org_spend_limits` table, mirroring `org_authority_limits` — same
shape, genuinely separate concept, so the two can never be confused
at the schema level either.

**A genuine circular dependency, found and fixed in the test harness,
not the schema itself.** `cost_centres.owner_user_id` already
referenced `org_users` (migration 0044); this decision's own
`org_users.cost_centre_id` now references `cost_centres` right back.
No drop order in the test suite's own teardown satisfies both
directions. `PRAGMA foreign_keys = OFF` does not help — confirmed
directly, not assumed: `env.DB.exec()` does not carry pragma state
between separate calls in this environment. Fixed by nulling the
circular column before the drop loop runs, breaking the cycle's own
data rather than fighting its structure.

## Backend

`handleCreateUser` extended with the new fields and their own real
validation — a 404 for a manager or cost centre that does not exist, a
400 for naming oneself as one's own manager, checked before any write.
`handleUpdateUser` built new: the same "replace, not merge" shape
`handleUpdateRole` and `handleUpdateTeam` already give editing
something with several fields, and the same delegation boundary
`handleCreateUser` already has — a delegated administrator may edit
only a person already within their own scope, and may not move them
outside it. `handleSetSpendLimit` mirrors `handleSetAuthorityLimit`
exactly. `/org/overview` now returns manager name, cost centre name,
every cost centre (unscoped, the same "not sensitive by itself"
reasoning role definitions already have), and the derived
`isBudgetHolder`.

All three new routes gated and delegation-scoped, and added to
`vf-ui`'s own proxy allow-list at build time rather than found the
way eight earlier instances of that exact gap already were.

## Frontend

The New Person form gained the new fields at creation time. What was
`openAssignmentsForm` (decision 0327) became `openPersonForm` —
extended rather than duplicated into a second popout, since a person
looking at somebody's own roles is exactly the moment editing their
manager or spend limit also makes sense, the same reasoning 0327 gave
combining assign and revoke in the first place. Properties save
together under their own header "Save"; Approval Limit and Spend
Limit each keep an independent, inline "Set" — matching how adding a
team member already works, not the header. Budget Holder is shown,
never a checkbox.

| **The header's own primary action changed, deliberately — worth naming.** Decision 0330 established "primary action and Close, together, top right" for a single-purpose popout. This one now holds several independent actions — Save, two Set actions, Assign — and Save was kept as the header's own primary, the same shape the Teams popout (0332) already established for a popout with more than one section: rename in the header, membership actions inline. `Assign` moved out of the header as a direct result; the test asserting it belonged there was updated to match, not left describing behaviour the popout no longer has. |
| --- |

## What has coverage

Backend: dedicated tests for every new field, the self-management
check on both create and update, the derived Budget Holder logic, and
`handleUpdateUser`'s own delegation boundary — each probed directly by
removing the real check and confirming the test built to catch it
fails. Frontend: manager-picker self-exclusion, existing-value
pre-selection, the Budget Holder display, and the independent spend
limit action, each probed the same way.

A real bug was found and fixed while building this, not before: an
edit to the person popout left an orphaned tail from the function it
replaced, a genuine JavaScript syntax error that broke the entire
frontend test file at once — caught immediately by the simplest test
in the file failing alongside everything else, not a subtle issue
that could have shipped unnoticed.

`vf-app`: 1616 tests (was 1594). `vf-ui`: 62 Worker (was 60), 486
browser (was 481).
