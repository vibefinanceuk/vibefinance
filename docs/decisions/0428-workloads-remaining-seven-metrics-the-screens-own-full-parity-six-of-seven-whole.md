# 0428 — Workload's remaining seven metrics, the screen's own full parity, six of seven whole

**Status: pushed and deployed, confirmed directly — original build and
both addenda.** `origin/main` fetched directly reads `32a99d5`,
matching this session's own commit exactly. The operator confirmed
"deployed and pushed" directly, along with a screenshot of the
Workload Balance card showing the same person, "Alice McDonald," with
an identical count in every one of seven teams. Investigated rather
than dismissed: a real scoping choice in this decision's own first
build, not a query-duplication bug — fixed in the first addendum below
(`0c646a7`). Separately, the Exceptions by user card drew a real
governance concern the moment it was seen live — investigating it
further surfaced a second, more fundamental flaw in the calculation
itself. The operator chose to pull that report entirely rather than
ship a partial fix — see the second addendum below (`a861a69`,
`32a99d5`). The operator's own final confirmation, "pushed and
deployed," covers all of it. This session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0427 already used.

---

## What was asked

**"shall we tackle - User & Team Workload 1/8. - 7 metrics, none
previously tracked"** — the operator's own explicit instruction.
Decision 0426 had corrected `docs/PROGRESS.md`'s own record: Workload's
count against its own design list had never actually been checked
before that correction, and only "Throughput by user, stacked by
stage" (0415) existed of its own eight key metrics.

Both the design document and the real codebase were investigated
directly before building anything, the same discipline this whole arc
has followed. The design's own Screen 2 (User & Team Workload) full
key-metrics list, re-read directly rather than from memory:

