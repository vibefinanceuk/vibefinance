# 0428 — Workload's remaining seven metrics, the screen's own full parity, six of seven whole

**Status: built and tested, not yet pushed.** This session has no push
access to `vibefinanceuk/vibefinance`; delivered as a git bundle for
the operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0427 already used. No new `vf-app` migration this decision,
so no separate `apply_migrations.py` step is needed for that package —
only the new `vf-licence` strings migration (`0139`) needs its own
`--remote` apply, the same gotcha decision 0427 hit for its own two
migrations.

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
