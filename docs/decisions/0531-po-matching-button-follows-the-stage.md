# 0531 — The PO matching button follows the stage, and a returned task keeps the stage's own kind of permission

**Status: pushed (`2140322`) and deployed, as confirmed by the operator on 28 September, who then saw the PO matching button and the linked PO-TEST-9920 on the live Matching task.** It changes `vf-app` and `vf-ui`, with no migration and no string change.

## What was asked

After 0530 deployed:

> should this work for items already in the matching stage - I do not
> see the new action in the action row

The operator signed in to the in-app browser so the live data could be
checked directly.

## What was found

Read live through the operator's own session:

- The only open Matching task (TEST-PO-0003) requires **`AP.Review`**,
  not `AP.Match`. 0530 showed the button only for `AP.Match`.
- It has no "Here because" reason: no rule raised it. The Matching
  stage offers a Return from AP Review, and `return-route.ts` gives a
  returned task the target stage's own `required_permission`, falling
  back to the returning task's. The Matching stage has none set, so a
  task returned from AP Review keeps `AP.Review`.
- The Matching stage's rules are the four standard matching rules, all
  live, plus a paused "PO Line Not Matched". Each tests a `po.*` fact
  (`po.line_reference_found`, `po.line_price_matched`,
  `po.line_quantity_matched`, `po.line_unit_mismatch`).

## What was decided

- **The server decides per task (`offersPoMatching`, in
  `task-list-route.ts`).** It is true when:
  - the task's stage has an enabled rule, in its rule set or a unit's
    override of it (0197), whose current version tests a `po.*` fact;
    or
  - the task requires `AP.Match`, as before.

  One query per list, not per task.
- **The viewer shows the button on `offersPoMatching`.** `AP.Match` is
  still honoured on its own, so a task object from anywhere else keeps
  working.
- **`AP.Review` may use the panel's routes**, alongside `AP.Match` and
  `AP.Validate`. The person working a task returned to Matching holds
  `AP.Review`, and would otherwise see the button and get a 403.

### A task returned to a stage with no declared permission

The operator asked next:

> Do I need to change any rules, as it should not be sent to AP.Review

No. The rules were right: every Matching rule asks for `AP.Match`. The
`AP.Review` came from Return's fallback. **`return-route.ts` now falls
back in three steps:**

1. the target stage's own `required_permission`, as before (0490);
2. **new:** the permission the target stage's most recent task on this
   same invoice carried. At Matching that is the task a Matching rule
   raised, so `AP.Match`. It is the same kind of work, at the same
   stage, on the same invoice;
3. the returning task's own permission, as the last resort, as before.

**Tasks already created are not changed.** The open TEST-PO-0003 task
still requires `AP.Review`. The panel works on it now (the button
follows the stage, and the routes accept `AP.Review`). The next return
to Matching will land with `AP.Match`.

## Verification

- **`vf-app` `task-list-route.test.ts`**, 3 new tests:
  - true at a stage with a `po.*` rule, on an `AP.Review` task;
  - false at a stage with no such rule, and where the only `po.*` rule
    is disabled;
  - true on an `AP.Match` task anywhere.

  All 3 **failed** with the route stashed.
- **`vf-ui` `viewer.test.ts`**: the button shows on an `AP.Review` task
  marked `offersPoMatching`. **Failed** with `viewer.js` stashed.
  Browser 1228/1229 (the known `typography.test.ts` gap); Worker 75/75.
- **`vf-app` `return-route.test.ts`**: a new test returns to a stage
  with no declared permission after an earlier `AP.Code` task there;
  the new task requires `AP.Code`. It **failed** with `return-route.ts`
  stashed. The existing 0490 fallback test (no earlier task there, so
  the returning task's permission) still passes.
- **`vf-app`**, a full, unfiltered run: 127 files and 3097 tests, of
  which **3095 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
