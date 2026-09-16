# 0351 — A Process Selector for the Rules Screen

**Status: built.** Reported live: "Under Rules screen I can see a new
Review stage after Intake. However, in the Processes page - I do not
see that stage in the illustration. Are these not feeding from D1
data?" Confirmed both were — the Rules screen's own stage list had
simply never been scoped to one process at all.

---

## The actual bug, confirmed before anything was built

`handleRuleStages` read `FROM process_stages s ORDER BY s.sequence`
with no `WHERE process_id = ?` at all — every stage from every
process, in one flat list, ordered by a column the workflow engine
itself stopped reading for ordering back in decision 0150. The
response sent to the browser didn't even include a process name or id
per stage, so the screen genuinely couldn't have grouped them even if
it had wanted to.

Decision 0350's own "Review" stage happened to sort next to AP's own
first stage in that unscoped ordering, creating the appearance of one
sequence spanning two entirely separate processes. The Processes page
was showing the truth the whole time — decision 0349 scoped it
correctly from the start; this was the one screen that had never had
to distinguish between processes before, because until decision 0350
there had only ever been one.

## The fix, confirmed with the operator first

> "I think perhaps the Rules page needs a Process selector at the
> top? Would that work? Then the Process needs to be filtered by a
> process id and version number (latest)"

Exactly that: `handleRuleStages` now takes a required `processId`,
querying through `process_stage_versions` the same way `stagesAtVersion`
in `process-route.ts` already does — a process's own current, live
version's own membership, not the raw stage table. A process with no
draft published on top of it reads its version straight off
`processes.version`, which is what "latest" already means throughout
this codebase.

**A real permission conflict, found while wiring the selector.**
Populating it means calling `GET /processes`, gated to
`Admin.Configure` — but the Rules screen itself is gated to
`Admin.RuleManagement`. Fixed the same way decision 0321 already fixed
the identical shape of conflict for the Access screen: the route now
accepts either standing, rather than a second, duplicate route.

**The selector renders only once more than one process exists.** With
exactly one, a picker offering a single, unchangeable option is a
control that decides nothing — the same restraint the empty-heading
fix in decision 0349 already applied to a vocabulary with no derived
fields.

## A real bug in the selector's own first build, caught by its own test

The first attempt marked the current process with `selected: p.id ===
processId` on each `<option>`. `el()`'s own `setAttribute` sets the
attribute even when the value is `false` — HTML boolean attributes are
"present" regardless of their string value — so every option ended up
marked selected, and the browser honoured only the last one in
document order. Fixed by setting `.value` on the `<select>` itself
after building its options, the same established pattern
`documents.js`, `sources.js`, and `viewer.js` already use. Caught by
the test written for the feature itself, not found separately —
probed directly by reverting the fix and confirming the same test
fails.

## What has coverage

Backend: a 404 for an unknown process, and the exact bug reported
live reproduced directly — a second process's own stage, seeded with
a deliberately low sequence number so it would have sorted first
under the old, unscoped query, confirmed never to appear in the first
process's own list. The "either standing" gate on `GET /processes`
probed directly by reverting to `Admin.Configure`-only and confirming
`Admin.RuleManagement` alone is refused.

Frontend: no selector at all with one process; a real selector naming
every process once more than one exists, with the correct one
genuinely selected (the bug above, caught here); switching processes
re-fetches stages scoped to the new process id and resets which stage
was chosen, since a stage chosen under the old process will not exist
under the new one.

`vf-app`: 1686 (was 1679). `vf-ui`: 69 Worker (unchanged), 525
browser (was 522).

## Named, not fixed — a separate, lower-severity finding

While checking whether `dashboard.js`'s own stage picker (for
building a dashboard card) had the same bug, confirmed it does not:
its own query already joins `processes` and labels each option with
its own process name. It does share a smaller, different issue —
still reading `process_stages` directly rather than through
`process_stage_versions`, so a stage removed from a process's own
live version by publishing a draft (decision 0349's own mechanism)
would still appear there as an option. Not the bug reported here, and
not touched by this change.
