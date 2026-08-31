# 0019 — Process instances and stage visits

Status: settled, 31 August 2026. The runtime machinery decision 0018
explicitly deferred: everything built there described a process;
nothing ran one. This is what actually moves a real subject through a
process's stages, evaluating each stage's rule set against supplied
facts, reacting to what fires, and cascading forward — with the same
end-to-end proof discipline as every other bundle this session,
including a full real invoice run through a real process, through the
real router, blocking on a real task and completing automatically once
it's done.

## Facts are always supplied, never fetched

Decision 0015's own words: rules evaluate "against facts supplied
about it." `visitCurrentStage` takes facts as an explicit parameter —
the same shape `POST /rules/evaluate`'s inline `facts` has always
taken — rather than the engine assuming how to load facts for a given
`subject_type`. This is what keeps the engine genuinely
subject-agnostic: it never needs to know an "invoice" means "go read
`invoice_headers`." A convenience auto-load (mirroring decision 0017's
optional-`facts`-falls-back-to-persisted pattern) is a reasonable
follow-up, deliberately not built here — that would quietly
special-case one subject type inside a supposedly generic engine.

## `stage_visits` is a genuinely new table, not a reuse of `invoice_runs`

Flagged the first time this question came up, in the very first
"what's buildable now" conversation: `invoice_runs` is literally
invoice-shaped (an `invoice_id` column), which would contradict the
entire point of a subject-agnostic engine. `stage_visits`/
`stage_visit_steps` mirror `invoice_runs`/`invoice_run_steps`'s own
append-only design, built fresh. `invoice_runs` is untouched — still
doing AP's own job, unaware this exists.

## `tasks.stage_visit_id` — additive, not a breaking change

A real gap in what 0018 shipped: `tasks.stage_id` points at a stage
*definition*, but multiple process instances can sit at the same
stage simultaneously (five different invoices all in "Approval" at
once) — nothing distinguished whose task belonged to which instance's
visit. Added as a nullable column via `ALTER TABLE`. A task created
directly through 0018's own API (still fully supported, unchanged)
has no stage visit to point to; a task spawned by a fired
`assign_task` action during a real visit does.

## The cascade: automatic stages are free, real ones aren't

A single call to `visitCurrentStage` loops through as many stages as
apply using the *same* supplied facts throughout — a stage with no
`rule_set_id` has nothing to evaluate and nothing that could spawn a
task, so it always advances immediately; the loop only stops when a
stage's fired rules spawn real, open tasks (blocking) or the process
runs off the end (completing). Bounded at `MAX_STAGES_PER_VISIT` (50)
— the same "never Turing-complete" discipline `MAX_COMBINATOR_DEPTH`
already applies to rule nesting, guarding against an accidental
`route_to` cycle hanging a request indefinitely.

## A stage only advances once every task it spawned is resolved

Directly from decision 0015's own confirmed example. Completing a
task (`task-route.ts`'s existing `handleCompleteTask`, unchanged)
triggers a new, separate check — `onTaskCompleted` — for whether it
was the *last* open task for its stage visit. If open tasks remain,
nothing happens; proven directly by seeding two tasks for one visit,
completing only one, and confirming the instance stays put. If it was
the last one, the instance advances.

**A deliberate, honest scope boundary, not a gap glossed over:**
task-completion-triggered advancement cascades freely through
automatic stages (nothing to evaluate, so no facts are needed) but
*stops*, still `in_progress`, at the first stage that actually needs a
real rule set evaluated — because `onTaskCompleted` has no facts
available to it, potentially running long after the original visit
that spawned the task. Further progress from there requires an
explicit `visitCurrentStage` call with real, freshly supplied facts.
This was a genuine design fork, not an oversight: the alternative
(requiring the task-completion caller to also supply facts for
whatever stage comes next) was rejected as conflating two different
concerns — completing a task, and evaluating a stage.

## `route_to` conflicts are refused, not resolved

If a stage's fired rules include more than one `route_to` action
naming *different* target stages, that's genuinely ambiguous.
Refused with a 409, the same "refuse rather than approximate"
discipline already applied to the compiler's own refusal boundary and
to `/rules/evaluate`'s `ruleSet`/`ruleSetId` exclusivity check. An
unnamed `route_to` target, or one naming a stage that doesn't exist
in the same process, is refused with a 422 rather than silently
falling back to sequence.

## Real integration, not a reimplementation

`assign_task` actions call `handleCreateTask` directly (0018's own
function) — no parallel task-creation logic. This is the moment
`assign_task`'s params (team, user, permission) actually get acted on
by something, for the first time; until this bundle, they were only
ever validated and stored inert on a manually-created task.

Wired into `index.ts`: creating a process instance is unauthenticated,
matching `/processes`/`/processes/:id/stages` (administrative setup);
visiting a stage requires `AP.Validate` and is licence-gated the same
way `/rules/evaluate` and `/rules/compile` already are — this is the
exact same capability (evaluating a rule set against facts), just
reached through the workflow engine instead of directly. Completing a
task through the real route now also calls `onTaskCompleted`
automatically — wired at the `index.ts` level specifically to avoid a
circular import (`workflow-engine.ts` already imports `task-route.ts`
the other way).

## Proven end to end, not just unit-tested

A real invoice moves through a full three-stage process — Received
(automatic) → Approval (spawns a real task above a threshold) →
Payment-eligible (automatic) — entirely through the real router: an
instance is created, visited, blocks with a genuine open task, that
task is claimed and completed through the real `/tasks/:id/complete`
route, and the instance is confirmed to have advanced all the way to
completion with no further explicit call. Two of the most consequential
properties (blocking on open tasks; auto-advancing once the last one
completes) were each deliberately broken and confirmed to fail
correctly before being restored, the same discipline applied to every
bundle this session.

## What's still open

- **Auto-loading facts for a known `subject_type`** (mirroring
  decision 0017's invoice-facts fallback) — a reasonable follow-up,
  deliberately not built here.
- **Cascading past a rule-bearing stage after task completion** — the
  scope boundary named above; would need a real answer to "where do
  the facts for the next evaluation come from" before it could be
  built.
- Every open question decisions 0015 and 0018 already named (cost
  centre vs. `org_units`, hierarchy flow-down, the universal-
  permission-check-for-now decision, the `agent_approve` question) —
  none of them touched by this bundle.
- No `GET` endpoint to inspect an instance's current state or visit
  history — matches the "raw API for now" precedent elsewhere in this
  project.