1. Throughput by user, by business unit, by team/group (0415 — "by
   user" only, already built)
2. Open task count by user, split by ownership (mine/available/locked)
3. Average handling time by stage and by user
4. Claim-to-complete cycle time
5. Tasks pending action over a configurable period, and tasks
   approaching/past due
6. Team queue depth — available (unclaimed) vs. locked (claimed but
   not finished)
7. Workload balance — variance in open-task count across a team
8. Exceptions by user

Six of the remaining seven have no real blocker: `tasks`, `org_teams`,
and `stage_visits` already carry everything each needs. **One has a
genuine, previously-undocumented structural gap**: metric 5 names two
things — "pending over a period" and "approaching/past due" — and
"past due" needs a due date. **No per-task due date exists anywhere in
this schema.** The only date-like concept anywhere near a task is
`hold_until`, and it is not a task property at all: it is a fired rule
*action*, recorded in the activity log *against an invoice*
(`activity-route.ts`'s own `describeAction`, `case "hold_until":
return \`held until ${p.date}\`;`), never a queryable column on a
*task*. Confirmed by grepping the whole codebase for every use of
`hold_until` — it appears only in `activity-route.ts`, its own test,
two browser test files, one `vf-licence` migration, and
`vocabulary.ts` itself (the closed action vocabulary) — never a schema
column.

Two real decisions were put to the operator directly, via
`AskUserQuestion`, rather than assumed or silently narrowed:

1. **How much of the remaining seven should this decision build?**
   Offered building them one at a time (narrower, more decisions to
   review) against all seven together (broader, one decision, since
   none of the six straightforward ones has any real dependency on
   another). The operator chose **all seven together**.
2. **Given the due-date gap, how should "tasks pending action and
   approaching/past due" be handled?** Offered building "pending over
   a period" only, honestly leaving "approaching/past due" unbuilt and
   documented as a real gap, against holding the whole metric back
   until a due-date column exists. The operator chose **"pending over
   a period" only** (recommended).

---

## What was built

### Seven new routes, all reusing existing tables — no new `vf-app` migration

All gated `AP.Analysis`, matching every other route on this screen,
all in `workers/vf-app/src/`:

- **`GET /workload/open-tasks`** (`workload-open-tasks-route.ts`) —
  per-user open-task counts, plus one shared `available` (unclaimed)
  total. **Deliberately drops the per-viewer "locked" ownership
  concept** `task-list-route.ts`'s own `ownershipOf` computes relative
  to one viewer — it is inherently relative-to-viewer (a task claimed
  by someone else is "locked" to me, "mine" to them) and meaningless as
  an absolute per-user column in an aggregate manager view. The
  "available" total is the card's own note line, not a bar of its
  own — it belongs to nobody, so it isn't a user to rank.

- **`GET /workload/handling-time`** (`workload-handling-time-route.ts`)
  — average claim-to-complete hours, grouped by *(stage, user)*
  (`TOP_N = 15`, sorted by average descending). A matrix, not a single
  ranked dimension, so rendered as a plain table
  (`workload-handling-time.js`) — the same shape decision 0427's own
  hold-history card already established for a metric the design gives
  no visualization suggestion for.

- **`GET /workload/cycle-time`** (`workload-cycle-time-route.ts`) — the
  same claim-to-complete hours measurement as handling-time, but
  aggregated per user only, no stage breakdown (`TOP_USERS = 10`). The
  design's own adjacent-but-distinct bullet to handling time, built as
  its own separate metric rather than folded into one card — "how long
  a task sits once somebody has it, not just how long it waits."

- **`GET /workload/pending`** (`workload-pending-route.ts`) — open
  tasks older than 3/7/14-day thresholds
  (`PENDING_THRESHOLDS_DAYS = [3, 7, 14] as const`), measured from
  `created_at`, not `claimed_at`. Split by user, plus one shared
  `unclaimed` row. **A bug caught by its own test and fixed before
  shipping**: the route originally listed every owner with any open
  task, even one whose bucket counts were all zero; fixed to omit a
  user with nothing past even the shortest threshold, rather than show
  a dishonest row of zeros. Only builds the "pending over a period"
  half of the design's own bullet — see "What was asked" above for why
  "approaching/past due" is not built.

- **`GET /workload/queue-depth`** (`workload-queue-depth-route.ts`) —
  available vs. locked task counts per team, for `owner_team_id IS NOT
  NULL` tasks only. Scoped by the team's own org unit
  (`unitClause(scope, "tm.unit_id")`, decision 0064's own "a team
  belongs to an org") rather than reaching through a task's own
  invoice — more direct for a team-level metric than this screen's own
  usual invoice-org-unit join chain. Rendered with `stackedBarChart`
  (`workload-queue-depth.js`), the same chart `workload.js`'s own
  throughput card already uses, two fixed segments (available, locked)
  instead of a stage's own colour-coded buckets.

- **`GET /workload/balance`** (`workload-balance-route.ts`) — per-team
  variance in open-task count across that team's own members
  (population `mean`, `variance`, `stdDev`), teams sorted
  most-imbalanced-first. Each member's own open-task count is scoped
  by the same invoice-org-unit clause every user-level route on this
  screen already uses, via a `LEFT JOIN` so a member with zero open
  tasks still gets a `0` row rather than being silently dropped.
  Rendered as one labelled group per team
  (`workload-balance.js`) — the same "one group, labelled, per
  top-level entity" shape decision 0427's own discount-eligibility card
  established for currencies, applied here to teams. **A new
  `.teamgroup`/`.teamgrouphead` CSS class pair**, not `.spendcurrency`
  reused — matching decision 0417's own naming discipline (a first
  draft, `.cardhead2`, was rejected before it was ever used, for
  reading as a lazy collision-avoidance hack rather than an honest
  name).

- **`GET /workload/exceptions`** (`workload-exceptions-route.ts`) —
  reuses decision 0423's own exact exception definition
  (`stage_visits.validation_passed = 0`, joined through
  `process_instances`/`invoice_headers`/`tasks`), but gated
  `AP.Analysis` rather than `AP.FraudReview`, and framed as coaching
  rather than fraud review — "not to assign blame, but to see where
  extra support or training would help," the design's own words. A
  flat count over 90 days (`WINDOW_DAYS = 90`, `TOP_USERS = 10`), not
  trended.

### Wiring

`workers/vf-app/src/index.ts` — seven new route blocks, immediately
after the existing `/workload/throughput` block, each following the
same shape: resolve tenant, authenticate, check `AP.Analysis`, call the
route, return its `{status, body}`.

`workers/vf-ui/public/ap-analytics.js` — the `operational` branch of
`tabContent()` rewritten from a single-card load into an eight-card
`Promise.all`, each card failing independently — the same discipline
`financial`, `supplier`, and `fraud` already established.

**`vf-ui`'s `PROXIED_TO_INSTANCE` regex widened, not extended with
seven new exact-match entries.** The pre-existing exact
`/^\/workload\/throughput$/` becomes `/^\/workload\/[^/]+$/`, matching
the `/suppliers/[^/]+$/` precedent this same file already established
for Supplier Performance's own sibling-route family, now that Workload
has eight sibling endpoints under one prefix rather than one.

**Strings.**
`workers/vf-licence/migrations/0139_workload_remaining_seven_metrics_
strings.sql` — 34 keys, English and German (68 rows): every card's
title, subtitle, empty state, table headers, and note-line templates.
Checked against the pre-existing `workload.*` keys (`heading`,
`nothroughput`, `sub`, `throughput`, `throughputsub`) before writing —
no collisions.

---

## Tests

Seven new backend test files, `workers/vf-app/test/workload-*.test.ts`
(one per route), 54 tests total: open-tasks 9, handling-time 8,
cycle-time 7, pending 8 (including the zero-row-omission fix), queue-
depth 7, balance 7 (including a variance-arithmetic check: counts
`[4,0]` → mean `2`, variance `4`, `stdDev` `2`), exceptions 8. Run
together with the pre-existing `workload.test.ts`: 68 tests, 8 files,
all passing.

Seven new browser test files,
`workers/vf-ui/test-browser/workload-*.test.ts`, 41 tests total: open-
tasks 6, handling-time 5, cycle-time 5, pending 7 (including the
dynamic-threshold-header case and the conditional Unclaimed row),
queue-depth 5, balance 5, exceptions 5.

`test-browser/ap-analytics.test.ts` updated: the "Operational
Performance renders workload.js's own card" test rewritten to expect
all eight cards, matching decision 0427's own precedent for Supplier
Performance's eight-card test; a new "eight cards fail independently"
test added, matching that same precedent; the doc comment's own list of
what this file does not re-prove extended; seven new default route
stubs added to `openApAnalytics()`; all 34 new `workload.*` strings
added.

`workers/vf-ui/test/index.test.ts` — seven new `CALLED_BY_A_SCREEN`
entries, proving the widened wildcard actually proxies every new path
through a real fetch, not inferred from the regex alone.

**Suite state, full runs:**

| Package | Before (0427) | After (0428) |
|---|---|---|
| `vf-app` | 2233 | **2287** (2233 + 54 new, across the 7 new workload route test files) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged — the widened wildcard is proven by 7 new entries inside one existing test's own loop, not 7 new tests) |
| `vf-ui` browser | 873 | **915** (873 + 41 new across the 7 new card test files, + 1 net new in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414 — `document-window.test.ts`/
`documents.test.ts`, an async-cleanup quirk unrelated to any file this
decision touches) is unchanged in the full-suite run.

`eslint .` clean across every new and changed file in `vf-app` and
`vf-ui` (`app.css` is not covered by any eslint config, as always —
not an error). `tsc --noEmit` clean on every backend file this decision
touches.

---

## What is not built

**Workload now has six of its own eight key metrics built whole, and a
seventh built half** — "pending over a period" (3/7/14-day
thresholds), honestly not "approaching/past due," which needs a
due-date column that does not exist anywhere in this schema. Workload
is the second of the design's six dashboard screens (after Supplier
Performance) to reach practical parity with its own design list, with
this one open, clearly-documented exception.

