# 0471 — The Business Approver Role

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

After decision 0470 ("Add person to conversation," Phase 2) shipped
and was confirmed live, the operator was asked directly which of the
two remaining candidates from decision 0468's own original scope to
pursue next: `Procurement.Approve` (a Business User completing an
approval task), or removing a collaborator. **The answer, verbatim:**
*"Yes, please build out number 1, this should be an Business Approver
role, with permissions to Approve an invoice for payment in the
Approval stage. The invoice can be routed to 1, or multiple approvers,
and the user will have access to an Approve button in the Invoice
Viewer page."*

Three genuinely consequential design questions were identified by
investigation before any code was written, and put to the operator
directly rather than assumed:

1. **When an invoice routes to multiple Business Approvers, what
   completes the stage?** Answered: **all must approve (unanimous)**.
2. **Who gets routed** — every collaborator holding the role, or only
   the earliest-added one (decision 0469's own original "requester"
   concept)? Answered: *"For Non-PO invoices all users who require to
   provide approval should be added as collaborators. When they
   approve they are approving their own capacity, based on the invoice
   line(s) they are responsible for."* — **every qualifying
   collaborator**, not one.
3. **How does a Business Approver find the invoice at all**, given
   `GET /tasks` has required `AP.TaskView` since decision 0276 and a
   Business Approver was never going to hold it? Answered: *"It should
   be a task allocated in the Tasks list for the Approval user. They
   should have access to a list of items that they own, and nothing
   more."*

## What was found

**Decision 0469 built the plumbing for this and deliberately left the
two hardest parts undone.** `invoice_collaborators` (migration 0078)
and `Procurement.Approve` (`permissions.ts`) both already existed;
`resolveNonPoRequester` already routed a Non-PO invoice to a single
collaborator when `org_approval_config.route_non_po_to_requester` was
on. What it never did — named honestly as reserved, not silently
assumed to work — was let that person actually **complete** the task
it created for them.

**The gap: every task at a stage inherited the stage's own
`required_permission`, regardless of which resolver produced its
target.** `workflow-engine.ts`'s task-creation loop set
`requiredPermission: stage.required_permission ?? params.permission`
unconditionally. An Approval stage's own `required_permission` is
`AP.Approve` — AP staff's permission, not `Procurement.Approve`. A
Non-PO invoice routed to a Business Approver would have created a task
that Business Approver could never complete: right person, wrong lock
on the door.

**`resolveApprovalHierarchy`'s own single-target contract could not
represent "route to one or more Business Approvers" at all.** It
returns exactly one `ApprovalResolution`; decision 0469's own
`requesterUserId` picked the earliest-added collaborator specifically
because the function could only ever answer with one person. The
operator's own instruction — every qualifying collaborator routed, in
parallel, each approving "in their own capacity" — needed the plural
entry point (`resolveApprovalTargets`, decision 0452's own
Cost-Object generalization) to carry Non-PO routing instead, and
`resolveApprovalHierarchy` to stop trying to represent it at all
rather than silently picking one over the operator's own answer.

**`task-route.ts`'s completion path needed no changes.** Its own doc
comment already says the permission check happens in `index.ts`, read
per-task from `tasks.required_permission` rather than hardcoded per
route — confirmed directly this session. So was `task-list-route.ts`'s
`actionsFor()`: it already gates `"complete"` on
`permissions.has(row.required_permission)`, whatever that value is.
**Fixing what gets written into `required_permission` at task-creation
time was the whole fix** — nothing downstream needed to change to
honour it.

**`GET /tasks` needed widening, not rebuilding.** Its own base query
already restricts to `owner_user_id = me OR owner_team_id IN (my
teams)` — a Business Approver, holding no team membership and only
ever the target of named-user tasks, was already going to see only
their own once let in at all. The screen-level `AP.TaskView` gate in
front of it was the only thing standing in the way, and forcing
`ownership: "mine"` for this narrower grant is what turns "the query
already only returns what's theirs" into "and nothing more" even
against a mischievous `?ownership=available` on the wire.

**No new schema.** `invoice_collaborators`, `org_approval_config`, and
`Procurement.Approve` in the closed permission vocabulary all already
existed and are already live. This decision changes only what gets
computed and written with them.

## What was built

- **`approval-hierarchy.ts`**: `ApprovalResolution` gained an optional
  `requiredPermission` field — absent means exactly today's behaviour
  (fall back to the stage's own permission), present is a resolver's
  own system-computed override, not a rule author's input, so decision
  0200's "the stage's own wins" (which governs rule authors, not
  resolvers) is untouched. `ResolveApprovalParams.requesterUserId`
  (singular) renamed to `collaboratorUserIds` (the whole list).
  `resolveNonPoRequester` (sync, single-target) replaced by
  `resolveNonPoApprovers` (async — checking who "actually holds" a
  permission needs a database read per candidate): resolves to every
  candidate who holds `Procurement.Approve`, each carrying
  `requiredPermission: "Procurement.Approve"`; empty or none-qualify
  falls through to the configured mode unchanged, the same honest-gap
  discipline decision 0469 already established. `resolveApprovalHierarchy`
  no longer checks Non-PO routing at all — it cannot represent more
  than one target — so `resolveApprovalTargets` is now the only place
  this is checked, ahead of every mode including Cost-Object, same
  precedence as before.
