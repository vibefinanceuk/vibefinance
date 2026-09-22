# 0439 — Approval Hierarchy: the migration and the resolver

**Status: built, tested. Not yet documented in a screen, and not yet
pushed or deployed** — this session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0438 already used.

---

## What was found

A new "AP Setup" nav section was requested, with Matching, Account
Coding and Approval Hierarchy as its three tabs — Approval Hierarchy
first, and Employee-Supervisor its first routing mode. Investigating
first, before building anything, found more already in place than the
backlog note ("the frame is built; nothing calls it") suggested:

- **Supervisor** already existed: `org_users.manager_id` (decision
  0334).
- **Approval Limit** already existed: `org_authority_limits
  (user_id, currency, max_amount)` (decision 0009).
- **Cost-Object mode was fully built and unused**: `resolveApprovalChain`
  in `ledger-route.ts` (decision 0195) walks a cost centre's parent
  chain, stopping at the first owner whose limit covers the amount —
  real code, wired to nothing.

**The exact gap the operator named directly was real**: both
`manager_id` and `org_authority_limits` are global per person — one
supervisor, one limit per currency, no org dimension. *"A user might
have a limit in EUR for Acme France, but a limit in GBP for Acme UK"*
could not be expressed.

Four open questions were settled directly before anything was built:

1. **The routing mode is a customer-wide default**, and applies only
   at the Approval stage — reached once Validation, Matching and
   Coding are all complete.
2. **A Default Approver**, configured alongside the mode, catches a
   routing gap — the operator's own answer, since a superuser limit
   high enough to never run out of amount headroom is the plan, but a
   missing supervisor or cost centre owner is a different kind of gap
   entirely.
3. **Exactly one mode active at a time**, but **multiple tasks per
   invoice** where line-level approval is requested — each reporting
   back to the invoice's own timeline, and the instance advancing only
   once every one of them is complete.
4. **The Employee-Supervisor chain starts from whoever coded the
   line** — the person who completed the task on that line at
   whichever stage immediately precedes Approval, not a new field.

## What was built

**Additive, not a rebuild — the `stage_field_visibility_overrides`
shape (decision 0197), not the `org_user_roles` one (decision 0199).**
A unit-scoped fact here is an override of a global default that
already exists and already works, so this adds two new tables beside
the existing global ones rather than rebuilding either:

- `org_user_supervisor_overrides (user_id, unit_id, supervisor_id)` —
  unit-scoped only; `org_users.manager_id` stays the group-wide
  default, untouched.
- `org_authority_limit_overrides (user_id, unit_id, currency,
  max_amount)` — same shape, alongside the untouched
  `org_authority_limits`.

Both are read through `unit-config.ts`'s own `unitLineage()` walk —
most specific unit wins, falling back to the group-wide default — the
same resolver rule sets and field visibility already use, and the one
its own doc comment already named approval hierarchies as the next
candidate for.

**`org_approval_config`** — a singleton, the same shape `org_settings`
already established (decision 0077): `mode` (`employee_supervisor` |
`cost_object` | `manual` | `api`) and `default_approver_user_id`.
Manual and API are named in the vocabulary, matching how
`permissions.ts` already lists `AP.Match`/`AP.Code` as real strings
with no route behind them yet — not built one migration at a time.

**`process_stages.uses_approval_hierarchy`** — the same shape decision
0200 already gave `required_permission`: a stage-level declaration
that overrides what a rule says, rather than a second vocabulary a
rule author could disagree with. A stage marked this way ignores
whatever `team`/`user` its own `assign_task` rule names and resolves
through the config instead.

**`workers/vf-app/src/approval-hierarchy.ts`** — the resolver:

- `resolveApprovalLimit` / `resolveSupervisorId` — the override-then-
  default lookups described above.
- `findLineCoder` — the stage immediately before the current one
  (structurally, by sequence — never a hardcoded stage id), and the
  most recent `completed_by` on that line's task there.
- `resolveApprovalHierarchy` — employee_supervisor climbs from the
  coder through `resolveSupervisorId`, testing each person's own
  `resolveApprovalLimit` against the amount; **a person with no limit
  recorded escalates rather than approves everything** — the opposite
  of `resolveApprovalChain`'s own null-limit convention, because an
  unset limit here means "not set up as an approver," not "unlimited
  by design." cost_object calls `resolveApprovalChain` directly — the
  first thing that does. manual/api fall straight to the Default
  Approver, or report unresolved, never faking a result.

**`workflow-engine.ts`** — `pendingTaskActions` now carries each
evaluation's own facts (BT-131/BT-112 amount, BT-5 currency, BT-133
cost centre) alongside the line number; a stage with
`uses_approval_hierarchy` set calls the resolver instead of reading
`params.team`/`params.user`, and an unresolved result 409s with a
named reason (`approval_hierarchy_unresolved`) rather than creating a
task with no real owner.

**Already free, no new code**: multiple tasks blocking one stage visit
until all are complete (decision 0015/0019's own existing behaviour) —
line-level approval spawning several tasks and gating on all of them
needed nothing new here.

## Tests

`workers/vf-app/test/approval-hierarchy.test.ts` (new, 21 tests): the
override-then-default lookups (including the operator's own EUR-at-
Acme-France/GBP-at-Acme-UK example directly), `findLineCoder`, and
`resolveApprovalHierarchy` across employee_supervisor (single-step,
escalation, no-limit-escalates, chain-exhausted-to-default,
chain-exhausted-unresolved, no-coder-found), cost_object, and
manual/api.

`workers/vf-app/test/workflow-engine.test.ts` (+2): a full Coding →
Approval run where the Approval rule names a decoy team and the
resolved Employee-Supervisor target (the coder's own supervisor, once
escalated) is what the real task carries instead; and the 409 a stage
gets when the hierarchy cannot resolve anything and no Default
Approver is configured.

**Suite state**: vf-app 2490 → **2513** (+23: +21 approval-hierarchy's
own, +2 workflow-engine's own), all passing, full unfiltered run.
`eslint` clean. Migration chain replays clean (75 migrations, all
assertions held).

## What is not built

**The screen** — "AP Setup," its three tabs, and the Approval
Hierarchy tab's own mode picker and Default Approver picker. This was
deliberately sequenced after the migration and resolver, at the
operator's own instruction, and should follow `access.js`'s own UI
conventions once built.

**The write API** for the two new override tables and
`org_approval_config` — nothing in `org-route.ts` lets an operator set
a unit-scoped limit, a unit-scoped supervisor, the active mode, or the
Default Approver yet. Today's only way to populate any of it is direct
SQL, which is exactly what the tests above do. The screen and its API
are the same next piece of work.

**Turning `uses_approval_hierarchy` on for a real stage** — nothing in
`process-route.ts`'s `handleCreateStage`/`handleUpdateStage` exposes
this flag yet either; today it can only be set by hand, the same way
the tests set it.

**Matching and Account Coding**, AP Setup's other two tabs — both
remain genuinely greenfield, as found during investigation: no config
screen for either, and no Coding stage exists in any real process yet.

**Manual and API modes** — named in the vocabulary, no resolver.
Selecting either today always lands on the Default Approver, or
reports unresolved if none is configured.
