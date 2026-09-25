# 0490 — Return-target stage configuration, and the AP Setup screen for it

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Step three of the agreed five-decision Coding-pilot sequence (decision
0489's own "Still to do, operator side": *"Return-target stage
configuration and the AP Setup screen is next in the agreed
sequence"*).

## What was decided

**Tracing the request turned up a real, pre-existing functional gap:
Return has never worked from the live UI.** `handleReturnToStage` (the
route behind `POST /tasks/:id/return`) has required a `stageId` plus
exactly one of `assignToUser`/`assignToTeam` since decision 0075, but
`viewer.js`'s own `runAction()` — the only thing that ever called this
route — only ever prompted for a reason. Nothing collected a `stageId`
or an assignee. Every Return click has 400'd since the route existed.
This reframed "Return-target stage configuration" from a config-screen
nicety into the thing that actually makes Return reachable at all: the
picker UI itself, plus an admin-configurable curated list of targets to
drive it, so the picker never offers a stage-and-team combination the
server would then refuse.

**Found and fixed a second, real bug along the way:** `handleReturnToStage`
was setting the newly-created task's `required_permission` to the
*returning* task's own permission, rather than the *target* stage's own
declared `process_stages.required_permission`. Every other task-creation
path in this codebase (`workflow-engine.ts`'s `requiredPermission ??
stage.required_permission ?? params.permission`, decision 0471) resolves
this from the stage being moved *to*; Return alone had never followed
that precedent, and had no test coverage on the value at all. Fixed with
a lookup of the target stage's own `required_permission`, falling back
to the returning task's own when the target declares none.

**A new table, `stage_return_targets`, not a column on `stage_actions`.**
A stage can offer more than one return target (a list), and
`stage_actions`'s shape is one row per (stage, action) — it can hold only
one flag per action, the way `reverify_rule_on_complete` already does for
`action = 'complete'` — not a list. Migration 0085 follows migration
0082's own stated design philosophy for exactly this shape of problem.

**Return targets name a team, not a person.** The same default
`workflow-engine.ts`'s own `assign_task` already uses: a rule names a
team, and a specific individual is the approval-hierarchy resolver's own
special case, not the general one. Naming a team also avoids the
configured list going stale the moment a named individual changes teams.

**The runtime picker's candidates are a server-computed intersection,
not either raw list alone** — the same philosophy decision 0489's own
Reassign candidates used. `GET /tasks/:id/return-targets` intersects the
admin-configured `stage_return_targets` list for the task's current
stage with the actual `stage_visits` history for that specific process
instance. Offering every admin-configured target regardless of whether
this document ever visited it would let a document skip stages it never
went through; offering every visited stage regardless of configuration
would offer no assignee at all for stages the operator has not curated.

**A dedicated picker, the same shape Reassign's own established** —
not the generic comment-and-OK/Cancel modal, which is still its own,
later, separate decision in the sequence. `openReturnPicker` mirrors
`openReassignPicker` closely: a `<select>` of server-supplied targets
(keyed by `stageId`, since `stage_return_targets`'s own unique index on
`(source_stage_id, target_stage_id)` already makes a `stageId` unique
within one task's own candidate list — no composite value needed), a
reason field, and an inline error box.

**The reason is mandatory, unlike Reassign's optional comment** —
decision 0075's own unchanged rule. Rather than duplicate that
validation client-side, the picker sends whatever is typed, including
nothing, and lets the server's own 400 speak through the same
`errorBox` every other picker failure already uses.

**The team list needed by AP Setup's new add-row form is exposed via
`GET /processes/:id`, not `GET /org/teams`.** That existing route only
accepts `Admin.RoleManagement`/`Admin.UserManagement` — not
`Admin.Configure`, which is what gates AP Setup and this feature's own
new admin routes. Widening an existing route's authorization is a
security-sensitive change to something already shipped, and out of
scope for this decision; `/org/overview` already established the
precedent of a route accepting `Admin.Configure` directly for exactly
this kind of screen. The org's team list is embedded as a new top-level
`teams` field on the already-correctly-gated `GET /processes/:id`
response instead.

**Batched-query-then-merge, not a fan-out join**, for attaching each
stage's own return targets to `stagesAtVersion()`'s result — the same
shape `activity-route.ts`'s own multi-kind reads already use, and the
same reasoning: a `LEFT JOIN` would multiply each stage's row once per
target.

## What was built

- **`migrations/0085_stage_return_targets.sql`**: `stage_return_targets`
  (`id`, `source_stage_id`, `target_stage_id`, `team_id`, `created_at`),
  a unique index on `(source_stage_id, target_stage_id)`, a non-unique
  index on `source_stage_id`, and a `CHECK (source_stage_id !=
  target_stage_id)`. ASSERT/ASSERT ALWAYS invariants: empty at
  point-in-time; source/target stage ids and team id all exist;
  source ≠ target; both stages belong to the same process.
- **`workers/vf-app/src/return-route.ts`**:
  `handleReturnToStage`'s `required_permission` bug fixed — a lookup of
  the target stage's own `process_stages.required_permission`, falling
  back to the returning task's own when the target declares none; new
  exported `handleReturnTargets(db, taskId, user)` — checks standing,
  finds the task's process instance via its `stage_visit_id`, and
  returns the intersection of `stage_return_targets` (configured for the
  task's current stage) with `stage_visits` (actually visited in this
  instance), each row carrying `stageId`, `stageName`, `teamId`,
  `teamName`.
- **`workers/vf-app/src/stage-return-targets-route.ts`** (new):
  `handleAddStageReturnTarget(db, sourceStageId, body)` — validates
  `targetStageId`/`teamId` present, target ≠ source, both stages exist
  and share a process, the team exists, and the pair is not already
  configured (409 if so); `handleRemoveStageReturnTarget(db, id)` — 404
  if nothing was deleted, else 200.
- **`workers/vf-app/src/process-route.ts`**: `StageDetail` widened with
  `returnTargets`; `stagesAtVersion()` batches one extra query for every
  stage's own configured targets and merges them in; `handleGetProcess()`
  adds a top-level `teams` field, sidestepping `/org/teams`'s own
  narrower authorization.
- **`workers/vf-app/src/index.ts`**: `GET /tasks/:id/return-targets`,
  `POST /processes/stages/:id/return-targets` and `DELETE
  /processes/stages/return-targets/:id` (the latter two gated
  `Admin.Configure`, the same as every other AP Setup route).
- **`workers/vf-ui/public/viewer.js`**: `ACTIONS_NEEDING_A_REASON`
  narrowed to `["return_to_supplier", "discard"]` — Return moved to its
  own picker and no longer goes through the old `prompt()` flow; new
  `openReturnPicker(task, onClose)`, wired into `taskActionButtons()`'s
  dispatch alongside Reassign's own special-case.
- **`workers/vf-ui/public/ap-setup.js`**: `addStageReturnTarget()` /
  `removeStageReturnTarget()` fetch helpers; inside Stage Restrictions'
  per-stage panel, a new "Return targets" section — sitting outside the
  `offered`/`!offered` branch, the same reason `reverifyToggleRow`
  already does — listing configured targets with Remove buttons, and an
  add-row form (a target-stage picker plus a team picker) that only
  renders once there is at least one other stage and one team to offer.
- **`workers/vf-ui/src/index.ts`**: the three new routes added to the
  proxy allowlist in the same change that added them.
- **`workers/vf-licence/migrations/0170_return_target_strings.sql`**
  (new): 8 keys × `en`/`de` for the picker and the AP Setup section;
  reuses `action.return`, `apsetup.add`, `roles.remove`, and
  `apsetup.stagerestrictions.savefailed` directly rather than
  duplicating them.
- **Also fixed, found mid-way through this work**: `apsetup.add` and
  `roles.remove` are real, seeded strings (migrations 0096/0145) that
  `ap-setup.js`'s pre-existing Approval Hierarchy override sections
  already used, but neither had ever been added to
  `string-coverage.test.ts`'s hand-maintained key list — the same
  "found while doing unrelated work" move decision 0485 made once
  before. Added alongside this decision's own new keys.
- Tests:
  `workers/vf-app/test/return-route.test.ts` — 2 new cases for the
  `required_permission` fix (target stage's own permission wins; falls
  back to the source's when the target declares none), plus a new
  describe block with 5 cases for `handleReturnTargets` (offers
  configured-and-visited; excludes configured-but-unvisited; excludes
  visited-but-unconfigured; 403 without standing; 404 on an unknown
  task).
  `workers/vf-app/test/stage-return-targets-route.test.ts` (new) — 11
  cases covering both handlers: success, missing-field 400s, self-target
  422, nonexistent source/target/team 404s, cross-process target 422,
  duplicate-pair 409, the same target from a different source allowed,
  successful removal, 404 on an unknown removal id.
  `workers/vf-app/test/process-route.test.ts` — 3 new cases: a new stage
  defaults to an empty `returnTargets`; a configured target carries
  through with resolved names, and the other stage has none; every org
  team is returned at the top level via `body.teams`.
  `workers/vf-app/test/index.test.ts` — a new describe block with 5
  cases through the real router: 401 with no credentials; an empty
  targets list until configured; 403 configuring without
  `Admin.Configure`; a successful removal; and a full end-to-end case
  (configure a target → read it back through the picker's own route →
  post a Return using it → confirm the new task lands with the correct
  `owner_team_id` and, proving the permission fix, the target stage's
  own `required_permission`).
  `workers/vf-licence/test/string-coverage.test.ts` — the 8 new keys,
  plus `apsetup.add`/`roles.remove` for the pre-existing gap.
  `workers/vf-ui/test/index.test.ts` — 3 new `CALLED_BY_A_SCREEN`
  entries for the proxy allowlist.
  `workers/vf-ui/test-browser/viewer.test.ts` — one pre-existing test
  ("treats an empty reason as no reason") updated from the now-retired
  `return` prompt flow to `return_to_supplier`, the one action left on
  `ACTIONS_NEEDING_A_REASON` that still exercises it; a new describe
  block with 5 cases for `openReturnPicker`: targets rendered from the
  server's own response, the "nothing configured" note in place of an
  empty picker, a successful submit posting `{stageId, assignToTeam,
  reason}` and closing, the server's own validation error shown inline
  when the reason is left blank, and a general failure leaving the
  picker open to retry.
  `workers/vf-ui/test-browser/ap-setup.test.ts` — a new describe block
  with 9 cases for the Return targets section: the empty-state message
  and no add-row form on a single-stage process; the add-row form hidden
  when stages exist but no teams do; the add-row form's own options once
  both exist; a configured target shown with its Remove button; a
  successful add POSTing `{targetStageId, teamId}`; a successful removal
  DELETEing by id; and the server's own error shown for a failed add and
  a failed removal.

## What was not built

**The generic comment-and-OK/Cancel modal, Route To Approver's
manual-approver picker, and Return To Seller's reason/email dropdowns**
— none of them attempted here, unchanged scope from decisions 0488 and
0489.

No change to Claim, Release, Complete, Reassign, Return To Supplier, or
Discard's own handlers.

## Verification

- `workers/vf-app`: `return-route.test.ts` **28/28** (21 pre-existing, 7
  new); `stage-return-targets-route.test.ts` **11/11** (new file);
  `process-route.test.ts` **71/71** (68 pre-existing, 3 new);
  `index.test.ts` in full **194/194** (189 pre-existing, 5 new). Full
  suite (`vitest run`, all files together) **2935/2937 passing** — the
  2 remaining failures are `capture-pdf.test.ts`'s "writes the corrected
  value back, not just an audit row" and `stage-permissions.test.ts`'s
  "names exactly the permissions the code defines", both confirmed
  pre-existing and unrelated via `git stash` comparison in an earlier
  segment of this same session, not a regression from this decision.
  `tsc --noEmit` shows no new errors in any file this decision touched
  (only the same pre-existing `cloudflare:test`/workload-report noise
  already documented in prior decisions).
- `workers/vf-licence`: `string-coverage.test.ts` **10/10**; migration
  chain replays clean (170 migrations, all assertions held).
- `workers/vf-ui`: `index.test.ts` (proxy allowlist) **74/74**;
  `ap-setup.test.ts` (browser) **57/57** (48 pre-existing, 9 new);
  `viewer.test.ts` (browser) **219/219** (214 pre-existing, 5 new); full
  browser suite (`vitest run --config vitest.browser.config.ts`, all
  files together) **1146/1147 passing** — the 1 remaining failure is
  `typography.test.ts`'s "hardcodes none of them" flagging a pre-existing
  `font-size: 10px` in `app.css`, confirmed present and failing
  identically on an unmodified checkout (`git stash`), not touched by
  this decision. `tsc --noEmit` shows no new errors in any file this
  decision touched.
- `migrations/apply_migrations.py --replay-only`: 85 migrations, all
  assertions held.

## Still to do, operator side

Push and deploy `vf-app`, `vf-ui`, and `vf-licence` (new migrations 0085
for `vf-app`, 0170 for `vf-licence`). Once live: as an operator holding
`Admin.Configure`, configure a return target on the AP Setup screen's
Stage Restrictions tab (add another stage and a team, confirm it lists
with a Remove button, confirm Remove works); then, as a task holder,
click Return on a task at a stage with a configured-and-visited target,
confirm the picker lists it, submit with a reason, and confirm the
document lands at the target stage owned by the chosen team — this is
the first time Return has ever worked end to end from the live UI. Then:
the generic comment-and-OK/Cancel modal is next in the agreed sequence.