- **`workflow-engine.ts`**: `resolveInvoiceRequester` (single row,
  `LIMIT 1`) replaced by `resolveInvoiceCollaboratorIds` (every row);
  narrowing down to actual Business Approvers is now
  `resolveNonPoApprovers`'s own job, not this function's. The
  task-creation loop's `targets` array now carries an optional
  `requiredPermission` alongside `teamId`/`userId`, used in place of
  `stage.required_permission` when a resolution names one — additive,
  every other resolver (Employee-Supervisor, Cost-Object, Manual, API,
  and the non-approval-hierarchy `assign_task` branch) falls through
  unchanged.
- **`index.ts`**: `GET /tasks`'s screen-level gate widened from
  `AP.TaskView` alone to `AP.TaskView OR Procurement.Approve` — the
  latter forces `ownership: "mine"` server-side regardless of the
  `ownership` query parameter, so "a list of items they own, and
  nothing more" is enforced against the request, not left to a client
  choosing not to ask for `available`/`locked`.
- **`permissions.ts`**: `Procurement.Approve`'s description and the
  Business User category comment corrected from "reserved, no route
  yet" to name what it now actually gates, the same correction
  decision 0470 already made for `Procurement.Collaborate`.
- **`viewer.js`**: `taskActionButtons` now passes `label: t("action.approve")`
  to the existing `"complete"` action's own `actionLink` call when
  `task.requiredPermission === "Procurement.Approve"` — the same
  `label` override decision 0374 already added `actionLink` for
  Purchase Orders' own "Load CSV"/"CSV Template". **Same action, same
  route** (`POST /tasks/:id/complete`) every other stage's task
  already uses; only the button's own text changes, read directly off
  data the task already carries rather than guessed from the stage's
  name. No decline/reject path was asked for or built — Approve-only,
  matching literally what was asked; a Business Approver holds none of
  `AP.Return`/`AP.ReturnToSupplier`/`AP.Discard` so none of those
  actions can appear for them regardless.
- **One new `ui_strings` key**, `action.approve`, en/de
  (`workers/vf-licence/migrations/0159_business_approver_approve_action_string.sql`),
  wired into `test/setup.ts` and required by `string-coverage.test.ts`
  the same way decision 0470's own five keys were.
- **Two pre-existing, unrelated test-infrastructure bugs found and
  fixed along the way**, both in `vf-ui`, both surfaced only because
  this decision's own new tests were the first to actually exercise
  `viewer.test.ts` with `collaborators.js` loading successfully:
  - `vitest.browser.config.ts` was missing an alias entry for
    `/collaborators.js` — decision 0470 added the file and imported it
    from `viewer.js` by absolute path, the same way every other
    browser module here is imported, but never added the matching
    entry this config's own manually-maintained alias map requires.
    Every test in `viewer.test.ts` failed at import time as a result
    (232 of 261), not just the ones actually about collaborators —
    this decision's own new tests would have failed to even load
    without the fix, so it was not optional.
  - `viewer.test.ts`'s shared `stubFetch()` helper gained the same
    default fallback the `/pages` route already has, for
    `/api/documents/:id/collaborators` — `collaborators.js` fetches
    this the moment any task carrying an invoice subject opens the
    Timeline / Chat tab, which is most of this file's own fixtures,
    none written with this fetch in mind since the module could not
    previously load at all.
  - **Not fully fixed**: roughly fifteen to twenty independent, inline
    `vi.stubGlobal("fetch", …)` mocks elsewhere in `viewer.test.ts` and
    in `tasks.test.ts` — predating this decision, from decision 0470's
    own work — still lack this stub (and, in at least one case, the
    equally pre-existing `/api/documents/:id/activity` one). Running
    the full file now surfaces these as **unhandled promise
    rejections**, not test failures — every one of the 261 actual
    assertions in `viewer.test.ts` still passes, and the process's
    exit code is nonzero only because of the rejection noise. This
    suite was not effectively gating anything before this session (it
    could not even import successfully), so nothing regressed; fully
    remediating every inline mock is real but separate test-fixture
    debt, flagged here as a named follow-up rather than attempted
    inside this decision's own diff.

## What was not built

