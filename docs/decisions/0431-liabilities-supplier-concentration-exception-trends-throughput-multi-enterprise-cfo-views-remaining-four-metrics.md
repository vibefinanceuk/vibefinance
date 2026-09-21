# 0431 — Liabilities by entity, supplier concentration, exception trends, and throughput: the Multi-Enterprise CFO View's remaining four data-buildable metrics

**Status: built, tested, documented. Not yet confirmed pushed and
deployed** — this session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0430 already used.

---

## What was asked

"Lets move onto another topic now - are there any more dashboards to
create in the AP Analytics screens?" — the operator's own open-ended
prompt, once decision 0430's eighth addendum shipped, was pushed,
deployed, and confirmed directly against a live-test transcript. A
full breakdown of all six AP Analytics screens against the design
document's own key-metrics lists was given (`docs/decisions/0426`,
`docs/PROGRESS.md`'s own "Not built" section), and the operator chose:

*"Please can you build 'Executive IQ / Multi-Enterprise CFO View — 1
of 6 metrics built. Consolidated spend across org units/legal entities
exists.'"*

The design document's own Screen 5 — Multi-Enterprise View (Office of
the CFO) section lists six key metrics. Decision 0425 built the
first, consolidated spend, and left the other five as declined options
in its own first-metric question:

1. Consolidated spend across org units / legal entities — **built, 0425**
2. Liabilities and accruals by entity (Screen 4's own metrics, rolled
   up and compared across entities)
3. Cash position across currencies
4. Cross-entity supplier concentration — the same supplier appearing
   as a top vendor in several entities, a real negotiation and risk
   signal
5. Cross-entity exception and fraud-signal trend (Screen 3's own
   metrics, compared across entities)
6. Cross-org throughput/workload comparison (Screen 2's own metrics,
   compared across entities)

**Cash position across currencies is not buildable.** Checked directly
before any of the other four were built, not assumed: `grep -rn
"CREATE TABLE" migrations/*.sql | grep -iE "cash|bank|balance"` finds
nothing — no table anywhere in this schema captures a cash or bank
balance, the same class of gap Financial Performance's own
DPO/cash-flow-forecast/payment-history metrics already document as not
built rather than faked. This decision builds the remaining three
metrics plus supplier concentration — four in total, the operator's
own instruction read as "the rest of what's real to build," not a
metric-by-metric ranking.

**One real fork the design itself left open**, put to the operator
directly rather than assumed: cross-entity supplier concentration's
own definition of "a top vendor" and how many entities should trigger
a flag. Offered three options — top 3 per entity flagged at 2+, top 5
per entity flagged at 2+ (recommended), top 10 per entity flagged at
3+. The operator chose **top 5 per entity, flagged at 2 or more
entities**.

Investigated before building, the same discipline every decision in
this arc has followed.

---

## What was built

### The scoping decision, unchanged from 0425, applied four more times

Every new route reuses decision 0425's own resolved scoping question
exactly — no new access-control concept, no `currentOrg` narrowing:
`AP.Analysis` **and** `me.holdsEverywhere`, checked as two independent
facts, the same gate `ap-analytics.js`'s own `executiveiq` tab already
checks client-side. Grouped by the invoice's own recorded
`org_unit_id` (an invoice with none excluded, not guessed into a
bucket), never summed across currencies, uncapped rather than top-N —
the org-unit hierarchy is the enterprise's own structure, a handful to
a few dozen entities, and comparing every one of them is this screen's
entire point.

**One deliberate exception to "gate matches the tab": the fraud-signal
trend is gated `AP.Analysis` + `holdsEverywhere`, not `AP.FraudReview`,
even though the Fraud Prevention metric it rolls up lives behind that
permission on its own screen.** The tab this card lives on gates once,
on `AP.Analysis` + `holdsEverywhere` — a second, narrower gate on one
of five cards would mean the same person sees four cards and a
mysterious gap on the fifth, worse than granting or withholding the
whole tab. See `executive-exception-trends-route.ts`'s own doc comment.

### Liabilities and accruals by entity

