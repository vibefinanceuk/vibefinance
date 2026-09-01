# 0027 — Per-line rule evaluation

Status: settled, 1 September 2026. Decisions 0015 and 0022 both
flagged this explicitly: line-item facts blocks both cost-centre
routing and duplicate detection. This closes it. The design
conversation that preceded it surfaced two real, honest findings
worth recording alongside the build itself, not just the mechanism.

## Two findings, recorded honestly

**`invoice_lines` had been write-only since decision 0017.** Every
route that touched it only ever `DELETE`d and re-`INSERT`ed a full
line set; nothing anywhere read a line back. Lines were stored
faithfully and then never looked at again — confirmed directly by
grepping every real caller in the codebase, not assumed.

**Decision 0018's own prose promised a scope column that was never
actually built.** It said explicitly: "a task's scope should be a
first-class field from the start... so that line-level scoping is an
additive migration later, not a rework." The real schema never
delivered it — `tasks` had no such column until this bundle. Worth
stating plainly rather than quietly working around the gap the prose
had already named.

## The design: `evaluation_scope`, not a parallel evaluation path

`process_stages` gains an `evaluation_scope` column, closed to
`'header'`/`'line'`, defaulting to `'header'` — every stage that
already existed keeps working exactly as it did before this bundle,
confirmed directly: the full pre-existing test suite (328 tests)
passed completely unmodified before a single new test was added.

A `'line'`-scope stage evaluates its rule set once per supplied line,
merging header facts with that line's own facts each time — decision
0015's own confirmed example: each line checked against its own cost
centre threshold, independently. `stage_visit_steps` and `tasks` both
gain a nullable `line_number` — not a foreign key to `invoice_lines`,
deliberately: lines are supplied inline to `visitCurrentStage`, the
same way header facts always have been, and don't need to correspond
to a persisted `invoice_lines` row at all. `line_number` records which
supplied line a step or task belongs to; `NULL` for every header-scope
evaluation, unchanged from before this bundle.

Each matching line spawns its own, separate task — not one combined
task for "some lines matched." Different lines can genuinely need
different approvers; decision 0015's own confirmed behavior, now
actually implemented and proven, not just described.

## A real ordering hazard, found and fixed before it became a bug

`tasks.stage_visit_id` carries a foreign key to `stage_visits(id)`.
The original single-evaluation code created the `stage_visits` row
*before* any task could reference it. A naive per-line loop —
evaluate one line, create its tasks, evaluate the next line — would
have tried to create tasks referencing a `stage_visits` row that
didn't exist yet on the very first line. Caught during design, not
after a failing test: every evaluation across every line runs and its
results are fully collected *first*; `stage_visits` and
`stage_visit_steps` are inserted next; task creation happens last, only
once the row it needs to reference is guaranteed to exist. The exact
same class of statement-ordering bug decision 0014's own
close-then-open sequencing already had to get right once before.

## Proven at both layers, not just the engine function directly

Six tests exercise `visitCurrentStage` directly, including the two
properties that matter most: a header-scope stage completely ignoring
supplied lines (backward compatibility, not just an assumption), and
two lines both crossing the threshold producing two independent,
separately-traceable tasks. Both were deliberately broken and
confirmed to fail before being trusted — a broken per-line loop that
silently only evaluated the first line was caught immediately by a
real assertion, not discovered later.

The real HTTP route (`POST /process-instances/:id/visit`) had never
accepted a `lines` parameter at all before this bundle — fixed, with
its own validation (a numeric `lineNumber` is required on every
supplied line, refused with `422` otherwise) and its own end-to-end
test: a real invoice, two real lines, one over threshold, evaluated
through the actual router, confirmed to spawn exactly one task tied to
the correct line.

## What's still open

- **Auto-loading lines from `invoice_lines` by subject id** — the
  same deliberate scope boundary decision 0019 already drew for
  header facts, applied consistently here rather than expanded
  quietly. Lines must be supplied inline; a real, reasonable follow-up
  once (or if) that boundary is revisited generally.
- **Duplicate detection** — decision 0015's other named blocker.
  Per-line evaluation is the mechanism it needs; the actual detection
  logic itself is a separate, unbuilt piece.
- **Cost centre vs. `org_units`** — still genuinely unresolved,
  unchanged by this bundle. Per-line evaluation makes cost-centre-tied
  rules *possible* to write and run; it doesn't resolve what a cost
  centre actually *is* in this system.
- The historical/queryable invoice-facts framework — decision 0015's
  third named gap, still untouched.
