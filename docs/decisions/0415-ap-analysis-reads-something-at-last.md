# 0415 — `AP.Analysis` reads something at last

**Status: built, not yet pushed** (this session has no push access to
`vibefinanceuk/vibefinance` — delivered as a bundle, same as every
other unpushed commit here).

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
fetched from `/api/workload/throughput` (the generic `/api/*` proxy
needed no change), rendered with two new exports from `charts.js`:

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

## Tests

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