`workers/vf-app/src/executive-liabilities-by-entity-route.ts`, new —
`GET /executive/liabilities-by-entity`. Reuses decision 0417's own
accrual definition unchanged (a process instance still `in_progress`,
sitting at a stage that is not its own process's final one, computed
per-process via `MAX(sequence)`), grouped by entity instead of by
scoped org. **One total plus one invoice count per entity, not a
further stage breakdown** — `accruals-route.ts`'s own single-org report
breaks a liability out by stage because a manager narrowed to one org
wants to know *where* in the process the money sits; this screen
compares entities against each other, so a stage-by-stage table across
a few dozen entities would be the wall-of-numbers the design's own
"roll up rather than viewed one org at a time" language exists to
avoid. `workers/vf-ui/public/executive-liabilities-by-entity.js`, new —
a ranked bar list per currency, the same shape
`executive-consolidated-spend.js` already uses, reusing
`financialperformance.invoicecount`'s existing string rather than a new
identical one.

### Cross-entity supplier concentration

`workers/vf-app/src/executive-supplier-concentration-route.ts`, new —
`GET /executive/supplier-concentration`. Top 5 suppliers by spend
within each `(entity, currency)` — never blended across currencies,
the same discipline every other monetary metric on this screen
follows — then every supplier appearing in that top 5 for 2 or more
*distinct* entities is flagged; a supplier ranking top-5 in two
currencies for the *same* entity counts as one entity, not two,
because concentration measures how many separate parts of the
enterprise depend on a supplier. An invoice naming no recognised
supplier (`supplier_id IS NULL`) is excluded entirely rather than
folded into a shared "unmatched" bucket the way decision 0423's own
`bySupplier` breakdown does — concentration is a statement about a
*named* supplier's reach, and an unmatched invoice has no stable
identity to concentrate on. Only flagged suppliers are returned; the
full top-5-per-entity working set is not the deliverable — the overlap
is. `workers/vf-ui/public/executive-supplier-concentration.js`, new —
a table, not a bar list (the figure here is *which* entities a
supplier appears in, not one number per entity), naming its own
columns the same way `fraud-exception-trends.js` already does for a
similarly multi-part row.

### Cross-entity exception and fraud-signal trend

`workers/vf-app/src/executive-exception-trends-route.ts`, new — `GET
/executive/exception-trends`. Reuses decision 0423's own exception
definition and eight-week, Monday-anchored trend window unchanged
(`stage_visits.validation_passed = 0`), grouped by entity instead of
by supplier, user, or type — a genuinely different breakdown of the
same underlying event, the same "not a re-listing" reasoning decision
0423 already gives for why it isn't just decision 0421's own card
again. Uncapped, unlike decision 0423's own top-8/top-8/top-6
breakdowns.
`workers/vf-ui/public/executive-exception-trends.js`, new — one row
per entity with `charts.js`'s own `sparkline()`, the same trend cell
`fraud-exception-trends.js` already draws.

### Cross-org throughput/workload comparison

`workers/vf-app/src/executive-throughput-route.ts`, new — `GET
/executive/throughput`. Reuses `workload-route.ts`'s own "completed in
the last 7 days" throughput definition, grouped by entity instead of
by `completed_by`. **Deliberately not the stage-bucketed chart
`workload.js`'s own card draws** — `bucketOf`/`labelFor`'s positional
folding earns its complexity showing one team's own work broken down
by process stage; comparing a few dozen entities against each other is
a different job, and a stage breakdown for each would be the same
wall-of-numbers `executive-liabilities-by-entity-route.ts` already
declines for the identical reason. A single completed-count per entity
is the figure a CFO compares; a stage breakdown for any one entity
stays one click away on Operational Performance.
`workers/vf-ui/public/executive-throughput.js`, new — a single ranked
bar list, reusing `charts.js`'s own `barList()`.

### Wiring

All four routes added to `index.ts` with the identical two-part gate
block decision 0425 established, each checked independently rather
than copy-adjusted from memory. `ap-analytics.js`'s `executiveiq`
branch changed from a single `load()`/`renderCard()` call to a
`Promise.all` of five, the same "one screen's own fetch failing never
hides another's real data" discipline `financial`, `supplier`, and
`fraud` already established — extended here from one card to five.
The proxy allow-list (`workers/vf-ui/src/index.ts`) widened decision
0425's own exact-match `/^\/executive\/consolidated-spend$/` into
`/^\/executive\/[^/]+$/`, the same wildcard-widening decision 0428
already did for `/workload/*` when six more metrics arrived at once —
one wildcard instead of four more exact-match entries for the
identical family, every path it covers checked directly with a real
fetch in `test/index.test.ts`'s own `CALLED_BY_A_SCREEN` list rather
than assumed from the pattern alone. New bilingual UI strings via a
new migration, `0142`, following `0137`'s own pattern — reusing
`executiveiq.legalentity`/`.operatingunit` (0137),
`financialperformance.invoicecount` (0130), and
`fraudprevention.exceptioncount`/`.trend` (0134) rather than
duplicating any of them.

