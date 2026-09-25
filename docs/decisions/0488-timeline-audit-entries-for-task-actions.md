# 0488 — Timeline/Chat audit entries for task actions

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

The Coding pilot for the larger per-stage button/action system decision
0487 deliberately left unbuilt (see its own "What was not built")
included, verbatim: *"when an action is taken for the Timeline / Chat
to be updated with the icon of the button taken, their comments and
the name of the user taking the action along with a timestamp — all
being for audit purposes."*

Scoped to the Coding pilot's own agreed sequencing (`AskUserQuestion`:
*"One stage, end to end, as a pilot"*), this is step one of five —
built and confirmed first because Reassign, Route To Approver, and
every future action all write into the same feed this decision builds.

## What was decided

**Not a blanket new log table for every action.** `activity-route.ts`'s
own header comment states a principle already fixed twice before
(decisions 0236, 0264): *"one kind of new storage, and only one... a
record able to quietly disagree with the thing it claims to
describe."* Complete, Return, Return To Supplier, and Discard are each
already fully, durably recorded on `tasks` itself
(`completed_by`/`completed_at`, `ended_by`/`ended_at`/`end_reason`/
`status`/`returned_to_stage_id`) and are each terminal — a task
completes, returns, or is discarded at most once, ever. Building a
second table recording the same events would be exactly the fault that
principle warns against, so these four derive their Timeline entries
read-time, the same way `stage_completed` already does.

**Claim and Release are the genuine gap.** Both can cycle multiple
times on the same still-open task — claimed, released, claimed by
someone else, released again — and `tasks.claimed_by`/`claimed_at` is a
single current-value pair, not a history: it can only ever show the
most recent claim. Release leaves no durable trace at all today (it
simply nulls those two columns). One new table,
`task_action_events` (migration 0083), scoped to exactly
`action IN ('claim', 'release')` — an explicit, closed list, not
inferred, widened later the same way migration 0033 widened
`tasks.status` if a future action genuinely needs it too.

**The three terminal actions are told apart purely by columns already
there**: `status = 'discarded'` is a discard; `status = 'returned' AND
returned_to_stage_id IS NOT NULL` is a return to a stage;
`status = 'returned' AND returned_to_stage_id IS NULL` is a return to
the supplier. `status = 'cancelled'` — the sibling tasks
`endTaskAndSiblings` (return-route.ts) marks moot when one of them
returns the document — is explicitly excluded: a task moot because a
colleague returned the document is not that colleague's own action,
and reading it as one would misattribute it.

**A `comment` column exists on `task_action_events` now, even though
nothing writes to it yet.** Neither `/claim` nor `/release` collects
one from a person today — the generic comment-and-OK/Cancel modal the
operator described is its own later decision in the agreed sequence.
The column is here so that modal has somewhere to write once it
exists, rather than a second migration adding it then. The two routes
already accept an optional `comment` in the request body in the
meantime (parsed leniently — a missing or unparsable body is not an
error, since every existing caller, `viewer.js`'s own `runAction`
included, posts none today).

**One unified `"action_taken"` shape**, not five different `ActivityItem`
kinds — `{kind: "action_taken", at, action, userName, comment,
targetStageName?}` — so the feed, and `activity.js`'s own rendering,
treat "a button was pressed" as one concept regardless of which table
(new, or derived) the row came from. `action` is the same closed
vocabulary `task-route.ts`, `return-route.ts`, and `icons.js` already
share (`claim`, `release`, `return`, `return_to_supplier`, `discard`),
so it doubles as the icon lookup key.

## What was built

- **`migrations/0083_task_action_events.sql`**: the new table, its full
  reasoning as a comment on the migration itself.
- **`workers/vf-app/src/task-route.ts`**: `handleClaimTask` and
  `handleReleaseTask` each take an optional `comment?: string | null`
  and insert a `task_action_events` row once their own atomic UPDATE
  succeeds — `handleReleaseTask`'s own `actor_id` is `user.id` (whoever
  released it), not `task.claimed_by` (whose claim it was), the same
  distinction its response body already draws between `releasedBy` and
  `previousHolder`.
- **`workers/vf-app/src/index.ts`**: both the combined claim/complete
  route and the release route now parse an optional JSON body for
  `comment` — leniently: a missing body, or one that fails to parse,
  simply leaves `comment` unset rather than 400ing, unlike `/return`'s
  own mandatory-reason body.
- **`workers/vf-app/src/activity-route.ts`**: `ActivityItem.kind`
  widened with `"action_taken"`. Two new derivations, both invoice-
  scoped through the same `stage_visits` → `process_instances` join
  every other derivation here already uses: `taskActionEvents` (reads
  the new table) and `taskEndedEvents` (reads `tasks` directly,
  `status IN ('returned', 'discarded')` excluding the `cancelled`
  siblings). Both wired into `handleGetActivity`'s existing
  `Promise.all`/merge/sort.
