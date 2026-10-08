# 0694: A process's entry and exit stages follow the version published

**Status: live** at `e31255b`, pushed and deployed 8 October 2026, migration applied; Supplier Maintenance now reads Intake → Complete. vf-app (`process-route.ts`) and migration
`0153_process_ends_follow_current_version.sql`.

## What was asked

Dan, 8 October 2026, on the Routes screen:

> can you look at the process routes for the Supplier Maintenance route. the
> Review stage seems to be a point where sources deliver and destinations
> read. How is this determined? I added new start and end stages.

## How it is determined

Decision 0557: Sources deliver to a process's **entry stage**, and
Destinations read from its **exit stage**, meaning its first and last stage.
`processEnds()` reads them from `processes.entry_stage_id` and
`exit_stage_id`, and falls back to the current version's first and last stage
only when a stored one is missing or no longer in the version.

The exit stage also decides ERP eligibility: an invoice at its process's exit
stage is payment-eligible (0558, `exitStageIds`).

## What was wrong

Migration 0107 stored every process's first and last stage **once**. Nothing
moved them afterwards: not publishing a version, and no screen. Supplier
Maintenance had only Review then, so Review was stored as both. Dan's version 2
(Intake → Review → Complete) still contains Review, so the stored value stayed
valid and the fallback never applied:

```
stages:       intake, supplier-maintenance-review, complete   (version 2)
entryStageId: supplier-maintenance-review
exitStageId:  supplier-maintenance-review
```

The workflow itself was right: a new instance starts at the first stage of
the current version (`handleCreateProcessInstance`), so a new supplier record
already starts at Intake. Only the Routes diagram and the stored ends were
stale.

## The fix

- `handlePublishDraft` now sets `entry_stage_id` and `exit_stage_id` to the
  new version's first and last stage, in the same batch as the version change.
- Migration 0153 brings every process up to date once. Standard AP (Intake →
  Payment-eligible) and Warehouse Receipts are unchanged by it. Supplier
  Maintenance becomes Intake → Complete.

## Tests

`test/process-route.test.ts`: a one-stage process with Review stored as both
ends gets Intake and Complete added, is reordered and published. Before
publishing the ends are unchanged; after, they are Intake and Complete, stored
and read. The process, routes, ERP export and warehouse receipt tests pass
(108).
