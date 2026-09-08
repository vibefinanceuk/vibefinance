# 0160 — Finishing the versioning skeleton

**Status: the foundation runs.** Every read of a process's stages goes
through its version's membership. **Nothing creates a second version
yet.**

---

## Found uncommitted

After a deploy, the sandbox held five uncommitted changes nobody in that
session had made: a `0043_process_versions.sql` migration and three
source files, **implementing decision 0150**.

The operator:

> It must have been part of previous discussions about process
> versioning. The skeleton framework was likely built as a foundation.
> I'm happy for it to be removed, if you have another approach.

**There was no other approach.** The skeleton implements decision 0150
exactly — `process_stage_versions (process_id, version, stage_id,
sequence)`, a version on `processes` and on `process_instances`, and
every existing stage backfilled as v1. Removing it would have discarded
the same design, rewritten.

**Worth checking before discarding.** *"I'm happy for it to be removed"*
is permission, not instruction, and the thing being removed turned out
to be the thing that would have been rebuilt.

---

## It broke seventeen tests, correctly

The workflow engine now reads a **version's membership** to find a
process's stages. Twelve test seedings inserted into `process_stages`
directly and gave a stage no membership at all.

**A stage in no version is in no process**, and the engine stepped
straight past it — which is exactly what the change means. The tests
were right to fail.

`process-route.ts` already records membership when a stage is created
through it, with its own reasoning written out. **Only the tests bypass
it**, so a sweep in each seeding is a test convenience rather than a gap
being papered over.

### A trigger was tried, and cannot work here

`CREATE TRIGGER` on `process_stages` would have made it automatic. But
the trigger body contains internal semicolons, and this harness
**flattens every statement to one line** before `exec` — so the schema
would not load at all, and 875 tests failed instead of seventeen.

Recorded because it is not obvious, and the next person to reach for a
trigger will find the same wall.

---

## What the skeleton left

**Nothing creates a v2.** Every read goes through membership and nothing
can change it: no route publishes a version, adds a stage to one, or
removes a stage from one.

So today the system behaves exactly as it did — one version, containing
every stage — and is **ready** to behave otherwise.

That is a reasonable place for a foundation to stop, and worth saying
out loud rather than leaving somebody to discover that the feature is
half a feature.

---

## What is not built

- **Publishing a version.** The whole point of decision 0150: add a
  stage, remove one, reorder them, and produce a v2 that new invoices
  start on.
- **The configuration screen** the operator asked for, which is what
  publishing would be reached from.
- **Line Review still cannot be removed**, which was the case that
  motivated the design — it needs a v2 not containing it.
- **Nothing shows an invoice's process version**, so *"which shape did
  this run under"* is answerable only from the database.