- **`workers/vf-ui/public/activity.js`**: `actionTakenLine` (the five-
  way message switch, `t("activity.claimed")` etc.); `itemRow` gives
  `action_taken` items the real action icon (`icons.js`'s existing
  `claim`/`release`/`return`/`return_to_supplier`/`discard` shapes, not
  the generic dot every other system line uses) plus the comment,
  shown underneath the message-and-timestamp row when one exists.
- **`workers/vf-ui/public/app.css`**: `.activityaction`,
  `.activityactionicon`, `.activityactionbody`, `.activitymsgrow`,
  `.activityactioncomment` — laid out the same way `.activitysysline`
  already is, with the dot swapped for a small icon and an optional
  second line beneath.
- **`workers/vf-licence/migrations/0168_task_action_events_strings.sql`**
  (new): `activity.claimed`, `activity.released`, `activity.returned`
  (`{who}`/`{stage}`), `activity.returnedtosupplier`,
  `activity.discarded` — `en` and `de`, wired into
  `workers/vf-licence/test/setup.ts` and `string-coverage.test.ts`'s
  hand-kept key list.
- **`workers/vf-app/test/setup.ts`**: migration 0083 applied;
  `task_action_events` added to `TABLES_IN_DROP_ORDER`, ahead of
  `tasks` (which it references), the same shape decision 0487's own
  `stage_actions` fix already established.
- No proxy-allowlist change needed in `workers/vf-ui/src/index.ts` —
  `/claim`, `/release`, and `/documents/:id/activity` were already
  routes in use before this decision; nothing new was added.
- Tests: `workers/vf-app/test/activity-route.test.ts` — 8 new cases
  (a bare claim, a release with a comment, a full claim/release/claim
  cycle in order, return-to-stage naming its target, return-to-
  supplier naming none, discard, a cancelled sibling never surfacing,
  and a full chronological merge alongside `received`).
  `workers/vf-app/test/task-route.test.ts` and `index.test.ts`
  unaffected by the signature change (both still pass with no comment
  argument at all). `workers/vf-app/test/index.test.ts` — 5 new cases
  in the real router: a bare claim writes a null-comment row, a
  claim's own comment is recorded, a release's comment is distinct
  from the claim it follows, a release with no body at all still
  succeeds (every pre-existing caller's own shape), and a full
  claim→release→claim cycle on a genuine engine-created task shows its
  complete history through `GET /documents/:id/activity`.
  `workers/vf-ui/test-browser/viewer.test.ts` — 5 new cases (the real
  action icon in place of the generic dot, a release's comment line, a
  return's target stage, a return-to-supplier's absence of one, a
  discard with no comment line when none was given).

## What was not built

**The generic comment-and-OK/Cancel modal, Reassign, Route To
Approver's manual-approver picker, and Return To Seller's reason/email
dropdowns** — none of them attempted here. This decision is
deliberately just the audit-trail half: the column and the read path
exist so the modal (a later, separate decision in the agreed
sequence) has somewhere to write into and something to render from
the moment it lands, but nothing yet collects a comment from a person
beyond what `/claim` and `/release` already optionally accept.

No change to `handleCompleteTask`, `handleReturnToStage`,
`handleReturnToSupplier`, or `handleDiscard` themselves — Complete's
own audit trail is `stage_completed`, already built (decision 0267);
the three return-route.ts handlers needed no new writes at all, only a
new read of what they already write.

## Verification

- `workers/vf-app`: `activity-route.test.ts` **25/25** (17 pre-
  existing, 8 new); `task-route.test.ts` + `task-list-route.test.ts` +
  `invoice-facts-route.test.ts` together **108/108**, unaffected by
  the new optional parameter; `index.test.ts` in full **185/185** (180
  pre-existing, 5 new). `tsc --noEmit` shows no new errors in any file
  this decision touched (only the same pre-existing `cloudflare:test`
  resolution noise already documented in prior decisions, and pre-
  existing, unrelated `workload*.test.ts` type errors this decision
  never touched).
- `workers/vf-licence`: migration chain replays clean
  (`apply_migrations.py --replay-only --migrations-dir
  workers/vf-licence/migrations`, 168 migrations, all assertions
  held).
- `workers/vf-ui`: `index.test.ts` (proxy allowlist) **61/61**,
  unchanged — no new route added; `viewer.test.ts` (browser)
  **209/209** (204 pre-existing, 5 new) — the same 235 unhandled-
  rejection warnings about an unstubbed
  `/api/documents/inv-1/collaborators` fetch appear identically,
  already confirmed pre-existing and unrelated in decision 0487's own
  verification.
- `migrations/apply_migrations.py --replay-only`: 83 migrations, all
  assertions held.

## Still to do, operator side

Push and deploy `vf-app`, `vf-ui`, and `vf-licence` (new migrations
0083 for `vf-app`, 0168 for `vf-licence`). Once live: claim a task,
release it, claim it again, then open its Timeline/Chat tab and
confirm the full cycle shows with names, icons, and timestamps; return
a task to a stage and to the supplier, and discard one, confirming
each reads correctly and no `cancelled` sibling appears. Then: Reassign
is next in the agreed sequence.
