# 0495 — Route To Approver, conditional on Manual mode

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

The fifth and last item of the agreed Coding-pilot sequence (0487's own
list: Timeline/Chat entries, Reassign, Return, a generic comment modal,
Route To Approver). Picked directly by the operator from a 4-option
survey of what remained, then scoped precisely, arriving mid-turn as a
direct correction to a research subagent's own first conclusion:

> Route to Approver should allow manual selection of an approver, if
> the AP Setup Approval Hierarchy is set to Manual. Otherwise, no
> selection of an approver, and follow the employee-supervisor or
> cost-center model.

## What was found

A research pass (see below) traced the existing Approval Hierarchy
machinery before anything was designed, since a naive read of the task
name risked building a second, competing routing system next to one
that already exists.

**Resolution happens exactly once, synchronously, inside `assign_task`
— decision 0439, unchanged since.** `workflow-engine.ts`'s
`visitCurrentStage` evaluates a stage's rule set and, for a stage
marked `uses_approval_hierarchy`, calls `resolveApprovalTargets`
instead of trusting whatever team/user a rule names — the same
"stage's own wins" discipline `required_permission` already has. This
runs the moment the process ADVANCES INTO that stage, which is
triggered by completing every open task on the PRIOR stage
(`onTaskCompleted` → `index.ts`'s own `followUpAfterTaskCompletion` →
`visitCurrentStage`, all inside the same `POST /tasks/:id/complete`
request). There is no later point where a human intervenes — by the
time an Approval task would exist, resolution already ran.

**Manual mode was named but never built.** `ApprovalMode` has always
included `"manual"` in its vocabulary (`org_approval_config`'s own
`CHECK`), but `resolveApprovalHierarchy` treated it exactly like `api`:
fall back to a customer-wide Default Approver, or 409 the whole stage
visit with `reason: "approval_hierarchy_unresolved"` if none was
configured. A customer on Manual mode with no Default Approver could
never even create the Approval-stage task at all.

**No existing "who holds this permission, org-wide" query.** The only
precedent, `handleReassignCandidates`, is team-scoped
enumerate-then-filter — deliberately, since Reassign only ever hands a
task within its own team. Manual mode has no unit or hierarchy to scope
by (that is the entire reason a human is choosing), so this needed its
own, different query.

## What was decided

