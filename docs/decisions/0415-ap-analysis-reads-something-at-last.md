# 0415 — `AP.Analysis` reads something at last

**Status: built, pushed, and deployed — including a second bug, found
live and fixed after the first deploy, itself now confirmed live.**
This session had no push access to `vibefinanceuk/vibefinance` and
delivered both commits as bundles (0611, then 0613 for the fix) for
the operator's own pull/push/deploy sequence. Confirmed directly
rather than taken on the report alone, in two stages: the first deploy
via `origin/main` fetched directly reading `26f8c86`, `GET
/api/ui-strings?locale=en` on live `vf-licence` returning all six new
`workload.*`/`nav.workload` values, and the live `workload.js`,
fetched directly, being the real code — not a stale build. The
proxy-allow-list fix is confirmed a different way: a screenshot from
the operator of the live screen after redeploying `vf-ui`, showing a
real user's real throughput (Alice McDonald, 2 completed, the
Validation bucket in its own colour with a matching legend dot) —
direct visual evidence that the whole path now works end to end:
auth, the permission gate, the scoped query, the proxy, and the chart
render together. `vf-app`'s own deploy rested on the operator's report
at both stages — the API sits behind auth, not independently checkable
from here — and for the first deploy that trust turned out to be
misplaced in the other direction: `vf-app` was never the problem. See
"A second bug, found live" below.

---

## What was asked

The Management Dashboard & Analytics research/design deliverable
(a Claude Docs write-up and five Design-canvas mock-up screens, not
this repo) sketched five screens, none of them real. Mid-way through a
later edit to one of those mock-ups — stacking the Workload screen's
"Throughput by user" chart by stage, with a key — the operator asked
directly: *"In order to make this a reality - what would you start
with?"*

The answer given: one vertical slice, not the other four screens.
**"Throughput by user, stacked by stage"** specifically, because it
needed no new permission (`AP.Analysis` already exists in
`permissions.ts`, described at the time as real data — `invoice_runs`
— that *"no screen shows it yet"* reads back) and no new scoping
concept (every other analysis card already threads through
`unitsWherePermitted` / `unitClause`). The reply: *"lets go!"*

**One real conflict surfaced along the way**, not decided silently.
The approved design stacks 7 AP stages (the real seeded `ap-live`
process: received, validation, matching, coding, approval, review,
payment-eligible); `tokens.css` caps categorical chart colours at
exactly 5, with a stated principle — *"a chart needing a sixth is a
chart needing a table."* Asked directly rather than picked either way
unilaterally: the operator chose **"Merge to 5 buckets."**

---

## What was built

**`workers/vf-app/src/workload-route.ts`, new.** `handleWorkloadThroughput(db, userId, currentOrg?, limit = 10)` —
completed tasks (`status = 'completed'`, `completed_by IS NOT NULL`) in
the last 7 days, grouped by who completed them and which stage, scoped
via `unitClause(scope, "h.org_unit_id")` against `AP.Analysis` exactly
the way `dashboard-route.ts`'s own `done()` scopes a person's own
week — widened here to every user the caller may see, because this is
a manager's screen rather than a personal one.

**The 5-bucket merge is positional, not nominal.** `process_stages` is
customer-configurable data (decision 0008) — the exact reason the
design's own literal "Matching & Coding" / "Review & Payment-eligible"
merges could not be hardcoded, since they would be wrong for any
customer whose process has a different shape. Instead:

```ts
function bucketOf(sequence: number, totalStages: number): number {
  const raw = Math.ceil((sequence * MAX_CHART_COLOURS) / Math.max(totalStages, 1));
  return Math.min(Math.max(raw, 1), MAX_CHART_COLOURS);
}
```

A stage's own `sequence` within its own process maps proportionally
onto one of 5 buckets. For 5 or fewer stages the formula is strictly
increasing, so nothing merges that does not have to. For the real
7-stage `ap-live` process it reproduces the operator's own approved
merge exactly — Matching(3) and Coding(4) both land in bucket 3,
Review(6) and Payment-eligible(7) both land in bucket 5 — verified by
hand and by test (below), not asserted. A bucket's own legend label is
built from whichever real stage names actually fell into it
(`labelFor`), never a hardcoded string.

**The route, wired into `index.ts`** as `GET /workload/throughput`,
following the `/dashboard` GET route's own template exactly:
`resolveTenant` → `authenticatePerson` → 401 → `hasPermission(db,
auth.user.id, "AP.Analysis")` → 403 → the handler → `json(result.body,
result.status)`.

**The real UI.** `workers/vf-ui/public/workload.js`, new — one card,
fetched from `/api/workload/throughput`, rendered with two new exports
from `charts.js`:

- `stackedBarChart(rows)` — vertical bars, one per user, stacked by
  bucket. **Colour is passed in per segment, not computed from a
  segment's position in its own row** — `donutChart`'s existing
  `chart-${i % 5}` trick only works because every ring draws its own
  complete segment list; here two users can hold different subsets of
  the same 5 buckets (one touched every stage this week, another only
  three of them), so a segment's colour has to travel with the real
  bucket it names, never with where it lands in one particular row's
  own filtered array — the dataviz skill's own non-negotiable, "colour
  follows the entity, never its rank."
