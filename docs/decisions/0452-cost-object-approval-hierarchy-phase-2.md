# 0452 — Cost-Object Approval Hierarchy, Phase 2

**Status: built and tested, not yet pushed or deployed.** No
confirmation has been reported yet — this decision has not been
through the two-stage delivery cycle every prior one in this project
has.

---

## What was asked

*"Yes, lets move on"* — explicit approval to begin Phase 2, once Phase
1 (decision 0451, Line Level Account Coding) had been delivered and
confirmed. Phase 2 itself was already scoped by decision 0450's own
design document and the operator's own settled answers from that
round:

- **Multi-dimension routing** — Cost Centre, Project, Commodity Code,
  and GL Code, not Cost Centre alone.
- **"Parallel across cost objects," given directly**: *"I had
  envisaged that multiple approval requirements for each line as a
  result of different cost center, would spawn multiple tasks that
  could be completed in parallel."* 0184's own literal reading, not
  the mock-up's own tentative "highest-priority dimension wins"
  assumption — that assumption predated the operator settling the
  question either way, and is not what this decision builds.
- **Turn decision 0450's own mock-up into real screens** —
  `ap-setup.js`'s Cost-Object Priority panel, `coding-lists.js`'s
  Approval Limit column.

## What was found

**The single hardest constraint was `resolveApprovalHierarchy`'s own
existing shape.** `workers/vf-app/test/approval-hierarchy.test.ts` has
roughly fifteen tests, all real and all passing, asserting a single
`ApprovalResolution | ApprovalUnresolved` object back from that
function via `toMatchObject`/`toEqual`. Widening its own return type to
an array would have been a breaking change to a deployed, tested
resolver for the sake of one mode that needed more than one answer.
**Decided against, in favour of a new, parallel entry point** —
`resolveApprovalTargets` — rather than reshape what already works.
`resolveApprovalHierarchy` is completely unchanged by this decision,
still what every one of those fifteen tests calls, still what every
mode but Cost-Object resolves through (wrapped in a one-element array
by the new function, for the caller's uniform benefit).

**`onTaskCompleted`'s own advancement gate needed no change at all** —
checked directly rather than assumed, since it is the other half of
"multiple tasks completed in parallel" actually working. It counts
open tasks by `stage_visit_id` alone, with no per-line or per-dimension
distinction:

```
SELECT count(*) AS n FROM tasks WHERE stage_visit_id = ? AND status = 'open'
```

Several tasks sharing one `stage_visit_id` — which multiple targets for
one line already do, once `workflow-engine.ts`'s own loop creates one
task per resolved target — already correctly block advancement until
every one of them is completed. Nothing here needed building; it
needed proving, which the new end-to-end test in
`workflow-engine.test.ts` does directly.

## What was built

- **`resolveApprovalTargets`** (`workers/vf-app/src/approval-
  hierarchy.ts`), the new plural entry point `workflow-engine.ts` now
  calls instead of `resolveApprovalHierarchy`. Every mode but
  Cost-Object delegates straight through to the unchanged singular
  resolver, wrapped in a one-element array. Only Cost-Object mode
  calls the new `resolveCostObjects`.
- **`resolveCostObjects`**: resolves every dimension that is both
  **enabled** (the new `cost_object_dimensions` config table) **and
  has a coded value on the line**, independently. A dimension with no
  coded value is not consulted — not applicable, not a failure. A line
  with nothing coded to any enabled dimension gets exactly the single
  "no cost-object information" default/unresolved result
  `resolveCostObject` (singular, unchanged, still what this function
  falls back to) always gave.
- **`resolveChainFor`**: the generalized chain walk. Dispatches to the
  existing, untouched `resolveApprovalChain` for `cost_centre`; for
  the other three dimensions, walks `coding_list_entries` — same rule,
  same table shape, same climb-while-uncovered/stop-at-first-covering-
  owner/null-limit-is-unlimited convention `cost_centres` already
  established. "Generalized, not rewritten," per decision 0450's own
  stated design principle.
- **`CostObjectDimension` type, `COST_OBJECT_DIMENSION_FIELDS`** (which
  vocabulary field each dimension's coded value comes from —
  `cost_centre`→`BT-133`, `project`→`coding.project`, etc.), and
  `ResolveApprovalParams.costObjectValues` — added additively,
  alongside the existing `costCentreId`, not replacing it.
- **`workflow-engine.ts`'s task-creation loop, restructured**: computes
  a `targets: Array<{teamId?, userId?}>` — the single existing
  team/user for every ordinary stage, or one entry per resolved
  cost-object dimension for a Cost-Object-mode stage — then loops,
  creating one task per target, all sharing the same `stage_visit_id`
  and `lineNumber`. **All-or-nothing**: any unresolved dimension
  refuses the whole stage visit with a 409
  (`approval_hierarchy_unresolved`), the same discipline decision 0439
  already applied to a single unresolved chain — never some of a
  line's approval tasks created and the rest silently skipped.
- **Migration `0077`**: `approval_limit` added to `coding_list_entries`
  (the missing half of what Cost Centre already has — same nullable
  `REAL`, same non-negative `CHECK`); a new `cost_object_dimensions`
  table (`list_type_id`, `enabled`, `sequence`), seeded with only
  `cost_centre` enabled — **zero behaviour change on deploy**, since
  nothing routes differently until an operator deliberately turns a
  new dimension on. `sequence` is display order for AP Setup's own
  panel, explicitly documented as **not** a resolution priority.
  Replayed clean: 77 migrations, 174 standing invariants, all held.
- **`coding-list-route.ts` extended** with `approvalLimit` on the
  three greenfield lists (create and update), mirroring
  `ledger-route.ts`'s `handleUpdateCostCentre` exactly — including its
  own existing quirk, deliberately replicated rather than "fixed" for
  consistency between the two parallel code paths: a limit can only be
  set in the same request that also names the owner, even if the entry
  already has one from a prior call.
- **`approval-config-route.ts` extended**: `GET /approval-config` now
  also returns `costObjectDimensions` (joined with `coding_list_types`
  for display names); a new `PUT /approval-config/cost-object-
  dimensions` (`handleSetCostObjectDimensions`) validates an array of
  `{listTypeId, enabled, sequence}`, refuses an unknown dimension
  (`company_code` is not a valid cost-object dimension) or a duplicate
  in one call, and only ever `UPDATE`s the four seeded rows — never
  creates or deletes one. Wired into `index.ts` following the exact
  `Admin.Configure`/JSON-body pattern its sibling routes already use.
- **`ap-setup.js`'s real Cost-Object Priority panel**, replacing
  decision 0450's mock-up. Shown only when Mode reads Cost-Object. The
  copy is corrected for what the operator actually settled — every
  enabled, coded dimension raises its own task, in parallel, not
  first-match-wins — rather than the mock-up's own pre-decision
  wording. Reordering reuses `processes.js`'s own drag control for
  process stage sequencing (decision 0352) rather than the mock-up's
  own bespoke up/down buttons and switch styling, which nothing else
  in this app's real screens has; a plain checkbox and the existing
  `.assignmentrow` layout are used instead, matching this tab's own
  override-list rows. Every toggle or reorder saves immediately,
  sending the full four-row array — the same "replace, not merge"
  shape this tab's own mode form already uses.
- **`coding-lists.js`'s Approval Limit column and field**, added to
  Project, Commodity Code, and General Ledger Code's own tables and
  forms, in the same place Cost Centre's own already sits — reusing
  that field's own existing string (`apsetup.codingapprovallimit`)
  rather than a second copy of the same word. Always sent alongside
  the approver in the same request, so the route's own "a limit needs
  an owner in the same call" rule never surprises this screen.
- **A new `ui_strings` migration**,
  `workers/vf-licence/migrations/0153_cost_object_priority_strings.sql`
  — the Cost-Object Priority panel's own four new keys, en/de.
  `workers/vf-licence/test/setup.ts` and `string-coverage.test.ts`
  updated to apply and require them.

## What was not built

- **No Coding stage, no enforcement of a keyed value against Account
  Coding's own lists, no `AP.Code` wiring.** All three are decision
  0451's own named, separate, still-unbuilt scope — untouched here,
  since this decision only ever concerned routing once a value already
  exists on a line, not how it gets there.
- **No apportioning of one line's amount across more than one cost
  object.** Every dimension a line resolves is tested against that
  line's own full net amount (`BT-131`) — the same per-line-amount
  convention decision 0439 already established and decision 0450 named
  as deliberately kept, not reopened here either.

## Verification

Targeted, given the `vf-app` full-suite timeout decisions 0448, 0449,
and 0451 already hit and recorded. `workers/vf-app/test/approval-
hierarchy.test.ts` **30/30** (21 pre-existing + 9 new, proving
`resolveApprovalTargets`/`resolveCostObjects` directly: single-
dimension backward compatibility; a dimension skipped when uncoded or
disabled; two enabled, coded dimensions resolving independently — the
operator's own envisaged design, not first-match-wins; chain
escalation via `parent_entry_id`; and the no-applicable-dimension
fallback matching the old singular behaviour exactly), `test/workflow-
engine.test.ts` **53/53** (51 pre-existing + 2 new end-to-end tests —
a line coded to two enabled dimensions raises two real tasks, gated by
the existing, unchanged `stage_visit_id`-scoped completion count, and
an all-or-nothing 409 when one of two coded dimensions can't resolve,
with zero tasks created), run together with `test/coding-list-
route.test.ts`, `test/coding-list-csv-route.test.ts`, `test/accounting-
frame.test.ts`, and `test/approval-config-route.test.ts` — **213/213**
across all six files in one run. `migrations/apply_migrations.py
--replay-only` clean — 77 migrations, 174 standing invariants, all
held. `workers/vf-licence`'s full suite **320/320** (unchanged in
count — migration `0153` adds rows to the existing `ui_strings` table,
not a new test file), including `string-coverage.test.ts` **10/10**
with the four new keys added to `KEYS_THE_INTERFACE_USES`, confirmed
by one unfiltered whole-suite run. `workers/vf-ui` Worker suite 74/74
(unchanged — no route or proxy file touched), browser suite
**1040/1040** (1034 + 6 new — 1 in `coding-lists.test.ts`, 5 in
`ap-setup.test.ts`), confirmed by an unfiltered whole-suite run (48
files); the pre-existing `document-window.test.ts` unhandled-rejection
flake is present at its identical, already-documented baseline count
(160 non-fatal errors), unrelated to this decision.

## Still to do, operator side

Push, deploy, and apply migrations `0077` (`vf-app`) and `0153`
(`vf-licence`) once confirmed. Then: decide where and how a line
actually gets coded to a Project, Commodity Code, or GL Code in the
operator's own live process (decision 0451's own leftover, named there
and restated here since it is the one remaining gap between this
routing now working and an operator actually seeing more than one
approval task per line in practice) — a Coding stage using `AP.Code`,
a customer-defined field, or something else, genuinely a separate
decision.
