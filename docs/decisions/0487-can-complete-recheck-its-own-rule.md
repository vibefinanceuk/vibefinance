# 0487 — Complete can recheck the rule that raised the task

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Asked live, about the Coding queue: *"If I click complete on... it
should check that the coding is actually completed and not continue to
the next stage. Is there a way to assess that the work has been done,
that has caused the task to be alerted in the first place... would it
be possible to fire that rule again and confirm the resolution did
take place?"*

Feasible on its own terms — the pure evaluator (`evaluateConditions`,
`shared/interpreter/evaluate.ts`) already exists and facts are always
loaded live, never snapshotted. But re-firing "the rule" only makes
sense for a task whose own firing condition can become false
(Coding's `coding.gl_code is_empty` is the clean case); an Approval
task's condition ("amount > threshold") never does, and applying this
uniformly would permanently block every approval.

Asked what to scope this to, the operator redirected to a larger
question: *"I'm going to have to over-hall the button available at
each stage... there are buttons, when pressed I would want rule
execution to occur, ensuring the business condition has been met."*
Walking through that with the operator (`AskUserQuestion`, twice)
converged on: design the per-stage action system starting from
*behaviour* — what a given action does — over the alternative of
designing the full "which buttons appear where" system first, or
building the narrow rule-check alone. A separate, mid-build question —
*"Can we look at button behaviour, as I think it might also influence
the way we build rule execution"* — surfaced the actual fork this
decision is built around: whether the flag belongs on `process_stages`
(the `read_only`/`offer_field_restrictions` shape) or in a new table.

## What was decided

**A new table, `stage_actions` — one row per (stage, action) — not a
column on `process_stages`.** A scalar column can express one
behaviour per stage; the operator's own next request was several
actions (Return, Discard, Reassign, ...) each wanting their own
configured behaviour, which a column-per-action shape would mean a
migration every time one is added. One row per (stage, action) is
built now as the real home for "button behaviour," rather than a
scalar column migrated away from later. See
`migrations/0082_stage_actions.sql` for the full reasoning.

**Sparse, not defaulted-on.** Absence of a row means "nothing
configured" — today's exact behaviour. Turning `reverify_rule_on_
complete` on is a new enforcement that can refuse a completion that
currently succeeds, so nothing is enforced until an operator opts a
stage in, once — the opposite direction from `offer_field_
restrictions`' own default, which protected something already
visible.

**Only Complete is wired up to read the flag** — the table's `action`
column accepts the full closed `TaskAction` vocabulary so a second
action's own behaviour lands as a new column on the same table later,
not a new migration moving data off `process_stages` a second time.

**The exact rule VERSION that fired, not whichever is active now** —
resolved via `stage_visit_steps` (rule_id, rule_version, matched),
which migration 0009 already records for every step of a visit. An
edited rule should not silently change what "resolved" means for a
task already in flight.

**Fails open wherever the exact thing to re-check cannot be pinned
down**: no `rule_id` at all (a decision 0480 `system_reason` task —
nothing was ever asserted, so nothing can un-assert); no
`stage_visit_id` (a task created directly via `POST /tasks`, decision
0018's own pre-engine path); no matching `stage_visit_steps` row
(should not happen per migration 0009, but a refusal added on top of a
completion that already worked should not become a permanent lock
over a genuine "we don't know"); a subject that is not an invoice (the
engine is subject-agnostic; this decision is invoice-specific, the
same boundary `followUpAfterTaskCompletion`'s own comment already
draws). The same additive discipline decision 0486 used for its own
claim check — scoped to what is confidently known, never inferred
past it.

**Checked ahead of `handleCompleteTask`, in `index.ts`, not inside
it.** `task-route.ts` stays free of rule-evaluation and facts-loading
imports — the same import-direction discipline the existing
completion cascade's own comment already states (`onTaskCompleted` is
checked in `index.ts` rather than inside `handleCompleteTask`, to
avoid a circular import between `task-route.ts` and
`workflow-engine.ts`). The cheap flag read (`stageReverifiesRuleOn
Complete`, one row) runs first and unconditionally, so every stage
that has not opted in — every stage today — pays one extra single-row
SELECT and nothing more.

**The refusal surfaces through the existing "here because" banner,
not a new UI pattern** — the operator's own preference, from the
design conversation: the banner (`reasonLinePanel()`, decision 0478)
is already on screen, already naming the rule. A generic toast alone
puts the answer somewhere that vanishes on the next click; flashing
the panel that already explains "why" draws the eye back to it. The
task itself is simply never completed — refusing the 409 leaves it
open and still claimed by the same person, which is the "reasserted
and available again" fallback the operator asked for, achieved for
free by not marking it complete rather than as separate machinery.

## A duplication closed alongside this

`ruleStillFiresForTask` needed the same "load `facts_json`, merge the
structured header columns, merge the PO match" sequence that already
existed, written out separately, in two places in `index.ts`
(`followUpAfterTaskCompletion`, and `/process-instances/:id/visit`'s
own fallback for a caller supplying no facts). A third copy was the
trigger to extract it: `loadLiveInvoiceFacts` (`invoice-facts-
route.ts`), used by `ruleStillFiresForTask` and refactored into
`followUpAfterTaskCompletion` in the same change. The `/visit` route's
own inline copy was left alone — it has extra caller-supplied-body-
merging logic the other two do not, so folding it in was a separate,
unrelated change this decision did not need to make.

## What was built

- **`migrations/0082_stage_actions.sql`**: the new table, its full
  reasoning as a comment on the migration itself.
- **`workers/vf-app/src/stage-actions-route.ts`** (new):
  `handleSetStageAction` (the PUT handler — 422 an unknown action, 404
  an unknown stage, 400 a missing/wrong-typed `reverifyRuleOnComplete`,
  otherwise an UPSERT), `stageReverifiesRuleOnComplete` (the cheap
  flag read), `ruleStillFiresForTask` (the actual re-check, fully
  reasoned above).
- **`workers/vf-app/src/invoice-facts-route.ts`**: new
  `loadLiveInvoiceFacts`, and `index.ts`'s `followUpAfterTaskCompletion`
  refactored to call it instead of carrying its own copy.
- **`workers/vf-app/src/i18n.ts`**: `completeBlockedRuleStillFires`, a
  new closed `MessageKey`, all six supported locales.
- **`workers/vf-app/src/process-route.ts`**: `StageDetail` carries
  `reverifyRuleOnComplete`, `stagesAtVersion`'s query LEFT JOINs
  `stage_actions` for it — the same read `ap-setup.js`'s Stage
  Restrictions tab already uses for `offerFieldRestrictions`.
- **`workers/vf-app/src/index.ts`**: the new `PUT /processes/stages/
  :id/actions/:action` route; the pre-check inserted ahead of
  `handleCompleteTask`'s own call, returning 409
  `{error, reason: "rule_still_fires", ruleName}` when blocked.
- **`workers/vf-ui/public/ap-setup.js`**: a new toggle row, "Recheck
  the rule that raised this task before Complete succeeds," on the
  existing Stage Restrictions tab's per-stage panel — independent of
  the `offered`/Account Coding branch, since an Approval stage with no
  Account Coding fields to restrict can still reasonably want this.
- **`workers/vf-ui/public/viewer.js`**: `runAction`'s failure path
  flashes `.reasonline` (CSS class toggle, forced reflow so a second
  refused click in a row restarts the animation) when the server's
  `reason` is `"rule_still_fires"`.
- **`workers/vf-ui/public/app.css`**: `.reasonline-flash` — two soft
  pulses using `--bg-warning` (tokens.css, decision 0395's "look at
  this" tier), not `--bg-danger` — nothing failed, a person just needs
  to look again.
- **`workers/vf-ui/src/index.ts`**: the new route added to the proxy
  allowlist in the same change, decision 0484's own lesson, not after
  a live report.
- **`workers/vf-licence/migrations/0167_stage_reverify_rule_strings.sql`**:
  the toggle's own label, `en` and `de`, wired into
  `workers/vf-licence/test/setup.ts` and `string-coverage.test.ts`'s
  hand-kept key list.
- Tests: `workers/vf-app/test/stage-actions-route.test.ts` (new, 9
  cases — `handleSetStageAction` validation and UPSERT behaviour,
  `stageReverifiesRuleOnComplete`'s sparse default, and
  `ruleStillFiresForTask`'s three fail-open cases); a new `describe`
  block in `workers/vf-app/test/index.test.ts` (two full end-to-end
  cases through the real router: refused then succeeds once genuinely
  resolved, and a stage that never opted in is unaffected); two new
  cases in `workers/vf-app/test/process-route.test.ts` (default false
  on a new stage, a stage turned on reads back true); the new route
  added to `workers/vf-ui/test/index.test.ts`'s `CALLED_BY_A_SCREEN`.
  `workers/vf-app/test/setup.ts` and `workers/vf-licence/test/
  setup.ts` both updated to apply the new migrations to their test
  schemas — `TABLES_IN_DROP_ORDER` also needed `stage_actions` added
  ahead of `process_stages`, the same shape `stage_field_visibility`
  already established, or the very next test's schema reset fails a
  foreign key constraint.

## What was not built

**The much larger button/action system the operator described in the
same conversation is a separate piece of work, deliberately not
started here.** Mid-build, the operator laid out a full specification:
a configurable action list per stage (a real "Validation Complete" /
"Route To Approver" / "Return To Seller" vocabulary, not today's seven
generic `TaskAction`s), a comment-and-OK/Cancel modal for every action
with action-specific extra fields (a user picker for Reassign, a
conditional manual-approver picker for Route To Approver depending on
an AP Setup mode this repo does not yet have, a reason dropdown plus
an email-address dropdown for Return To Seller), and a Timeline/Chat
audit entry — icon, comment, user, timestamp — on every action taken.
This decision builds the rule-re-execution engine that system will
call into (exactly the *"upon clicking OK... this is where I think the
Rule validation needs to execute"* piece), and the refusal behaviour
already matches what was asked for it: an on-screen error, and the
task simply staying open rather than a new "reassert" mechanism. The
stage→action list, the generic modal, the three (and future) per-
action extra-field integrations, and the audit-trail write are none
of them attempted here — see the follow-up scoping conversation for
how that gets sequenced.

No change to `handleCompleteTask`, `handleClaimTask`, or
`handleReleaseTask` themselves. No change to `visitCurrentStage` or
`onTaskCompleted` — the re-check is a gate in front of completion, not
a change to what completing does. No attempt to infer which stages
"should" have this from their rule set or `required_permission` — the
same explicit, per-stage, operator-set discipline decisions 0143 and
0485 already established, applied one level up.

## Verification

- `workers/vf-app`: `stage-actions-route.test.ts` **9/9** (new);
  `index.test.ts` in full **180/180** (2 new decision-0487 cases, the
  rest unaffected — confirming the pre-check is additive for every
  stage that has not opted in); `process-route.test.ts` **68/68** (2
  new); `task-route.test.ts` + `task-list-route.test.ts` +
  `invoice-facts-route.test.ts` together **108/108**, untouched by
  this change. `tsc --noEmit` shows no new errors in any file this
  decision touched (only the same pre-existing `cloudflare:test`
  resolution noise this project has already documented repeatedly).
- `workers/vf-licence`: `string-coverage.test.ts` +
  `ui-strings.test.ts` together **32/32**.
- `workers/vf-ui`: `index.test.ts` (proxy allowlist) **61/61**;
  `ap-setup.test.ts` (browser) **49/49**; `viewer.test.ts` (browser)
  **204/204** — the same 235 unhandled-rejection warnings about an
  unstubbed `/api/documents/inv-1/collaborators` fetch appear
  identically on unmodified `main` (confirmed via `git stash`),
  entirely unrelated to this change.

## Still to do, operator side

Push and deploy `vf-app`, `vf-ui`, and `vf-licence` (new migrations
0082 for `vf-app`, 0167 for `vf-licence`). Once live: turn the new
toggle on for a Coding stage in the Stage Restrictions tab, attempt to
complete a task whose coding is genuinely still missing (expect the
banner to flash and the task to stay open, claimed), then actually
code it and complete again (expect it to succeed). Then: return to the
scoping conversation for the larger per-stage action/modal/audit
system this decision's engine will sit underneath.
