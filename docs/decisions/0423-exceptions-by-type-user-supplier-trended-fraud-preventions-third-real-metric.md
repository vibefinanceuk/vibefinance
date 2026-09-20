# 0423 — Exceptions by type, by user, by supplier, trended — Fraud Prevention's third real metric

**Status: built, committed locally — not yet pushed or deployed.** This
session has no push access to `vibefinanceuk/vibefinance`; delivered
as a git bundle for the operator's own pull/push/deploy sequence, the
same path decisions 0391, 0415–0422, 0562 and 0566 already used.

---

## What was asked

"What would you suggest next?" — the operator's own open-ended prompt,
once decision 0422 shipped, was pushed, deployed, and confirmed
directly. Offered four candidates; the operator chose **exceptions by
type/user/supplier, trended**, the design's own fifth bullet under
Screen 3 — Fraud & Risk Detection's key metrics: *"Exceptions by type,
by user, by supplier — trended, so a rising exception rate from one
supplier or one user is visible before it is a pattern."*

Investigated before building, the same discipline every decision in
this arc has followed.

---

## What was built

### A genuinely new metric, not decision 0421 again

`workers/vf-app/src/fraud-exception-trends-route.ts`, new — `GET
/fraud/exception-trends`. An exception is still `stage_visits.
validation_passed = 0`, decision 0021's own persisted verdict, the
same definition `dashboard-route.ts`'s own `exceptionsBySupplier` card
and decision 0421's own `supplier-exceptions-route.ts` already use.
But this is not a re-listing of that card: decision 0421's own metric
lives on **Supplier Performance**, gated `AP.Supplier`, scoped by the
supplier's own org unit, reporting one aggregate rate per supplier
over 90 days. This one lives on **Fraud Prevention**, gated
`AP.FraudReview`, scoped by the invoice's own org unit — the identical
scoping rule decision 0420's own `fraud-duplicates-route.ts` already
established, and the only one available here, since an unmatched
invoice has no `supplier_id` and so cannot use Supplier Performance's
own supplier-org rule. And it adds a breakdown decision 0421 never
attempted at all — **by user** — trended weekly rather than reported
as one static number.

### Trended as counts, not rates — and why

Eight calendar weeks, Monday-anchored (`dates.ts`'s own
`mondayOfThisWeek()`, decision 0265's "calendar week, not a rolling
seven days" convention, stepped back seven times). Long enough to show
a real pattern — the same "a season, not a week" reasoning decision
0421 gave its own 90-day window; short enough that eight points make a
legible sparkline.

**A rate per week was rejected on purpose.** A single week's own
denominator (a handful of visits) is small enough that one exception
out of one visit reads as "100% this week" — noise dressed as a
signal. A plain weekly count avoids inventing a smoothing or threshold
this data does not honestly support. The design's own words ask only
that a rise be *visible*, and a rising bar in a sparkline already
shows that without this route deciding for the viewer what counts as
"rising."

### `sparkline()`'s first real caller

`charts.js`'s own `sparkline()` was built by decisions 0242/0265 and
has sat unused since — `dashboard.js`'s own doc comment says so
verbatim: *"it stays in `charts.js`, tested, for whichever card next
has a real trend and no room to show it plainly."* This is that card.
Three short ranked tables (`workers/vf-ui/public/fraud-exception-
trends.js`) — by supplier, by user, by type — each row carrying its
own eight-week sparkline in a trend column, rather than a bare number.

### "By user" measures handling, not the exceptions themselves — a real, stated asymmetry

`workflow-engine.ts`'s own documented behaviour: a failing stage visit
can spawn **more than one task**, one per matching line, "since
different lines can genuinely need different approvers." Crediting an
exception to a user reuses `workload-route.ts`'s own established
join — `tasks.stage_visit_id = stage_visits.id`, crediting whoever
`completed_by` names — the identical unit that route already counts
throughput by. So a visit with three line-level tasks, finished by
three different people, credits each of them once. **`byUser`'s own
totals therefore answer "how much exception-handling work has this
person done," not "how many exceptions,"** and can legitimately exceed
the exception count `bySupplier`/`byType` show for the same window — a
real, documented difference in what each breakdown measures, verified
directly with a test (two line-level tasks on one visit, completed by
two different people, credits both once each while `byType`'s own
total for that visit still reads 1). An exception whose task nobody
has completed yet — including one still open — carries no user credit
at all; the other two breakdowns still count it.

### The unmatched-supplier bucket stays one entry

An invoice with no matched supplier (`supplier_id IS NULL`) groups
into a single shared entry (`supplierId: null`) rather than one entry
per printed name — the same reasoning decision 0420 already gives for
treating a printed name (`BT-27`) as a raw fallback, not a stable
identity to group or trend by. The UI names that entry
(`fraudprevention.nosupplier`); the route only reports it.

### Gating, scoping, and the screen

Gated `AP.FraudReview`, scoped `h.org_unit_id` — the sibling of
`/fraud/duplicates` and `/fraud/unapproved-suppliers`, not a new rule.
`workers/vf-ui/public/ap-analytics.js`'s `tabContent()` "fraud" branch
now loads three cards in parallel — the same "each fails
independently" shape `financial` (0419) and `supplier` (0421) already
established, extended to Fraud Prevention's own third card.

**The proxy allow-list — checked directly, not assumed.**
`/fraud/exception-trends` matched no existing wildcard, confirmed with
a real fetch in `test/index.test.ts`'s own `CALLED_BY_A_SCREEN` list,
and a new entry added to `PROXIED_TO_INSTANCE`, the same recurring gap
decisions 0418–0422 each found and fixed for their own new paths.

**Strings.**
`workers/vf-licence/migrations/0135_fraud_prevention_exception_trends_strings.sql`
adds the new card's own strings, English and German, reusing
`fraudprevention.supplier` from decision 0420's own migration 0132.

---

## Tests

One new route test file, `test/fraud-exception-trends.test.ts` (25
tests) — permission gate, the eight-week window (bucketing at both
edges, exclusion outside it, the `validation_passed` filter), each of
the three breakdowns (including the unmatched-supplier grouping and
the documented "credits both reviewers once each" line-level case),
and scoping. Every test hands the route a fixed `now` rather than the
wall clock, so which week a fixture lands in is exact. One new browser
test file, `test-browser/fraud-exception-trends.test.ts` (9 tests).
`test-browser/ap-analytics.test.ts` updated: the two-card "Fraud
Prevention renders both of its own cards" test is replaced by an
assertion over all three headings in order, and its own independence
test extended from two cards to three (no net new test in this file —
same 23 tests, rewritten in place, the same treatment the switch from
0421's cycle-time card to 0421's own six-card assertion already had).

**Suite state, full runs:**

| Package | Before (0422) | After (0423) |
|---|---|---|
| `vf-app` | 2126 | **2151** (2126 + 25 new tests, exactly) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list path proven by new lines inside an existing test, not a new test) |
| `vf-ui` browser | 828 | **837** (828 + 9 new in the new file; `ap-analytics.test.ts` unchanged at 23) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Fraud & Risk Detection's own other three metrics stay unbuilt** —
statistical outliers, vendor banking-detail-change alerts (the
design's own words: "not currently captured by VibeFinance... noted
as a real gap, not assumed solvable"), and segregation-of-duties
flags. Unchanged by this decision; see `docs/PROGRESS.md`'s own "Not
built" section for the full list.

**Everything else already listed as not built stays not built** —
Executive IQ, and Liabilities & Accruals' and Supplier Performance's
own remaining metrics are unchanged by this decision.
