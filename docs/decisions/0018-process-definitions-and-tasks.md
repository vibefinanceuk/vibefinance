# 0018 — Process definitions and tasks

Status: settled, 31 August 2026. The third buildable slice out of
decision 0015's design, following Teams (0016) and invoice facts
storage (0017) — the definition and ownership layer of the workflow
engine. Deliberately stops short of the runtime machinery (process
instances, stage visits) that would move a real invoice through a
process automatically; that remains a separate, later bundle.

## Schema: processes, stages, tasks

`processes` (a definition, e.g. "Standard AP Invoice Processing") and
`process_stages` (name, a `sequence` number, an optional
`rule_set_id`) reuse the existing rule engine directly — one rule set
per stage, not a parallel workflow-specific rules concept.
`rule_set_id` is nullable on purpose: a stage with no rule set at all
is purely automatic, matching decision 0015's own confirmed example
(a two-line invoice, both lines under threshold, visiting Approval and
auto-clearing with zero human tasks).

`sequence` resolves a question decision 0015 left genuinely open
without contradicting the branching-graph decision made there:
**sequence is the default path, rules are how a process deviates from
it.** A stage with no rule that fires a progression-changing action
simply advances to the next sequence number — no rule needs authoring
for the common, unremarkable case. A rule only needs to fire when the
path should deviate.

## `route_to`, redefined — and why nothing actually broke

`route_to` previously meant "send to a queue" in every prior use in
this project (`{"type":"route_to","params":{"queue":"finance"}}`,
from an earlier test rule set). It now means "advance the process to a
specific stage" — a genuine, deliberate redefinition, not an
extension. This was chosen specifically to keep two separate axes
distinct: which team owns a task, versus what stage a process is at —
the same distinction decision 0015 already drew between routing and
progression. A single action silently meaning either, depending on its
params' shape, would reintroduce exactly the ambiguity that
distinction exists to avoid — concretely, a customer naming both a
team and a stage "Approval" would make the old, overloaded meaning
genuinely unresolvable without an extra discriminator anyway.

This did not require any interpreter or schema change, and nothing
using the old meaning broke: `RuleAction.params` is `Record<string,
unknown>`, entirely opaque to `evaluateRuleSet` and `validateRule` —
the interpreter has never assigned semantic meaning to action params,
only to `type`. The old test rule's `route_to: {queue: "finance"}`
still evaluates and returns exactly as it always has through plain
`/rules/evaluate`; the redefinition only matters to whatever
*consumes* the action — the workflow engine specifically, which
doesn't exist to consume it yet. This is a real, deliberate
distinction worth being honest about, not a coincidence papering over
an actual break.

One real, deferred consequence: `shared/compiler/prompt.ts` still
shows the model a worked example using `route_to`'s old `queue` shape,
baked directly into the compiler's own prompt. Left unchanged in this
bundle — updating it now would be premature, since the workflow engine
doesn't yet consume `route_to`'s new meaning for anything real. Flagged
here so it isn't lost: this needs revisiting once the workflow engine
actually acts on `route_to` for the first time.

## Addendum, 31 August 2026: the deferred prompt gap became a real live bug

The deferral above was reasonable when written, but it hid a bigger
gap than it named: `ACTIONS` had never had a `FIELD_DESCRIPTIONS`-style
completeness discipline at all — only fields did. Every action's own
expected `params` shape was undocumented anywhere the compiler could
see, `assign_task` included. This surfaced live, not in review: the
first real compile of an `assign_task` rule, once decision 0019's
workflow engine actually existed to consume it, produced
`{"assignee": "AP team", "required_permission": "AP.Approve"}` —
plausible-sounding, and completely incompatible with what the engine
actually reads (`{"team"/"user", "permission"}`). Nothing had ever
told the model the real shape, so it invented one.

Fixed properly, not just patched: `vocabulary.ts` gained
`ACTION_DESCRIPTIONS`, mirroring `FIELD_DESCRIPTIONS` exactly,
including the same completeness test — every action in `ACTIONS` now
has a real description, with the exact expected params keys spelled
out for any action that takes them, not just `assign_task` and
`route_to`. `vocabulary-doc.ts` renders these into the prompt instead
of a bare comma-separated action-name list. `prompt.ts`'s worked
example was corrected at the same time — the stale `route_to`/`queue`
shape replaced with the current `{"stage": "..."}` meaning, and a
second worked example added showing `assign_task`'s real shape.

