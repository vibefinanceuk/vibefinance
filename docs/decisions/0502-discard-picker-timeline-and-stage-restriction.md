# 0502 — Discard gets a real picker, a stage restriction, and a Timeline check

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Four questions, reported live once decision 0501's own fix was
confirmed working:

> The Discard button needs updating. The popup control when pressed is
> not the format of this site, but I think native browser format.
> Also, I suspect that no message is tracked in the timeline / chat
> when submitted. Can we also check that the discard button can only
> be pressed in the validation queue. Once it is validated, coded or
> matched, and approved - the user should not be allowed to discard.
> Do existing configurations permit that? Also, what happens when
> discarded, does it reach a terminal stage, and what happens to the
> status?

## What was found

Checked directly, not assumed, before building anything:

1. **The native popup — real.** Discard was the last action on this
   screen still using `window.prompt()`. Reassign, Return, Route To
   Approver and Return To Supplier were each already moved to a real
   `.backdrop`/`.popout` (decisions 0489, 0490, 0495, 0498); Discard's
   own code comment recorded this as a deliberate scoping choice at
   the time — *"the operator was asked directly whether this pass
   should upgrade Discard's identical prompt() alongside Return To
   Supplier's own, and chose to keep this scoped to the button
   actually reported on."*

2. **The Timeline message — no bug found.** Discard's own audit trail
   was built in decision 0488, derived read-time from `tasks
   .ended_by`/`ended_at`/`end_reason`/`status = 'discarded'`, rendered
   by the exact same shared code path Release and Return already use
   — both directly tested with a real comment showing. A backend test
   (`activity-route.test.ts`) already proves a discard produces a
   Timeline entry. The one real gap was in *test coverage*, not
   behaviour: nothing exercised a discard's own reason text rendering
   at the browser level (only the "no comment given" case was
   tested) — closed here.

3. **The stage restriction — real, and confirmed absent.** Discard was
   offered purely by permission: `AP.Discard` plus the task's own
   stage `required_permission`, with no notion of stage at all
   (`actionsFor`, `task-list-route.ts`). A person holding `AP.Discard`
   could discard a document already validated, coded, matched, or
   approved — the opposite of the intended rule.

4. **What discarding does today** — unchanged by this decision, only
   restated: `process_instances.status` becomes `archived` (decision
   0078), `current_stage_id` is left exactly where it was, as history,
   the same design decision 0055 section 7 already established for
   `returned_manually`. As of decision 0501, the Documents list also
   now correctly reads "Archived" for it, rather than the old
   "Waiting"/"In progress" — a benefit that extends to Discard as much
   as to Return To Supplier, since both share `statusOf()`.

## What was decided

**All three real items get fixed; nothing changes about what
discarding does to the data**, since that was never in question.

- **A dedicated picker**, the same minimal `.backdrop`/`.popout` shape
  `openReturnPicker` already uses for its own required reason — just
  with no target stage or team to choose, since discarding leaves the
  process entirely rather than moving anywhere. The reason is checked
  client-side before ever calling the server (the same rule the server
  already enforces, decision 0075), so the most common way to get this
  wrong costs no round trip.
- **A per-stage restriction, reusing `stage_actions` (decision 0487)
  rather than a new table.** `'discard'` was already reserved in its
  own `KNOWN_ACTIONS` list, with no column of its own yet — exactly
  the extension point that decision's own migration comment
  anticipated. A new `discard_allowed` column, its own body field on
  the same `PUT /processes/stages/:id/actions/:action` route
  `reverifyRuleOnComplete` already uses, enforced both server-side
  (`handleDiscard` itself refuses, 409) and client-side (the button is
  never offered).
- **Defaults to allowed everywhere — the `offer_field_restrictions`
  (0081) direction, not `reverify_rule_on_complete`'s (0082) own
  opposite one.** Turning this off silently removes a button already
  available today; turning reverify-on-complete *on* was introducing a
  brand new refusal nothing had ever enforced before. Absence of a row
  (true for every stage right now) reads as allowed, matching live
  behaviour exactly — nothing changes for anyone until an operator
  explicitly restricts a stage, the same "was on for everyone, cannot
  silently go dark" reasoning 0081's own migration comment gives for
  its own opposite default.
- **Surfaced on the existing Stage Restrictions tab**, a new checkbox
  alongside the reverify-on-complete toggle, independent of the
  Account Coding restrictions above it — an Approval stage with no
  Account Coding fields to restrict can still want Discard switched
  off. Checked means allowed, so unchecking is the restriction: the
  operator now goes and unchecks it for Coding, Matching and Approval,
  leaving Validation checked, which is the actual fix for what was
  asked.

## What was built

- **`migrations/0091_stage_actions_discard_allowed.sql`**: adds
  `discard_allowed` to `stage_actions`, default 1.
- **`workers/vf-app/src/stage-actions-route.ts`**: `handleSetStageAction`
  now branches on `action` — `discard` reads/writes `discardAllowed`
  in its own body field rather than overloading
  `reverifyRuleOnComplete`. New `stageAllowsDiscard(db, stageId)`.