- `chartLegend(items)` — a key row, reused for any chart without a
  ring to sit beside (`donutChart`'s own legend assumes exactly that
  layout).

`workload.js` computes `colourFor(bucket) = var(--chart-${bucket})`
once and uses it for both the chart and the legend, so the two are
provably the same colour for the same bucket — the property the test
below checks directly, not assumed.

**Nav, icon, strings.** `tasks.js` gains `NAV_PERMISSIONS.workload =
"AP.Analysis"` and a `["workload", "workload"]` entry in the
"Accounts payable" nav group, between Dashboard and Tasks. `icons.js`
gains a `workload` icon — the same path data as the approved mock-up's
own nav icon. `workers/vf-licence/migrations/0127_workload_throughput_strings.sql`
adds `nav.workload`, `workload.heading`, `workload.sub`,
`workload.throughput`, `workload.throughputsub`, and
`workload.nothroughput`, in English and German, following the
`en`/`de` seeding convention every recent `ui_strings` migration
already uses.

**`AP.Analysis`'s own description corrected.** It read *"View AP
analysis data — no screen shows it yet"* in `permissions.ts`; a
screen does now, so it reads *"See the Workload screen's team
throughput."*

---

## A real bug, found by the test that was checking for something else

The first version of `workload-route.ts` kept `bucketStageNames` as a
`Map<number, Set<string>>` and built each bucket's label from the
`Set`'s own insertion order. That order was never the process's own
sequence — it was SQL row order, and the query's `GROUP BY
t.completed_by, s.id` groups by the stage's own id, alphabetically.
For the real `ap-live` shape that read bucket 3's label as **"Coding &
Matching"** — `c` before `m` — rather than "Matching & Coding," the
process's own order and the only one `labelFor`'s own doc comment ever
promised.

Caught by the bucketing test asserting the exact legend labels, not by
inspection. Fixed by keying each bucket's stage names to their own
sequence (`Map<number, Map<string, number>>`) and sorting by sequence
before building the label, rather than trusting `Set` insertion order.
Re-run after the fix: passes, along with the other 13 tests in the
same file that had already passed against the buggy version — this
one genuinely needed the exact-label assertion to surface at all.

---

## A second bug, found live: `vf-ui`'s own proxy never learned this route

Reported from the screen, after the first deploy was confirmed
pushed and live: *"I see the Workload menu option as my user, but I
cannot click it"* — clarified to *"When I click 'Workload,' literally
nothing happens (page stays as-is)"*, cursor still changing to a
pointer, so the link itself was real. Redeploying `vf-app` on the
working theory that it had not picked up the new route changed
nothing, which disproved that theory outright.

The actual cause: `workers/vf-ui/src/index.ts`'s `/api/*` handler is
**an explicit allow-list, not a forwarder** (decision 0102) —
`PROXIED_TO_INSTANCE`, checked by `mayProxy()` before anything is sent
to `vf-app`. `/workload/throughput` was never added to it. This
decision's own "What was built" section originally claimed *"the
generic `/api/*` proxy needed no change"* — that claim was wrong, not
a simplification; there is no generic proxy, and this decision simply
never added the one line the allow-list needed. Confirmed directly:
`vf-ui`'s own proxy returned `{"error":"not found"}` with a 404 before
the request ever reached `vf-app`, matching the browser console error
reported (`GET .../api/workload/throughput?org=acme-group 404`)
exactly, and matching the symptom exactly — `workload.js`'s own
`load()` treats a non-OK response as a silent failure and returns
early with nothing rendered, no error surfaced, which is why the
screen looked like it did nothing at all.

**This is not a new class of bug in this file.** `workers/vf-ui/src/index.ts`
documents at least seven prior instances of the same gap, by decision
number, going back to 0212 — a route shipped on `vf-app` and never
added to this list, found only when a real click or a real `curl`
came back 404. This decision is an eighth. The allow-list's own doc
comment names exactly why it stays an allow-list rather than becoming
a forwarder (a forwarder would have shipped three write routes above
an admin gate, decision 0097, by exactly this kind of inattention) —
the cost of that choice is that adding a route and adding it here are
two separate steps, and nothing ties them together but a habit this
decision failed to follow.

**Fixed** by adding `/^\/workload\/throughput$/` to
`PROXIED_TO_INSTANCE`, grouped with the other "what a person should do
next" entries (`/dashboard`, `/dashboard/catalogue`) rather than left
wherever it happened to fit. **Regression test**: `test/index.test.ts`'s
own decision-0131 block — *"the proxy carries every path a screen
calls"* — exists for exactly this failure mode (its own doc comment:
*"reported from the screen: the rename button did nothing"*) and
already asserts, for a hand-maintained list of every path a real
screen calls, that none of them come back 404. `GET
/api/workload/throughput` is now on that list. Re-run: 74 `vf-ui`
Worker tests pass, count unchanged (an entry added to an existing
test, not a new one) — and the test would have caught this before the
first deploy had it been added when the route was.

Only `vf-ui` needed redeploying for this fix — the bug never reached
`vf-app`, and `vf-app`'s own route and tests are unchanged by it.

**Confirmed live, by screenshot rather than by report.** After the
operator pulled bundle 0613, pushed, and redeployed `vf-ui` only, the
Workload screen rendered the real thing: one bar for Alice McDonald,
total 2, a single Validation segment in its own bucket colour, and a
legend dot in the same colour with a matching count — the nav click
that previously did nothing now runs the whole path end to end. This
is stronger evidence than the first deploy's own confirmation (fetched
strings and served JS, not a rendered screen with real data flowing
through auth, the permission gate, and the scoped query all at once).


**`workers/vf-app/test/workload.test.ts`, new — 14 tests.**

- The route's own permission gate: 200 with `AP.Analysis`, 401 with no
  credentials, 403 with the wrong permission (`AP.Review`, the same
  deliberately-wrong-permission convention `index.test.ts`'s own
  decision-0276 block uses) — through a real `SELF.fetch`, not a
  direct handler call.
- Bucketing: the real 7-stage `ap-live` shape merges exactly as
  approved (asserted on bucket numbers, labels, and counts together,
  not just one of the three); a process with 5 or fewer stages gets
  one bucket per stage; a differently-named customer process never
  reads "Matching" or "Coding" in its own labels, proving the
  bucketing is genuinely positional and not a disguised special case
  for `ap-live`.
- Scoping: counts only within the units `AP.Analysis` is held in,
  counts everywhere when unrestricted, narrows to a chosen org, counts
  nothing when the permission is not held in the chosen org at all —
  the same shape `dashboard.test.ts`'s own org-scoping tests already
  take for `AP.Review`.
- The 7-day window: a task completed 10 days ago is excluded; empty is
  `{ users: [], legend: [] }`, not an error.
- Ranking and `limit`: most-completed first; capped at the given
  limit.

**`workers/vf-ui/test-browser/workload.test.ts`, new — 7 tests**,
following `dashboard.test.ts`'s own stub-`fetch`-and-render pattern:
the heading and card title read from the route's own strings; the
empty state says so rather than drawing an empty chart; one `<rect>`
per bucket a user actually has (not one per legend entry — two users
with different subsets of the 5 buckets draw different segment
counts); user names and totals render on the chart itself; the legend
keys every bucket the route named, in order, with its own real total;
and — the one this file exists to prove — **a segment's colour is
read off its own bucket, not its position in one user's own row**:
Dana's second segment (bucket 3) and Wei's second segment (bucket 5)
sit at the same array index in their own rows but get different
colours, and the legend's own dot for "Matching & Coding" matches the
chart's own bucket-3 segment exactly.

**Required an alias.** `vitest.browser.config.ts`'s own `resolve.alias`
map is how `/workload.js` (an absolute, server-root-style import, the
same convention every other screen module already uses) resolves
under Vite; every existing screen module is listed there by hand, and
`workload.js` was not, so the test file's own `import("/workload.js")`
failed to resolve until it was added — one line, alongside
`/dashboard.js`.

**Suite state, full runs:**

| Package | Before | After |
|---|---|---|
| `vf-app` | 1970 | **1984** (1970 + 14 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite + a `--replay-only` of the root D1 chain both re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged) |
| `vf-ui` browser | 732 | **739** (732 + 7 new) |

The known, pre-existing `vf-ui` browser unhandled-rejection count
(160, unchanged through decision 0414) is unchanged — confirmed by
re-running `document-window.test.ts` alone against a clean, stashed
tree: the same 2 rejections that file alone always produces, present
before this decision's own changes and untouched by them.

`eslint .` clean across the whole repo, every changed and new file
included.

---

## What is not built

**The other four Management Dashboard screens** (Supplier Performance,
Fraud & Risk Detection, Liabilities & Accruals, Multi-Enterprise CFO
View) stay exactly what they were: a Claude Docs design document and
Design-canvas mock-ups, not routes or UI in this repo. This decision
is the one vertical slice through the pattern, not the rest of the
design — each of the other four still needs its own route, its own
scoping question worked out (the CFO view in particular needs a real
multi-org concept that does not exist yet), and its own decision.

**No arranging, no saved layout, no catalogue** for the Workload
screen — one fixed card, unlike the Dashboard's own arrangeable set.
Nothing asked for that yet.

**No drill-through.** Dashboard's own cards link out to Tasks or
Documents, filtered; the Workload chart does not, yet — clicking a bar
or a legend key does nothing. Not asked for, and less obviously right
here than on Dashboard: "show me the tasks behind this bucket, for
this user, in the last 7 days" is a real filter combination the task
list does not currently support (`ownership` and `stage` exist;
"completed by a specific other person in a date range" does not).