**The manual picker is offered on the PRIOR task, not the Approval task
— and it REPLACES `complete`, never sits beside it.** Since resolution
runs the moment the prior stage's last task is completed, "Route To
Approver" is what a person clicks instead of "Complete" on that task,
when doing so would otherwise walk straight into Manual mode's own gap.
The server (`task-list-route.ts`'s `actionsFor` / `routeToApproverOffered`)
computes this from two things, both checked before the button ever
appears: the very next stage in this instance's own process version has
`uses_approval_hierarchy = 1`, **and** `org_approval_config.mode ===
"manual"` right now. Neither condition true, and the task offers plain
`complete`, completely unchanged — every customer on Employee-Supervisor
or Cost-Object today sees nothing different, and the extra
`nextStageInSequence` lookahead is not even queried unless the org is on
Manual mode at all (the same "computed once, only where it could
matter" discipline `visitCurrentStage`'s own `collaboratorUserIds`
already follows).

**Completing IS choosing — there is no second action route.** Picking a
name posts the ordinary `POST /tasks/:id/complete`, with a new optional
`targetUserId` field carrying the choice — the same field name Reassign
already uses for the same idea. `resolveApprovalHierarchy`'s own manual
branch reads it (existence-checked, mirroring `handleReassignTask`'s own
`targetExists` guard) and uses it directly, bypassing the Default
Approver fallback entirely. `manualTargetUserId` is threaded straight
through the same call chain the research traced:
`POST /complete` → `onTaskCompleted` → `followUpAfterTaskCompletion` →
`visitCurrentStage` → `resolveApprovalTargets`. Consumed once per
cascade, never re-applied to a second Approval stage the same call might
reach — a shape this process model has never actually produced, but
guarded against on principle.

**Candidates are every org-wide holder of the next stage's own
`required_permission`, not team-scoped** — settled directly with the
operator. Manual mode has nothing to scope a walk by; the honest answer
is the same set a Default Approver setup would need, with a person
choosing among them instead of one name fixed in configuration. One
`json_each` membership query against `org_roles.permissions_json`
(`route-to-approver-route.ts`), not a per-user `hasPermission` loop —
that helper's own unit-scoped override walk does not apply here, since
no unit is named.

**No comment field on the picker**, unlike Reassign's optional one.
`handleCompleteTask` does not accept or store a comment at all today
(decision 0488's own note: "just the column it will eventually fill
in") — a box that silently did nothing would be worse than none.

**Holding the resulting task's `required_permission` is deliberately
NOT re-validated at resolution time.** No other `assign_task` target —
a rule's own `params.user`, an Employee-Supervisor chain's own
escalation — is checked against it at creation either; `POST
/tasks/:id/complete`'s own `hasPermission` gate is where that has
always been enforced, for every path, including this one.

## What was built

- **`workers/vf-app/src/approval-hierarchy.ts`**: `ResolveApprovalParams`
  gained `manualTargetUserId?: string`. `resolveApprovalHierarchy`'s
  manual branch now resolves from it directly (existence-checked) when
  `config.mode === "manual"` and it was supplied; unchanged — still the
  honest "not built" fallback — for every other case, including manual
  mode with nobody chosen.
- **`workers/vf-app/src/workflow-engine.ts`**: `nextStageInSequence`
  exported (it was already exactly the lookahead Route To Approver's
  own candidate route needed) and its own SELECT widened to carry
  `uses_approval_hierarchy`. `visitCurrentStage` gained a trailing
  optional `manualApproverUserId`, threaded into every
  `resolveApprovalTargets` call the cascade makes, consumed once.
- **`workers/vf-app/src/route-to-approver-route.ts`** (new file — a
  separate file, not folded into `task-route.ts`, because that file
  cannot import from the engine without a circular import, the same
  constraint `handleCompleteTask`'s own completion-cascade comment
  already documents): `handleRouteToApproverCandidates` — the same
  ownership standing `handleCompleteTask` itself requires, then the
  two-condition gate (next stage uses Approval Hierarchy; org is on
  Manual mode), then the org-wide candidate query.
- **`workers/vf-app/src/index.ts`**: `POST /tasks/:id/complete`'s body
  parsing widened to also read an optional `targetUserId`, threaded
  through `followUpAfterTaskCompletion` (itself widened the same way)
  into `visitCurrentStage`. New route,
  `GET /tasks/:id/route-to-approver-candidates`.
- **`workers/vf-app/src/task-list-route.ts`**: `TaskAction` gained
  `"route_to_approver"`. `actionsFor` takes a new `offerRouteToApprover`
  flag and swaps `complete` for it when true. New
  `routeToApproverOffered` helper, called and cached once per distinct
  (process, stage, version) across a whole task list, itself gated
  behind "is the org on Manual mode at all" and "does this row have a
  task this person could complete" so it costs nothing for anyone else.
- **`workers/vf-ui/public/icons.js`**: new `route_to_approver` icon — a
  person (the same base `reassign` already uses) with a checkmark badge
  (the same offset-badge composition `recordsupplier` already
  established), distinct from `reassign`'s own arrow-into-a-person: this
  hands nothing over and unlocks nothing, it names who Approval
  Hierarchy should treat as chosen.
- **`workers/vf-ui/public/viewer.js`**: new `openRouteToApproverPicker`,
  the same dedicated-picker shape Reassign's and Return's own already
  established — fetches candidates, shows the "nobody eligible" note
  when empty, posts the choice to `/complete` with `targetUserId`, no
  comment field. `taskActionButtons` dispatches `route_to_approver` to
  it.
- **`workers/vf-licence/migrations/0174_route_to_approver_strings.sql`**:
  the button label, its picker's field label, and the empty-candidates
  note (en/de). No `activity.*` string — completing this task already
  writes the ordinary stage-completed entry; there is no separate
  event.
- **Tests**: new coverage in `approval-hierarchy.test.ts` (the manual
  resolver itself — chosen user wins over Default Approver, a
  nonexistent chosen user reports unresolved, the override is ignored
  outside Manual mode), `workflow-engine.test.ts` (`manualApproverUserId`
  threading through a real cascade), a new
  `route-to-approver-route.test.ts` (the candidates route's own standing
  and gating, org-wide not team-scoped, unit-scoped grants still count),
  `task-list-route.test.ts` (`route_to_approver` replaces `complete`
  exactly when both conditions hold, never otherwise, never on a task
  that isn't theirs yet), `index.test.ts` (two full HTTP-level
  end-to-end cascades: a real `targetUserId` routing correctly, and a
  stray one being silently ignored where Approval Hierarchy never
  applies), and `viewer.test.ts` (the picker itself: real candidates,
  the empty-candidates alert, posting to `/complete` not a separate
  route, no comment field, server error handling).

## What was not built

No change to Employee-Supervisor or Cost-Object resolution at all —
both run exactly as before, and neither stage never even computes
`routeToApproverOffered`'s own lookahead unless the org is on Manual
mode. `api` mode remains named but unbuilt, unchanged. No activity-feed
entry specific to a manually routed approval — the ordinary
stage-completed entry already covers it, the same as every other
resolution mode. No re-validation, at resolution time, that the chosen
approver actually holds the resulting task's permission — deliberately
consistent with how every other `assign_task` target has always worked;
`POST /tasks/:id/complete`'s own gate is where that has always been
enforced. Non-PO Approval routing (decisions 0468/0469/0471) is
unaffected — it is checked ahead of mode dispatch in
`resolveApprovalTargets`, so a Business-Approver-routed invoice
pre-empts a manual choice exactly the way it already pre-empts Cost
Object; a manually chosen approver posted alongside a Non-PO-routed
invoice is simply never consulted, the same silent-no-op every
already-resolved mode gives an unused parameter.

## Verification

- `node --check public/viewer.js public/icons.js`: clean. `npx eslint`
  across every touched file in `workers/vf-app/src`,
  `workers/vf-app/test`, `workers/vf-ui/public`,
  `workers/vf-ui/test-browser`: clean (confirmed the four pre-existing
  unrelated failures it does report — `index.ts`'s own unused
  `loadStoredInvoiceLines`, two unused test locals and one unused arg in
  `workflow-engine.test.ts` — are identical on an unmodified checkout).
- `workers/vf-app`: `approval-hierarchy.test.ts` **43/43** (39 carried
  forward, 4 new). `workflow-engine.test.ts` **71/71** (68 carried
  forward, 3 new). `task-list-route.test.ts` **66/66** (62 carried
  forward, 4 new). `route-to-approver-route.test.ts` (new)
  **8/8**. `index.test.ts` **196/196** (194 carried forward, 2 new).
  `task-route.test.ts` **84/84**, unchanged. `dashboard.test.ts`,
  `unit-config.test.ts`, `scoped-roles.test.ts`, `invoice-org.test.ts`,
  `ar-process.test.ts`, `expense-process.test.ts` all pass; `stage-
  permissions.test.ts`'s one failure (a permission named in SQL but not
  in code, `AP.Manager`) is confirmed pre-existing and unrelated on an
  unmodified checkout.
- `workers/vf-licence`: `string-coverage.test.ts` **10/10**; full suite
  **320/320**, unchanged.
- `workers/vf-ui`: `viewer.test.ts` (browser) **228/228** (223 carried
  forward, 5 new). Full unfiltered browser suite (all 48 files)
  **1152/1156** — the 4 remaining failures are `typography.test.ts`'s
  own pre-existing `app.css` finding and three `dashboard.test.ts`
  date-relative assertions confirmed to fail identically, by the same
  margin, on an unmodified checkout (a pre-existing off-by-one in how
  those tests compute "N days overdue" against the real current date —
  unrelated to this decision, not touched here).

## Still to do, operator side

Push and deploy `vf-app` and `vf-ui`, and deploy `vf-licence` with
migration `0174_route_to_approver_strings.sql` applied. Once live: set
AP Setup's own Approval Hierarchy to Manual, configure a process where
some stage after a Coding/Validation-type one has "Uses Approval
Hierarchy" on (today only settable directly in the database — no AP
Setup screen exposes `uses_approval_hierarchy` yet, unchanged by this
decision), and confirm completing the prior task now offers "Route To
Approver" in place of "Complete," opens a picker of everyone holding the
next stage's own permission, and that choosing one creates the Approval
task assigned to exactly them. Then switch Approval Hierarchy back to
Employee-Supervisor or Cost-Object and confirm the button reverts to
plain "Complete" with no picker at all.