**A "My Approvals" list screen distinct from Tasks** — the operator's
own answer named the Tasks list itself, not a new one, so `GET /tasks`
was widened rather than a second screen built beside it. **Per-line
approval targeting** — the operator's own phrase, "approving their own
capacity, based on the invoice line(s) they are responsible for,"
describes how a Business Approver reasons about their own decision,
not a system-enforced mapping of which collaborator owns which line;
nothing in `invoice_collaborators` records that association today, and
building one was not asked for. **Any-one-sufficient completion** —
settled as unanimous; the existing `stage_visit_id`-scoped gate
(`onTaskCompleted`, decision 0452) already enforces this with zero
further changes, since every Business Approver's task shares one
stage_visit like Cost-Object mode's own multiple targets already do. A
decline/reject action for a Business Approver — not asked for,
Approve-only. Removing a collaborator — still decision 0470's own
named gap, untouched here.

## Verification

`workers/vf-app/test/approval-hierarchy.test.ts` — **39/39**, its
Non-PO Approval routing block rewritten: one test confirming
`resolveApprovalHierarchy` no longer routes Non-PO at all, even with a
genuinely qualifying collaborator and the toggle on; the rest covering
`resolveApprovalTargets`'s new `resolveNonPoApprovers` — multiple
qualifying collaborators each getting their own resolution with
`requiredPermission: "Procurement.Approve"`, a collaborator present
but never granted the permission correctly skipped, PO reference still
pre-empting, no collaborators falling through, none qualifying falling
through, Cost-Object mode still pre-empted, and the every-field-absent
backward-compatibility case unchanged.
`workers/vf-app/test/workflow-engine.test.ts` — **58/58**, its own
Non-PO describe block rewritten the same way: routing to a genuinely
qualifying collaborator now asserts `required_permission =
'Procurement.Approve'` on the created task, not just who owns it; a
collaborator added but never granted the role now falls through to
the configured mode instead of being routed anyway; a new test routes
two qualifying Business Approvers to one invoice, confirms both tasks
share one `stage_visit_id`, and proves the stage does not advance
until *both* complete theirs — unanimous, end to end through
`onTaskCompleted`; the PO-reference and no-collaborator fallback cases
carried over unchanged. `workers/vf-app/test/index.test.ts` —
**165/165**, four new: a Business Approver holding only
`Procurement.Approve` reaches `GET /tasks` and sees exactly the task
assigned to them; `?ownership=available` is ignored server-side and
"mine" is still what comes back; another person's task, even one
requiring the identical permission, never leaks into their list;
`AP.TaskView` continues to open the unrestricted screen, unaffected.
`workers/vf-app/test/invoice-collaborators-route.test.ts`,
`test/task-list-route.test.ts`, `test/task-route.test.ts`,
`test/stage-permissions.test.ts`, `test/org-route.test.ts` run
alongside the four above, **369 + 142 = 511** combined, confirming
nothing this decision touched regressed collaborator management, task
listing, task claiming/completion, the closed permission-vocabulary
discipline, or `permissions.ts`'s own description coverage.
`workers/vf-ui/test-browser/viewer.test.ts` (**177/177**, 175
pre-existing + 2 new: the Approve label appears exactly when
`requiredPermission === "Procurement.Approve"` and nowhere else) and
`test-browser/tasks.test.ts` (**84/84**, unchanged), run once the
missing `vitest.browser.config.ts` alias was fixed. See "What was
built" above for the unhandled-rejection caveat on this run.
`workers/vf-licence`'s `string-coverage.test.ts` and `ui-strings.test.ts`
together, **32/32**, confirming migration `0159` is applied and
`action.approve` is both defined and required. `tsc --noEmit` on
`vf-app` shows no new errors in any touched file — the same
pre-existing `cloudflare:test` module-resolution noise and the same
pre-existing `workflow-engine.test.ts` implicit-`any` lines decision
0469 already documented, untouched by this diff. `eslint` clean on
every file this decision touched, backend and frontend — the only
findings anywhere are two pre-existing errors in
`workflow-engine.test.ts`, outside this diff, already present before
this session began. **A full, unfiltered `vf-app` suite run was not
attempted** — the same known timeout decisions 0448, 0449, 0451, 0452,
and 0470 already hit and recorded; verification here is targeted, the
same discipline those decisions already established.

## Still to do, operator side

Push, deploy, and apply migration `0159` (`vf-licence`) once confirmed
— no `vf-app` migration this time, since `invoice_collaborators`,
`org_approval_config`, and `Procurement.Approve` all already existed
and were already live. Then: whether the ~15–20 pre-existing,
un-stubbed inline fetch mocks in `viewer.test.ts`/`tasks.test.ts`
(decision 0470's own test-fixture debt, only now visible) are worth a
dedicated cleanup pass is a real, separate decision — not assumed
here. Removing a collaborator, decision 0470's own still-open gap,
remains unbuilt and unscoped.