The lesson worth keeping, not just the fix: an unenforced
documentation gap for one part of the vocabulary (actions) sat
harmlessly for as long as nothing consumed action params downstream —
and became a real, live-caught bug the moment something finally did.
The same completeness discipline already applied to fields should have
been applied to actions from the start, not retrofitted after a real
compile against a real deployment found the gap.

## `assign_task` — a new closed-vocabulary action

Added to `ACTIONS` in `vocabulary.ts`, the same "deliberate, reviewed,
never inferred" discipline that file's own header comment demands for
any addition. Its params carry either a team or a user (mirroring the
task ownership model below) and the permission required to act on the
resulting task — supplied by the rule author, not inferred from the
stage or process.

## Task ownership: exactly one of team or named user, confirmed directly

"A task should have an owner — the owner can be a team, or a named
user. If it is a team, all users of that team (with the right
permissions) should be able to access the task. If a named user, only
that user would be able to access the task." Enforced at the database
layer, not just application code: a standing invariant refuses a task
with both owners set, or neither, proven by deliberately violating
both and watching each fail before being trusted.

**The permission check is universal, applied regardless of assignment
path** — confirmed explicitly, "for now." A named-user task's assignee
still needs to genuinely hold the required permission; being named by
a rule doesn't bypass the check. Stated as a real, deliberate decision
here specifically because it was confirmed as provisional — a
candidate to revisit, not a permanent architectural commitment, and
worth tracking as such rather than letting it quietly calcify into one.

`required_permission` is validated against the closed permission
vocabulary (`isKnownPermission`) at task-creation time, the same
defense already applied to a rule's own actions and fields.

## Claiming and completing: atomic by construction, proven by deliberately breaking it

Both are single, conditional `UPDATE` statements (`WHERE claimed_by IS
NULL`, `WHERE completed_by IS NULL`), never a separate SELECT-then-
UPDATE — the same discipline already proven necessary for rule-version
activation's own statement ordering (decision 0014). `D1Result.meta.
changes` distinguishes "this request won the race" from "someone else
already had," making a stale double-claim structurally impossible
rather than merely unlikely.

Proven, not assumed: the conditional `UPDATE` was deliberately swapped
for an unconditional one, and the resulting silent double-claim (a
second team member's claim quietly overwriting the first's) was
confirmed as a real, catchable test failure before the fix was
restored.

Completing a team-owned task requires it to already be claimed, and
only by the actual claimer — completing without claiming first would
defeat the entire purpose of claiming (locking a task to one person
before they act on it). A named-user task has no claiming step at
all; it was never unowned to begin with.

## Authentication: a genuinely new shape for this codebase

Every other permission-gated route checks one fixed permission,
hardcoded to that route (`AP.Validate` for `/rules/evaluate`,
`Admin.RuleManagement` for `/rules/compile`). Claiming and completing
a task check a *dynamic* permission — the task's own
`required_permission`, looked up from D1 before `requirePermission` is
called with it. `requirePermission`'s own signature already accepted
`permission` as a parameter, so no change was needed there — this is
new *usage* of existing infrastructure, not new authorization
machinery.

Task creation itself stays unauthenticated for now, the same
administrative-setup reasoning as `/org/*`, `/org/teams`, and
`/processes`/`/processes/:id/stages` — but flagged explicitly as a
temporary state, not a permanent one: tasks are meant to be created
automatically by a fired `assign_task` action once process instances
and stage visits exist, and this direct-creation API is a stand-in for
that, the same way `compile` and `evaluate` were each provable
independently before being wired together.

## What's still open

- ~~Process instances and stage visits~~ — built in decision 0019.
- ~~The `prompt.ts` follow-up named above~~ — fixed in the addendum
  above, once decision 0019 gave it a real consumer.
- Whether the universal-permission-check-regardless-of-path decision
  holds once real usage patterns emerge — explicitly flagged as
  provisional.
- Every open question decision 0015 already named (cost centre vs.
  `org_units`, hierarchy flow-down, the `agent_approve` question) —
  none of them resolved or touched by this bundle.
