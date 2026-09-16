# 0352 — Drag-to-Reorder a Draft's Own Stages

**Status: built.** Reported live, in the middle of a broader
evaluation of updating a process: "5 - I like the drag to re-order,
if that is possible?" Confirmed possible and built.

---

## What was evaluated first

The operator asked to evaluate updating a process by removing stages
(already built, decision 0349), changing stages, and setting a
stage's own sequence number. That same message also reported a real
bug — adding a "Matching" stage to AP Line Review was refused as
"already exists," even though AP Line Review has no such stage.

Investigated directly: `Standard AP`'s own live process already has a
stage seeded with `id: 'matching'`. Stage `id` is a global primary
key, not scoped per process — confirmed load-bearing, not incidental:
`route_to` (a rule action) resolves its target stage by id alone,
never by name, so a stable, global id is what a compiled rule
actually depends on. The operator's own proposed fix — making stage
*name* the unique key instead — was evaluated and set aside for this
reason, addressed to the operator directly rather than built silently
either way.

Of "changing a stage," reordering was the one piece confirmed safe to
build immediately: `process_stage_versions.sequence` is already
scoped to one version, so reordering a draft can never touch the live
version's own order or retroactively change behavior for an in-flight
instance — the same "anything already on a version completes that
version" boundary decision 0349 already established for adding and
removing a stage. Renaming in place, and a combined "replace this
stage" action for changing rule set or evaluation scope, remain
evaluated but not built, pending the operator's own confirmation.

## What was built

`handleReorderDraftStages`: a new `PUT` on the same bare
`/processes/:id/draft/stages` path `POST` already uses for adding a
stage — deliberately not a `.../stages/reorder` sub-path, which would
also match the existing `DELETE .../stages/:stageId` route treating
"reorder" as a literal stage id, the same routing-order trap
`/rules/stages` already has to avoid against a rule literally named
"stages." Method alone disambiguates the two.

**The whole set, checked, not a partial move accepted on trust.** A
caller names every stage id currently in the draft, in the new order;
anything missing, extra, or duplicated is refused outright — the same
discipline `route_to`'s own "more than one distinct target" refusal
already applies elsewhere in this engine, applied here so a client
bug can never silently drop a stage from a draft's own membership.

**No browser drag-and-drop library, and no `DataTransfer`.** This
codebase has never had a drag-and-drop feature before this one. The
implementation is plain HTML5 `draggable`/`dragover`/`drop`, tracking
which stage is being dragged in a module-level variable rather than
`event.dataTransfer` — jsdom's own support for `DataTransfer` is
incomplete, and there is no cross-window need here at all: drag
source and drop target are always the same page. Only the draft's own
stages are draggable; the live version's own, read-only display never
is.

## A real UX bug, caught before it shipped

The first version of the drop handler always inserted the dragged
stage immediately before whatever it was dropped on. That reads
wrong in one direction: dragging the first stage and dropping it on
the *last* one left it in the middle, not at the end — not what
"drop it there" suggests. Fixed to be direction-aware: dropping while
dragging forward lands just after the target (so the last-stage case
really does move to the end); dropping while dragging backward lands
just before it. Confirmed directly with tests for both directions —
the forward-drag test genuinely fails without the fix, not just the
first version that happened to pass by coincidence.

## What has coverage

Backend: the strict whole-set validation (missing, extra, and
duplicate entries, each refused), the boundary check (never touching
the live version's own order or an in-flight instance's own version),
and the route's own gating and method-disambiguation from the
existing `POST`. Frontend: draft stages are draggable and the live
version's own are not, both drag directions produce the correct new
order sent to the real route, and dropping a stage on itself is
confirmed to be a genuine no-op rather than an unnecessary request.

`vf-app`: 1697 (was 1686). `vf-ui`: 69 Worker (unchanged), 530
browser (was 525).

## Deliberately not decided here

- **Renaming a stage in place.** Evaluated as safe (nothing at
  runtime evaluates a stage by its own name), not yet built.
- **Changing a stage's own rule set or evaluation scope.** Evaluated
  as needing the existing remove-then-add primitives rather than an
  in-place edit, since those properties are not versioned the way
  membership and order already are — not yet built as a single,
  ergonomic action.
- **Auto-generated stage ids, and per-process name uniqueness.** Both
  proposed as the actual fix for the reported bug; neither built yet.
