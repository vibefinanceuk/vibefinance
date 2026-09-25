# 0489 — Reassign

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Step two of the agreed five-decision Coding-pilot sequence (decision
0488's own "Still to do, operator side": *"Reassign is next in the
agreed sequence"*). The operator's own original scope for the pilot
named Reassign alongside Route To Approver as one of the actions a
manager needs beyond Claim/Release/Complete: handing a task to a
specific named colleague, not just releasing it back to the pool for
anyone to pick up.

## What was decided

**No new permission — Reassign reuses Release's own two-tier standing,
exactly.** `return-route.ts`'s `checkStanding()` and `task-route.ts`'s
own (until now, inline) claim/release logic already establish the
model this codebase uses everywhere a task action needs authorising: a
person acting on their own claim needs nothing beyond holding it;
`AP.TaskManage` is the override that lets a manager act on a task
somebody else holds, or nobody has claimed yet. Reassigning is, in
every way that matters to authorisation, the same kind of act as
releasing — handing the task on rather than finishing it — so it gets
the same standing check, not a new permission invented for the
occasion. `reassignStanding()` factors this out of `task-route.ts`'s
own claim/release logic into one shared helper, so `GET
/reassign-candidates` and `POST /reassign` can never silently disagree
about who is allowed to act — the fault decision 0484 traced a
previous gap back to.

**The target must independently hold the task's own
`required_permission` — team membership on its own is not enough.**
Decision 0010 already separates team membership from permission-
holding as two different, deliberately independent facts about a
person; reassigning to a team-mate who happens not to hold the
permission the task's own stage demands would hand it to somebody the
system would refuse the moment they tried to act on it. The eligible
set is the intersection: a member of the task's owning team **and** a
holder of its `required_permission`, excluding whoever holds it now.

**The candidate list is computed by the server, not inferred by the
client.** `task-list-route.ts`'s own doc comment already states the
principle for `task.actions` itself: the UI is told what it may do, it
does not work it out. A new `GET /tasks/:id/reassign-candidates`
returns exactly the set `POST /tasks/:id/reassign` will actually
accept, so the picker can never offer a name the server would then
refuse.

**A dedicated picker, not the generic modal.** The generic comment-
and-OK/Cancel modal decision 0488 named as a later, separate decision
in the sequence does not exist yet, and Reassign needs a person to
choose *who*, not just confirm an action — a text field alone cannot
do that. `openReassignPicker` is its own small `.backdrop`/`.popout`
dialog, the same shape `viewer.js` already uses for the supplier
search and the Account Coding pop-out, with a `<select>` of candidates
and an optional comment field that flows into the same
`task_action_events.comment` column decision 0488 built.

**Widen `task_action_events`, not a second table.** Migration 0083
(decision 0488) scoped the table's `action` CHECK to exactly `('claim',
'release')`, deliberately closed and explicitly meant to widen later —
"the same way migration 0033 widened `tasks.status` if a future action
genuinely needs it too," in that decision's own words. Reassign is
exactly that future action. SQLite cannot ALTER a CHECK constraint, so
migration 0084 applies the same rebuild-the-table pattern migration
0033 itself used: create the widened table plus a new nullable
`target_user_id` column, copy the existing rows across, drop the old
table and its index, rename, recreate the index.

**`target_user_id` is its own column, not overloaded onto an existing
one.** A reassignment has two people worth recording — `actor_id` (who
reassigned it) and `target_user_id` (who it went to) — and neither
`claim` nor `release` has ever needed a second person, so the column
is nullable and populated only for `reassign` rows.

## What was built

- **`migrations/0084_task_action_events_reassign.sql`**: rebuilds
  `task_action_events` widening the `action` CHECK to include
  `'reassign'` and adding nullable `target_user_id TEXT REFERENCES
  org_users(id)`, following migration 0033's own rebuild pattern.
- **`workers/vf-app/src/permissions.ts`**: `AP.TaskManage`'s
  description widened to *"See, release, and reassign every user's
  tasks, not just your own"*, with a comment recording that Reassign
  deliberately reuses this permission rather than inventing one.
- **`workers/vf-app/src/task-route.ts`**: `reassignStanding()` — the
  shared own-claim/`TaskManage`-override check factored out for both
  new handlers to share; `handleReassignCandidates()` — computes the
  team-member ∩ permission-holder set, excluding the current claimant;
  `handleReassignTask()` — validates standing and target eligibility,
  updates `tasks.claimed_by`/`claimed_at` to the new holder, and
  inserts the `task_action_events` row (`action = 'reassign'`,
  `target_user_id` set, `viaOverride` reported the same way Release's
  own response already does).
- **`workers/vf-app/src/index.ts`**: `GET
  /tasks/:id/reassign-candidates` and `POST /tasks/:id/reassign`
  (strict JSON body, mandatory `targetUserId`, optional `comment`,
  parsed the same leniently-optional way `/claim` and `/release`
  already are).
- **`workers/vf-app/src/task-list-route.ts`**: `TaskAction` widened
  with `"reassign"`; `actionsFor()`'s three ownership branches each
  extended — a colleague's locked task under `TaskManage` now offers
  `["release", "reassign"]`; an unclaimed task under `TaskManage` now
  offers `"reassign"` alongside `"claim"`; the caller's own claimed
  task now offers `"reassign"` alongside `"release"`.
- **`workers/vf-app/src/activity-route.ts`**: `taskActionEvents()` now
  LEFT JOINs `org_users` a second time on `target_user_id`, returning
  `targetUserName` so the Timeline line can name who a task went to.
- **`workers/vf-ui/public/icons.js`**: a new `reassign` icon — a
  person silhouette with an arrow pointing to them, distinct from the
  claim/release padlock pair, since reassigning neither locks nor
  unlocks anything.
- **`workers/vf-ui/public/activity.js`**: `actionTakenLine()` extended
  with a `"reassign"` case naming both who acted and who it went to.
- **`workers/vf-ui/public/viewer.js`**: `openReassignPicker()` — fetches
  the candidate list, shows `note()`'s "nobody eligible" message
  instead of an empty picker when the list is empty, renders the
  `.backdrop`/`.popout` dialog with a `<select>` and comment box, posts
  `{targetUserId, comment}` on submit, shows the server's own error
  inline on failure without closing, and closes back to the task list
  on success — `taskActionButtons()`'s onclick dispatch special-cases
  `"reassign"` to open it instead of the generic `runAction`.
- **`workers/vf-ui/src/index.ts`**: `/tasks/:id/reassign` and
  `/tasks/:id/reassign-candidates` added to the proxy allowlist in the
  same change that added the routes — the gap decision 0484 found and
  fixed everywhere else.
- **`workers/vf-licence/migrations/0169_reassign_strings.sql`** (new):
  `action.reassign`, `action.reassign.wholabel`,
  `action.reassign.commentlabel`, `action.reassign.nonefound`,
  `activity.reassigned` — `en` and `de`, wired into
  `workers/vf-licence/test/setup.ts` and `string-coverage.test.ts`'s
  hand-kept key list.
- **`workers/vf-app/test/setup.ts`**: migration 0084 applied; no
  `TABLES_IN_DROP_ORDER` change needed, since the table itself (not
  its row shape) is unchanged from decision 0488's own entry.
- Tests:
  `workers/vf-app/test/task-route.test.ts` — 18 new cases across two
  describe blocks: reassigning a task (own claim needs no override,
  `TaskManage` overrides someone else's claim or an unclaimed task, a
  non-member/non-permission-holder target is refused, a comment is
  recorded, the previous holder's claim is replaced, standing is
  refused the same way Release's own is) and who a task can be
  reassigned to (team-member ∩ permission-holder, excludes the current
  claimant, empty when nobody qualifies).
  `workers/vf-app/test/task-list-route.test.ts` — one pre-existing
  test's expectation updated (`TaskManage` on a colleague's locked task
  now correctly includes `"reassign"`, an intended widening, not a
  regression); all other `.actions` assertions confirmed unaffected.
  `workers/vf-app/test/activity-route.test.ts` — `recordTaskAction()`
  widened for `"reassign"` and `target_user_id`; one new case (a
  reassignment's Timeline line names both people).
  `workers/vf-app/test/index.test.ts` — 4 new cases in the real router
  (a reassignment through the full stack, the candidates route, a
  refused reassignment, the Timeline read-back) — found and fixed one
  bug along the way: a `.first()` query with no action filter picked
  up an earlier `claim` row instead of the `reassign` row it meant to
  read; fixed by adding `AND action = 'reassign'`.
  `workers/vf-ui/test/index.test.ts` — 2 new `CALLED_BY_A_SCREEN`
  entries for the proxy allowlist; one pre-existing test's "genuinely
  unlisted" example path changed from `/api/tasks/abc/reassign` (now a
  real listed path) to `/api/tasks/abc/frobnicate`, the same kind of
  swap this same test needed once before, under decision 0138.
  `workers/vf-ui/test-browser/viewer.test.ts` — 5 new cases for
  `openReassignPicker`: the candidate list rendered from the server's
  own response, the "nobody eligible" note in place of an empty
  picker, a successful submit posting `{targetUserId, comment}` and
  closing, an omitted comment sent as no field at all rather than an
  empty string, and the server's own error shown inline with the
  picker left open to retry.

## What was not built

**The generic comment-and-OK/Cancel modal, Route To Approver's
manual-approver picker, and Return To Seller's reason/email
dropdowns** — none of them attempted here, unchanged from decision
0488's own scope. Reassign's comment field is its own, purpose-built
one, not a preview of the generic modal.

No change to Claim, Release, Complete, Return, Return To Supplier, or
Discard's own handlers — Reassign is additive, a new action alongside
them, sharing Release's standing check rather than altering it.

## Verification

- `workers/vf-app`: `task-route.test.ts` **45/45** (27 pre-existing,
  18 new); `task-list-route.test.ts` **62/62** (61 pre-existing, one
  updated for the intended widening); `activity-route.test.ts`
  **26/26** (25 pre-existing, 1 new); `index.test.ts` in full
  **189/189** (185 pre-existing, 4 new). `tsc --noEmit` shows no new
  errors in any file this decision touched (only the same pre-existing
  noise already documented in decisions 0487 and 0488).
- `workers/vf-licence`: migration chain replays clean
  (`apply_migrations.py --replay-only --migrations-dir
  workers/vf-licence/migrations`, 169 migrations, all assertions
  held).
- `workers/vf-ui`: `index.test.ts` (proxy allowlist) **61/61** (59
  pre-existing, 2 new); `viewer.test.ts` (browser) **214/214** (209
  pre-existing, 5 new) — the same pre-existing unhandled-rejection
  warnings about an unstubbed `/api/documents/inv-1/collaborators`
  fetch appear, scaling from 235 to 240 in exact proportion to the 5
  new tests added, confirmed by running the unmodified file and seeing
  209/235 — not a new regression.
- `migrations/apply_migrations.py --replay-only`: 84 migrations, all
  assertions held.

## Still to do, operator side

Push and deploy `vf-app`, `vf-ui`, and `vf-licence` (new migrations
0084 for `vf-app`, 0169 for `vf-licence`). Once live: as a manager
holding `AP.TaskManage`, reassign a colleague's locked task and an
unclaimed one to a named team-mate, confirm the Timeline/Chat tab
shows who it went to, and confirm a target who does not hold the
task's own required permission is correctly refused. Then: Return-
target stage configuration and the AP Setup screen is next in the
agreed sequence.