**A note for whoever picks up a due-date column next**: if `tasks`
(or invoices) ever gain a real due date, "approaching/past due" slots
directly into `workload-pending-route.ts`'s own existing shape — the
same per-user, per-threshold table, with a due-date-relative bucket
set instead of an age-relative one. Not built here, and not assumed
equivalent without checking — due dates and task age answer different
questions (a task can be three days old and already overdue, or thirty
days old and not due for a month), but the route and card shape both
carry over.

**Every other design screen's own "Not built" state is unchanged by
this decision** — see `docs/PROGRESS.md`'s own "Not built" section for
Liabilities & Accruals, Fraud & Risk Detection's one remaining metric,
the Multi-Enterprise CFO View's remaining five, and Screen 6 ("Talk to
an AP Expert"), none of which this decision touched.

---

## Addendum — the balance card's own scoping, found live and corrected

**"deployed and pushed- the chart seems to show replication though,"**
with a screenshot of Workload Balance: seven teams (AP Coding, AP
Matching, AP Review, AP Supplier Maintenance, AP Team, AP Validation,
Supplier Maintenance), every one showing the same person, "Alice
McDonald," with the same identical count of 2.

**Investigated directly rather than patched on sight.** Reading
`workload-balance-route.ts` again: `org_team_members` was joined
correctly per `team_id`, so the memberships themselves were real, not
a query-duplication artefact. What was global, by this decision's own
first design, was the *count* beside each name — every open task
`owner_user_id`/`claimed_by` that member anywhere, not scoped to the
team the card was showing. Mathematically that's exactly what was
built and documented in the route's own doc comment ("their own whole
open workload, not just the slice one team happens to hold"), and it
explains the screenshot precisely: if one person belongs to every
team, every team's own card shows her identical global total.

