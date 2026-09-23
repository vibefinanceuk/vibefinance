# 0454 — Completing a Task No Longer Strands an Invoice on the Next Stage

**Status: confirmed pushed and deployed.** `origin/main` fetched
directly reads `93b4568`, matching this session's own commit exactly,
and the operator confirmed `wrangler deploy` run for `vf-app` — the
only worker this decision touched. No migration to apply. The one
open item is the specific invoice this was found on, still parked at
Matching — see "Still to do, operator side" below.

---

## What was asked

Not a feature request — a live report, worked through live in
conversation rather than filed as a ticket first: an invoice sat at
Matching, `Waiting`, with nothing in Tasks to explain it, no error
banner anywhere, and no action available to move it on, even after
confirming the operator's own `AP.Match` permission and team
membership were both correct. Traced end to end, live, through the
invoice's own Activity tab: *"Business rule 'Supplier Found Check'
fired: assigned to AP Validation"*, then *"Alice McDonald completed
Validation"* — nothing about Matching at all, which turned out to be
exactly the missing piece.

## What was found

**A second, separate cascade exists alongside the one everybody
already knew about, and only one of the two actually evaluates a
stage for real.**

`visitCurrentStage` (workflow-engine.ts, decision 0019) is the
familiar one: load real facts, evaluate a stage's rule set against
them, react to what fires. It runs once at intake
(`intake-capture-route.ts`) and via the explicit `/process-instances/
:id/visit` route. It correctly advances past a stage whose rule set
turns out to hold no live rules — `evaluateRuleSet` against zero rules
simply matches nothing, `tasksCreated` stays zero, and the existing
"no tasks spawned — advance" path takes over exactly as if the stage
had no rule set at all.

`onTaskCompleted` is the other one, called only when a person
completes a task, and it works completely differently: cheaper,
deliberately fact-free, cascading forward only through stages whose
`rule_set_id` is genuinely `NULL`. Before this decision, the instant
it reached a stage with *any* `rule_set_id` attached — including one
pointing at a rule set that has never had a rule written into it — it
set `current_stage_id` to that stage and returned. Silently. No task,
no error, no record of the attempt. The engine's own comment called
this "a deliberate scope boundary, not a gap: further progress from
there requires an explicit `visitCurrentStage` call with real facts"
— true as far as it went, but nothing in the product ever actually
made that follow-up call. It was a dead end with no way out short of
someone editing the database directly.

**Why some invoices are fine and others are not.** An invoice that
validates cleanly, with no task ever raised, never touches
`onTaskCompleted` at all — its whole path, Validation through Matching
and beyond, happens in the one `visitCurrentStage` call at intake,
which evaluates every stage correctly regardless of whether a rule set
is empty. Only an invoice that needs a person to clear a task
*anywhere* upstream of a stage like this gets routed through the
broken cascade instead, the moment that task completes. Confirmed live
directly: the reported invoice's own Activity tab showed exactly one
person-driven event — Alice completing Validation — immediately before
it went quiet at Matching.

**Why this is worse than it first looks.** The invoices this strands
are specifically the ones that already needed a human to touch them —
not the routine, straight-through majority. A customer whose Matching
or Coding stage shows "no rules" in the Processes screen (an empty
rule set still attached, rather than a genuinely blank `rule_set_id`)
would see this on every single invoice that needed manual Validation
first, with no error anywhere to explain why.

## What was built

- **`onTaskCompleted` (workflow-engine.ts) now reports where it
  stopped**, instead of returning `void` and leaving the caller to
  find out nothing happened. Its new return type,
  `TaskCompletionCascadeResult`, carries an optional
  `needsEvaluationAt: { instanceId, stageId }` — set exactly when the
  cascade reaches a stage with a `rule_set_id`, absent when it ran to
  completion or is still genuinely blocked on other open tasks at the
  same visit. The function's own database writes are unchanged; this
  is purely a reported handoff where there used to be a silent one.
- **`followUpAfterTaskCompletion` (index.ts)**, called right after
  `onTaskCompleted` whenever it reports `needsEvaluationAt` — the same
  call site decision 0019 already uses to avoid a circular import
  between `task-route.ts` and `workflow-engine.ts`. Loads the
  invoice's real header facts (`facts_json` plus the structured
  columns, merged, the same as the `/visit` route already does for a
  caller supplying none of its own) and its real stored lines
  (`loadStoredInvoiceLines`, new, invoice-facts-route.ts — the same
  `{...lineFacts, lineNumber}` conversion `handleGetInvoice`'s own
  advisory validation call already did inline, pulled out so this
  second caller does not have to duplicate it by hand), merges in
  PO-match facts, and makes the one real `visitCurrentStage` call the
  stage actually needed. Invoice-only, deliberately — the same
  boundary `intake-capture-route.ts`'s own equivalent block already
  draws; the engine stays subject-agnostic, and this does not guess
  what a non-invoice subject's facts look like.