- **`workers/vf-app/src/return-route.ts`**: `handleDiscard` refuses
  (409, `reason: "discard_not_allowed_here"`) when the stage disallows
  it, checked ahead of the reason requirement.
- **`workers/vf-app/src/task-list-route.ts`**: `actionsFor` gains a
  `discardAllowed` parameter (default `true`), looked up once per
  distinct stage (the same caching shape `offerRouteToApprover` already
  uses), only queried at all for someone who holds `AP.Discard` in the
  first place.
- **`workers/vf-app/src/process-route.ts`**: `StageDetail` gains
  `discardAllowed`, read the same way `reverifyRuleOnComplete` already
  is, for the Stage Restrictions tab to render.
- **`workers/vf-ui/public/viewer.js`**: `openDiscardPicker` — a
  reason textarea, inline error box, Discard/Close buttons. `window
  .prompt()` and `ACTIONS_NEEDING_A_REASON` retired for Discard, the
  last entry on that list.
- **`workers/vf-ui/public/ap-setup.js`**: `setStageDiscardAllowed`,
  and a new toggle row on the Stage Restrictions tab, sitting alongside
  `reverifyToggleRow` in both the offered and not-offered branches.
- **`workers/vf-licence/migrations/0178_discard_picker_and_stage_restriction_strings.sql`**:
  `action.discard.reasonlabel`, `apsetup.stagerestrictions
  .discardallowed`, en/de.
- **Tests**: `workers/vf-app` — `stage-actions-route.test.ts` (new
  `handleSetStageAction`/`stageAllowsDiscard` coverage for `discard`),
  `return-route.test.ts` (a new `describe` covering the 409 refusal,
  checked ahead of the reason requirement, re-enabling, and that one
  stage's restriction does not leak to another), `task-list-route.test.ts`
  (the button hidden/shown correctly, other actions at the same stage
  unaffected, a different stage unaffected), `process-route.test.ts`
  (`discardAllowed` defaults true, carries a configured `false`
  through the read). `workers/vf-ui` — `viewer.test.ts` (the picker
  opens instead of `prompt()`, an empty reason refuses inline with no
  round trip, Close posts nothing, a typed reason posts, the server's
  own 409 shows inline without closing the picker; plus a new
  discard-with-comment Timeline test closing the coverage gap found
  during investigation), `ap-setup.test.ts` (the new toggle's default
  state, toggling off/on, the PUT body, save-failure revert, and that
  it does not disturb the reverify toggle in the same panel).

## What was not built

No change to `endTaskAndSiblings`, `process_instances.status`, or
`current_stage_id` — decision 0078's own terminal-state design was
never in question, only restated. No change to the Timeline/Chat
rendering itself — investigation found no bug, only a coverage gap,
now closed. No generic comment-and-OK/Cancel modal — Discard's picker
follows the same dedicated-picker precedent Reassign, Return, Route To
Approver and Return To Supplier already established; that broader
consolidation remains its own, later, separate decision.

## Verification

- `workers/vf-app`: `stage-actions-route.test.ts`, `return-route.test.ts`,
  `task-list-route.test.ts` together **125/125** (22 new). `process-route.test.ts`
  **73/73** (2 new). Full suite, batched across 119 files,
  **2983/2985** — the two failures are the same confirmed
  pre-existing, unrelated `capture-pdf.test.ts` and
  `stage-permissions.test.ts` gaps this session has verified via
  `git stash` before. `npx eslint`/`npx tsc --noEmit` clean on every
  touched file (the `cloudflare:test` typecheck gap remains the same
  repo-wide, pre-existing condition). `migrations/apply_migrations.py
  --replay-only`: 91 migrations, all assertions held.
- `workers/vf-licence`: `string-coverage.test.ts` **10/10** (2 new
  keys).
- `workers/vf-ui`: `viewer.test.ts` (browser) **passing**, six new
  Discard-picker tests plus one new Timeline-comment test. `ap-setup
  .test.ts` (browser) **69/69** (6 new). Full browser suite
  **1182/1183** — the one remaining failure is the same pre-existing,
  unrelated `typography.test.ts` gap. Plain suite **75/75**, unchanged
  (the `/actions/:action` proxy pattern was already generic enough to
  need no allowlist change).

## Still to do, operator side

Push, then redeploy **`vf-app`** and **`vf-ui`**, and apply migration
`0178` to `vf-licence`:
```
wrangler d1 execute vf-licence-poc --remote --file=workers/vf-licence/migrations/0178_discard_picker_and_stage_restriction_strings.sql
```
(database name illustrative — use this deployment's own). Then, in AP
Setup → Stage Restrictions, uncheck **Allow Discard at this stage**
for Coding, Matching, and Approval — Validation is the only stage
meant to keep it checked. That checkbox is the actual fix for the
business rule asked about; nothing here restricts any stage on its
own.