**Put to the operator directly, two separate questions** (via
`AskUserQuestion`), rather than assumed:

1. **Is the team membership itself real** — is Alice McDonald
   genuinely meant to be on all seven teams? Confirmed: **yes, that's
   real** — expected for an early pilot with one person staffed across
   every team.
2. **Should the count stay global, or become team-scoped?** Offered
   keeping the whole-workload reading (catches a person spread thin
   across many teams, at the cost of showing identical numbers for
   anyone in more than one) against scoping each team's own count to
   tasks that team itself owns (a truer "who's carrying this team's
   own queue," at the cost of missing load from outside the team). The
   operator chose **team-scoped**.

**Fixed**: `workload-balance-route.ts`'s own task join gained one more
condition, `AND t.owner_team_id = tm.id`, alongside the existing
owner/claimed-by and `status = 'open'` checks — the same
`owner_team_id` column `workload-queue-depth-route.ts` already reads
for its own team-level metric. A member on two real teams now shows a
different, smaller number in each, based on which team actually owns
each of their open tasks, rather than their one global total repeated
everywhere. The route's own doc comment rewritten to record both the
original reasoning and why it changed, so a future reader sees the
real tradeoff rather than just the current behaviour.

**Two new backend tests** added to `workload-balance.test.ts`, both
passing: one seeding the exact shape of the bug report — one member on
two real teams, tasks split between them — proving each team now shows
only its own share; one proving a task with no owning team at all
(`owner_team_id IS NULL`) is honestly excluded even when it is
genuinely that member's own task, rather than silently counted
anywhere. `openTask()`'s own test helper gained an optional `team`
parameter; every pre-existing call site updated to pass the owning
team explicitly, since the route no longer counts an unscoped task at
all. `workload-balance.test.ts`: 7 tests → **9**. Full `vf-app` suite
re-run clean: **2287 → 2289** (101 files, all passing). `vf-ui` is
unaffected — this fix is backend-only, no route response shape
changed, so `vf-ui` stays at 74 Worker · 915 browser. `eslint`/`tsc`
clean on both changed files (the same pre-existing, unrelated
`cloudflare:test` module-resolution and test-file type-narrowing noise
as every other decision in this arc, not new).

**A broader note, for whoever next builds a per-member metric that
spans more than one team**: "which team's own tasks" and "this
person's whole workload" are both real, different questions, and nothing
in the design document's own wording forces one over the other — this
decision guessed at build time and production caught it. Worth asking
directly, the next time it comes up, rather than assuming either
reading generalizes.

---

## Second addendum — Exceptions by user, pulled live

**"There is an exceptions by user report which says 'Not to assign
blame — to see where extra support or training would help.'"** No
request attached — just the subtitle, quoted back. Rather than assume
what was wanted, this was put to the operator directly: explain the
reasoning, change the wording, or flag a real concern. The operator
chose **flag a real concern**.

**The concern, stated directly, was correct on both counts:**

1. **Naming individual users in a ranked exceptions list is a real
   governance risk, whatever the subtitle says.** The card names the
   top 10 users by exception count, gated only behind `AP.Analysis` —
   a broad permission, not the narrower `AP.FraudReview` gate decision
   0423 used for the *identical* underlying exception data in Fraud
   Prevention. A subtitle disclaiming blame is copy, not an access
   control; it does nothing to stop the same ranked, named list being
   used in a performance review or a disciplinary conversation.
2. **The calculation itself measures the wrong thing.** Investigating
   `workload-exceptions-route.ts` directly at the operator's own
   request confirmed it exactly: a raw `COUNT(*)` of validation
   failures credited to `completed_by`, over a 90-day window, with
   **no denominator** — no total-tasks-completed alongside it. The
   operator's own read was exact: *"if it is a raw count of the items
   processed in exception by a user, that does not indicate that they
   need training. It indicates that they are the most productive."*
   Someone completing 500 tasks at a 2% error rate (10 exceptions)
   would outrank someone completing 20 tasks at a 40% error rate (8
   exceptions) — the opposite of what a "who needs support" metric
   should show. Not a presentation flaw; the metric measures volume,
   not accuracy.

**Two separate questions were then put to the operator, via
`AskUserQuestion`, rather than fixed on assumption:**

1. **How should individuals be identified**, given the governance
   concern — keep named with a rate added, de-identify entirely, or
   leave as built for now. The operator's own answer went past the
   options offered, straight to the calculation itself — confirming
   the raw-count reading above was the real issue, ahead of the
   identification question.
2. **Should the access gate be narrowed** from the broad `AP.Analysis`
   to something closer to `AP.FraudReview`. The operator chose
   **narrow it**.
3. **Given the raw count is confirmed misleading, how should it be
   fixed** — rank by rate with count as context (recommended), add
   rate but keep ranking by count, or pull the report entirely. With
   both a broken calculation *and* an unresolved access question still
   open at once, the operator chose **pull the report entirely** —
   explicitly declining a partial fix.

**What was done.** No route, no card — not narrowed, not
recalculated, removed:

- `workers/vf-app/src/index.ts` — the `/workload/exceptions` route
  block and its `handleWorkloadExceptions` import removed, replaced
  with a doc comment recording why and where the working code still
  lives.
- `workers/vf-app/src/workload-exceptions-route.ts` and
  `workers/vf-app/test/workload-exceptions.test.ts` deleted.
- `workers/vf-ui/public/ap-analytics.js` — the `workload-exceptions.js`
  import and its slot in the operational tab's `Promise.all` removed;
  the tab is seven cards again, not eight.
- `workers/vf-ui/public/workload-exceptions.js` and
  `workers/vf-ui/test-browser/workload-exceptions.test.ts` deleted.
- `workers/vf-ui/vitest.browser.config.ts` — its path alias removed.
- `workers/vf-ui/test/index.test.ts` — its `CALLED_BY_A_SCREEN` entry
  removed (nothing calls it any more); the `/^\/workload\/[^/]+$/`
  wildcard itself is untouched and would still proxy it if a screen
  ever called it again.
- `workers/vf-ui/test-browser/ap-analytics.test.ts` — the operational
  tab's own tests reverted to seven cards; the `workload.exceptions*`
  strings and default route stub removed; the doc comment updated.

**Nothing about `vf-licence` migration `0139` changes.** It is already
applied live, and this project's own convention is that a migration is
never edited after the fact. Its four `workload.exceptions*` keys
simply go unused by any screen now — harmless, and cheaper to leave
than to write a removal migration for four dead string rows.

**Deliberately not deleted from git history.** `workload-exceptions-
route.ts` and `workload-exceptions.js` are fully recoverable from
commit `7fd97e0` — the complete, tested implementation, ready for
whoever redesigns the calculation (a rate, not a raw count) and the
access gate (narrower than `AP.Analysis`) together, rather than being
rebuilt from nothing.

**Suite state:** `vf-app` 2289 → **2281** (−8, the deleted route's own
test file). `vf-ui` browser 915 → **910** (−5, the deleted card's own
test file); `vf-ui` Worker stays at 74 (one array entry removed, not a
parametrized test). `vf-licence` unaffected. Full suites re-run clean:
`vf-app` 100 files / 2281 tests, `vf-ui` browser 42 files / 910 tests
(same pre-existing 160 unhandled-rejection baseline as every other
decision in this arc), `vf-ui` Worker 61 tests. `eslint`/`tsc` clean on
every changed file.

**Workload's own standing, corrected**: six of its own eight key
metrics built and live, one built half (pending-over-a-period, not
approaching/past-due), one built and then pulled (exceptions by user).
Not the full parity with its own design list the first addendum's own
"six of seven whole" framing implied — see `docs/PROGRESS.md`'s own
"Not built" section for the corrected record.