- **`workflow.stageError` recorded on a genuine refusal**, reusing
  decision 0435's own mechanism verbatim: if the follow-up
  `visitCurrentStage` call itself 409s or 422s (an org a stage
  requires but the invoice still lacks, a rule naming an undeclared
  permission), the raw error is written onto the invoice's own facts
  and the existing `workflowErrorPanel()` in the viewer (decision
  0435/0436-0438) shows it, exactly as it already does for the intake
  path. A genuine configuration problem stays visible instead of
  trading one silent dead end for a second, narrower one.
- **Per-line evaluation now actually has lines to evaluate.**
  `onTaskCompleted` never had access to any facts at all before this,
  so a line-scope stage reached through it was previously not just
  unstranded-or-not — it would have evaluated against zero lines even
  if it had been fixed to evaluate at all. `loadStoredInvoiceLines`
  closes that too, proven directly by a new test asserting a
  Coding-stage rule keyed off a line's own `BT-133` fires correctly
  once real stored line facts are loaded.

## What was not built

- **No retroactive fix for an invoice already stranded before this
  shipped.** This decision fixes the path going forward; an invoice
  whose `current_stage_id` is already parked on an unevaluated stage
  needs one real `visitCurrentStage` call to unstick — the existing
  `/process-instances/:id/visit` route already does this, and is the
  documented way to clear the specific invoice this was found on.
- **No UI change.** Nothing about the Processes screen, the Rules
  screen, or the viewer changed — this is entirely an engine-level
  correctness fix. A customer who wants to know whether a stage has a
  rule set genuinely attached (empty or not) still has no screen that
  tells them that directly; distinguishing "no rule set" from "a rule
  set with nothing in it" in the Processes screen itself is a
  separate, smaller follow-up, not addressed here.

## Verification

`workers/vf-app`: `test/workflow-engine.test.ts` (unchanged count,
one existing test extended to assert `onTaskCompleted`'s new
`needsEvaluationAt` return value directly), `test/index.test.ts` (five
new tests under "completing a task no longer strands the instance on
the stage it lands on next" — an empty rule set correctly fallen
through all the way to completion; a rule set that genuinely fires
gets a real task rather than a silent stop; a line-scope follow-up
evaluation correctly loads real stored line facts and fires on them;
a genuine refusal (`requires_org`) is recorded as `workflow.
stageError` rather than a second silent dead end; a non-invoice
subject stays exactly as parked as it was before, proving the
engine's own subject-agnostic boundary is still intact). Run together
with `test/task-route.test.ts`, `test/invoice-facts-route.test.ts`,
`test/approval-hierarchy.test.ts`, `test/source-capture-workflow.
test.ts`, `test/invoice-org.test.ts`, and `test/intake-capture.
test.ts` — **288/288** in one run, plus a second pass covering every
other file in the repo that imports from `invoice-facts-route.ts` or
`workflow-engine.ts` (`test/ar-process.test.ts`, `test/compile-
route.test.ts`, `test/dashboard.test.ts`, `test/documents.test.ts`,
`test/expense-process.test.ts`, `test/fraud-duplicates.test.ts`,
`test/invoice-history.test.ts`, `test/key-fields.test.ts`, `test/
load-suppliers.test.ts`, `test/stage-permissions.test.ts`, `test/
unit-config.test.ts`) — **419/419** across those, zero regressions.
`workers/vf-app`'s own full-repo suite again could not complete inside
this session's own tool timeout (the same, already-documented
limitation as decisions 0448/0449/0451/0453); every file that
plausibly touches what changed was run directly instead, as above —
**707/707** total. `npx tsc --noEmit` surfaces no new errors in any
file this decision touched (`index.ts`, `workflow-engine.ts`,
`invoice-facts-route.ts`, and both edited test files); the errors it
does report are the same pre-existing, unrelated ones decision 0453's
own verification already named.

No `vf-ui` or `vf-licence` change — this decision touches only
`vf-app`.

## Still to do, operator side

**Push and deploy confirmed** — `origin/main` reads `93b4568`,
`vf-app` deployed. The specific invoice this was found on is still
parked at Matching — this decision fixes the path going forward, not
retroactively — and needs the one-off, already-existing
`/process-instances/:id/visit` call to clear it directly.