---

## Tests

Four new backend route test files, 50 tests total:
`test/executive-liabilities-by-entity.test.ts` (13),
`test/executive-supplier-concentration.test.ts` (11),
`test/executive-exception-trends.test.ts` (14),
`test/executive-throughput.test.ts` (12) — each covering the two-part
gate as independent facts, the metric's own core definition (accrual
exclusion, top-5-and-flag logic, exception window, 7-day completed
window), grouping/currency discipline where relevant, an unplaced
record excluded rather than guessed into a bucket, an empty-not-error
report, and enterprise-wide behaviour confirming a `?org=` query is
silently ignored.

Four new browser test files, 23 tests total:
`test-browser/executive-liabilities-by-entity.test.ts` (8),
`test-browser/executive-supplier-concentration.test.ts` (5),
`test-browser/executive-exception-trends.test.ts` (4),
`test-browser/executive-throughput.test.ts` (6) — the card the route
returned, the no-`?org=`-query check every card on this screen shares,
and each card's own rendering shape (bar list, table, sparkline table).
`test-browser/ap-analytics.test.ts` updated: the old two-test
"Executive IQ renders its own real card" / "shows a real error" pair
replaced with three — five-card rendering, the five cards failing
independently, and every-fetch-fails still showing the tab-level
error — net +1 in this file. `vitest.browser.config.ts`'s own hand-
maintained module alias list gained four new entries; without them
Vite's static import analysis refuses to resolve the new cards and
every test in `ap-analytics.test.ts` fails at import time, not just the
Executive IQ ones — caught by running the browser suite, not assumed
working from the Worker suite alone.

**Suite state, full runs:**

| Package | Before (0430) | After (0431) |
|---|---|---|
| `vf-app` | 2429 | **2479** (2429 + 50 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the widened allow-list path proven by new lines inside an existing test, not a new test) |
| `vf-ui` browser | 924 | **948** (924 + 23 new across four new files, +1 net in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged — these come from
`processes.test.ts`, `documents.test.ts`, and `document-window.test.ts`,
none of which this decision touches.

`eslint .` clean across `vf-app` and `vf-ui`, every changed and new
file included.

---

## What is not built

**Cash position across currencies — the design's own sixth and last
Multi-Enterprise CFO View metric — is not buildable with this
system's current data, and is not built.** No table anywhere in the
schema captures a cash or bank balance; this is the same class of gap
Financial Performance's own DPO, cash-flow forecasting, and payment
history metrics already document as not built rather than
approximated or faked. The design's own competitive read names this as
"the clearest whitespace found in this entire benchmark" among vendors
researched — but whitespace in the market is not the same as data this
system has captured, and this decision does not pretend otherwise.

**Executive IQ now shows five of the design's own six key metrics —
one short of full parity, the same "one metric short" position
Financial Performance and Fraud Prevention are each still in for their
own, different, genuine reasons** (DPO/cash-flow-forecast/payment-
history for Financial Performance; vendor banking-detail-change alerts
for Fraud Prevention). Of the six AP Analytics screens, Supplier
Performance remains the only one at full parity with its own design
list (0421, 0427).

**The Option 2 scoping concept — a genuinely new "compare selected
orgs" scope, narrower than "everywhere I hold a role" — stays exactly
where the design document itself leaves it and where decision 0425
already left it: a decision for a future design pass, not assumed
solved by this one either.**

**Everything else already listed as not built stays not built** —
Workload's own "approaching/past due" half of tasks-pending-action and
its pulled "exceptions by user" card, Fraud Prevention's vendor
banking-detail-change alerts, Financial Performance's own remaining
metrics, and every other parked item are unchanged by this decision.
