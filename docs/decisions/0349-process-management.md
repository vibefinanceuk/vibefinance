# 0349 — Process Management: Stages and Real Version Control

**Status: built.** "Investigate adding a new configuration screen that
permits Process management... We have previously discussed adding
stages to a process, and version control." Confirmed against a
mockup first, then confirmed live: "anything already on a process
version would complete that version; only new items entering the
process would follow a new version." That is exactly decisions 0150
and 0160's own design — this finishes what they started rather than
inventing something new.

---

## What already existed, checked before building

Decision 0150 designed process versioning; decision 0160 built the
foundation and said plainly what was left: "nothing creates a v2." A
year of code between the two records, and that remained true —
`process_stage_versions`, a `version` column on `processes` and on
`process_instances`, and every runtime stage lookup already reading a
version's own membership correctly. What had never existed was
anything that *wrote* a second version, or a screen to reach it from.

**A real, second gap found while wiring the list screen, not assumed
fixed.** `handleListProcesses` had zero test coverage and its own
`stageCount` was one of decision 0150's own named "thirteen reads"
never routed through versioning — it counted every stage a process
had ever had, not the ones in its current, live membership. Fixed
alongside the new work, with new tests including one probed directly.

**A third, separate gap**: `POST /processes` and `POST
/processes/:id/stages` had been unauthenticated since decisions
0018/0128 — `GET /processes` already required `Admin.Configure`; the
write side never did, the same class of gap `/org/units` carried
before decision 0335 closed it. Closed here, gating both existing
routes alongside the five new ones.

**A fourth, and the same class again**: `/processes/:id/stages`
(`handleCreateStage`) has existed since decision 0018, real and
tested in `vf-app`, and had never once been added to `vf-ui`'s own
proxy allow-list — reachable from nowhere a real browser could ever
reach it, the exact pattern decision 0212 already documents, found
here rather than by a real request failing.

## A draft is not new schema — it is rows nobody has published yet

`process_stage_versions` already stores membership for any version
number a caller names. A draft is simply the rows already sitting at
`processes.version + 1`: real the moment the first edit is made,
gone entirely if discarded, and turned into the live version by
nothing more than `processes.version` moving to point at rows
already there. No new table, no new column.

`ensureDraftExists` is the one place this is lazy: the first edit to
a process with no draft yet copies the live version's own membership
forward, so every subsequent edit is a change to what already exists
rather than a blank slate somebody has to rebuild. Adding a stage
always appends to the end of the draft's own order — a configuration
screen reorders by removing and re-adding, not by typing a sequence
number — while `process_stages.sequence` itself, which the workflow
engine has never read since decision 0150 (`process_stage_versions.
sequence` is the real order), still gets a valid value to satisfy the
table's own constraint, never a meaningful one.

**Removing a stage is never a `DELETE` on `process_stages`.** Decision
150's own point stands: a stage is not deleted, only absent from a
version's own membership. Its history, completed tasks, and any
in-flight instance still on an earlier version all still resolve —
confirmed directly with the exact case decision 150 was written for,
Line Review, still cited by a completed task.

**Publishing changes one number.** The draft's own membership rows
already exist, written as each edit was made; publishing moves
`processes.version` to point at them. Nothing about
`process_instances.process_version` is touched — confirmed directly,
not just reasoned about, against the operator's own stated
requirement: an in-flight invoice stays on the version it started,
only a new one follows the one just published.

## The screen

A process list (name, live version, stage count), and — once a
process is selected — its live stages, drawn the same chevron
sequence `process-row.js` already gives the Rules screen and the
invoice viewer, followed by a draft section when one exists: its own
stages (with a remove affordance the live view never gets), and
Add stage / Publish / Discard actions. Gated to `Admin.Configure`
throughout, matching every route behind it.

Two new icons: a plain three-node sequence for the nav item itself
(deliberately not `rules`'s own branching shape — a process is a
fixed order, never a decision tree); an arrow up out of a tray for
Publish, the visual mirror of `save`/`create`'s own down-arrow-into-
a-tray, since sending a draft out to become the live version is the
opposite act from persisting what is on screen.

## What has coverage

75 backend tests across the new draft/publish mechanism, the
version-aware list fix, and every route's own gating — probed
directly on the two claims that mattered most: a draft never touches
the live version's own membership, and publishing never touches an
in-flight instance's own `process_version`, both confirmed by
deliberately breaking each and watching the right test fail. Fixing
the newly-gated routes surfaced 47 unauthenticated setup calls across
`test/index.test.ts`'s own shared fixtures, all updated. 16 new
browser tests for the screen itself, covering the list, both
detail states, every write action, and the permission gate — with two
of my own real bugs caught along the way (a wrong import path for
`icon`, a missing `vi.resetModules()` in the test file's own setup)
rather than shipped. Adding a new, gated nav item surfaced 5 existing
tests elsewhere that hardcoded the nav's own item count or order —
the same kind of fallout decision 0346 itself had, fixed the same way.

`vf-app`: 1671 (was 1636). `vf-ui`: 69 Worker (was 63), 522 browser
(was 506).

## Deliberately not decided here

- **Reordering an existing stage's own position within a draft.**
  Today, changing order means removing a stage and re-adding it —
  correct, since a new stage always exists, but a genuine drag-to-
  reorder interaction for stages already in the draft is not built.
- **Whether two people can edit the same draft at once.** Nothing
  here locks a draft; a second administrator's own edit simply adds
  to or removes from the same rows.
- **Renaming a process, or a stage already created.** Decision 0150
  named renaming a stage as "not a version" — `name` is display,
  `id` is the key — and no route to do it exists yet, for a process
  or a stage.
