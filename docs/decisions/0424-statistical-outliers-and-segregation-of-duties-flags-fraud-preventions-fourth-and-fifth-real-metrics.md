# 0424 — Statistical outliers and segregation-of-duties flags — Fraud Prevention's fourth and fifth real metrics, built together

**Status: pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `a3cdbe6`, matching this session's own commit
exactly; the operator confirmed with "deployed and pushed." This
session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0423, 0562 and 0566
already used.

---

## What was asked

"What would be next" — the operator's own open-ended prompt, once
decision 0423 shipped, was pushed, deployed, and confirmed directly.
Offered four candidates: statistical outliers (recommended),
segregation-of-duties flags, Executive IQ, and Liabilities & Accruals'
remaining metrics — the design's own remaining Fraud & Risk Detection
bullets and the largest still-unbuilt screen. The operator's own
answer: **"Can you tackle 1 and 2"** — both statistical outliers and
segregation-of-duties flags, in one request, rather than one at a
time. The same bundling precedent decision 0421 already set for
Supplier Performance's own remaining six metrics.

Investigated before building, the same discipline every decision in
this arc has followed.

---

## What was built

### Statistical outliers — a z-score against a supplier's own history

`workers/vf-app/src/fraud-statistical-outliers-route.ts`, new — `GET
/fraud/statistical-outliers`. The design's own third bullet under
Screen 3 — Fraud & Risk Detection's key metrics: *"Statistical
outliers — an invoice amount well outside a supplier's own historical
range."*

**A supplier's own history, same currency, invoice excluded from its
own baseline.** Every priced, matched invoice is grouped by
`(supplier_id, currency)` — mixing currencies would make a mean
meaningless, and a different supplier's history says nothing about
this one. For each candidate invoice, the baseline mean and standard
deviation are computed from every *other* invoice in its own group —
never including the candidate itself, which would pull its own mean
toward itself and understate exactly the deviation this metric exists
to find.

**No baseline without real history — excluded, not guessed.** Fewer
than `MIN_HISTORY` (5) other same-currency invoices for a supplier
means there is no honest "historical range" yet; those invoices are
skipped entirely rather than measured against a mean of one or two
points — the same "exclude rather than fabricate" discipline decision
0421's own payment-terms route already applied to free-text parsing.

**A z-score against a stated threshold, not a hidden judgment call.**
`|z| >= Z_SCORE_THRESHOLD` (2.5 standard deviations) is the one number
this route invents, named in the route's own doc comment so it can be
argued with rather than discovered by reading the query. When every
historical invoice for a supplier carries the identical amount
(`stdDev === 0`), a z-score is undefined, not zero or infinite by
convention — a candidate that still differs from that identical amount
is flagged with `zScore: null` (an unbounded deviation, reported
honestly as "undefined magnitude" rather than a fabricated number) and
sorts first; one that matches the identical amount exactly is not an
outlier at all.

**Only matched, priced invoices are eligible.** `JOIN suppliers`, not
`LEFT JOIN` — an invoice with no matched supplier has no "supplier's
own historical range" to be outside of. (It may already be flagged by
decision 0422's own `/fraud/unapproved-suppliers` — a different risk,
a different route.)

### Segregation-of-duties flags — anchored on `AP.Approve`, generic beyond it

`workers/vf-app/src/fraud-segregation-of-duties-route.ts`, new — `GET
/fraud/segregation-of-duties`. The design's own sixth bullet, same
screen: *"Segregation-of-duties flags — the same person claiming and
approving where the process should prevent it."*

**Two designs were considered and rejected before this one.**
Hardcoding specific stage ids would violate the engine's own
established subject/stage-agnostic principle (decision 0015) — a
customer's own process shape is data, not a fixed constant this
codebase is allowed to assume. A fully generic "any two distinct
permissions completed by the same person" was rejected the other
direction: too unfaithful to the design's own specific word,
*approving*, and far noisier than the one real control this metric
exists to check — a person who completed both Validation and Coding,
with no approval at all, is not the finding the design asked for.

**The settled design is a hybrid.** One side of the pair is fixed: a
completed task whose stage declared `required_permission =
'AP.Approve'` — read from `process_stages.required_permission`
(decision 0048's own "a stage declares its own permission," the same
column `workflow-engine.ts` itself checks a rule's `assign_task`
against). The other side is generic on purpose: the same person also
completed *any other task on the same invoice whose stage required a
different, non-null permission* — rather than naming a second specific
stage or permission, which would silently stop working the day a
process is reshaped. A stage with no declared permission at all (a
pass-through stage — Matching, Coding, Review on `ap-live`, decision
0080's own automatic stages) never contributes the other half; there
is nothing to segregate from a stage nobody had to be permitted for.

**`completed_by`, not `claimed_by`, on both sides** — consistent with
`workload-route.ts`'s and decision 0423's own "credit the work
actually finished" convention. A task claimed and then reassigned or
returned was not, in the end, that person's decision.

**One flag per invoice, not per pair of tasks.** An invoice either has
this problem or it doesn't; a person who touched three non-approval
stages before approving is one finding, not three. The flagged invoice
lists every stage that person completed on it, sorted by completion
order, so a reviewer sees the whole picture at once rather than
inferring it from separate rows.

### Gating, scoping, and the screen

Both gated `AP.FraudReview`, scoped `h.org_unit_id` — the same gate
and scoping column every prior Fraud Prevention route already
established. Both are worklists, not top-N rankings, matching
`/fraud/duplicates` and `/fraud/unapproved-suppliers`'s own convention
(unlike decision 0423's capped trended rankings) — every invoice that
clears the bar is returned, nothing capped.

`workers/vf-ui/public/fraud-statistical-outliers.js` and
`workers/vf-ui/public/fraud-segregation-of-duties.js`, both new — plain
tables, the same shape `fraud-duplicates.js` and `fraud-unapproved-
suppliers.js` already use, since both routes hand back rows, not a
series. The outliers table reuses `fraudprevention.invoicenumber` /
`.supplier` / `.amount` / `.issuedate`, the same column strings every
other Fraud Prevention table already defines, and adds a deviation
column showing a signed multiple of standard deviation (`+63.6σ`) or,
for the zero-variance case, the honest word "Undefined magnitude"
rather than a fabricated number. The segregation-of-duties table
reuses `fraudprevention.user` (decision 0423's own migration 0135) and
adds a stages column listing every completed stage in order, joined
`"Coding → Approval"`.

`workers/vf-ui/public/ap-analytics.js`'s `tabContent()` "fraud" branch
now loads five cards in parallel — the same "each fails independently"
shape decisions 0422 and 0423 already established, extended from
three cards to five.

**The proxy allow-list — checked directly, not assumed.** Neither
`/fraud/statistical-outliers` nor `/fraud/segregation-of-duties`
matched any existing wildcard, confirmed with a real fetch in
`test/index.test.ts`'s own `CALLED_BY_A_SCREEN` list, and new entries
added to `PROXIED_TO_INSTANCE` — the same recurring gap decisions
0418–0423 each found and fixed for their own new paths.

**Strings.**
`workers/vf-licence/migrations/0136_fraud_prevention_statistical_outliers_and_segregation_of_duties_strings.sql`
adds both cards' own strings, English and German, reusing
`fraudprevention.invoicenumber` / `.supplier` / `.amount` / `.issuedate`
from decision 0420's own migration 0132 and `fraudprevention.user`
from decision 0423's own migration 0135.

---

## Tests

Two new route test files: `test/fraud-statistical-outliers.test.ts`
(18 tests — permission gate, the minimum-history gate, the z-score
threshold, the zero-variance `null` case and its sort-first ordering,
same-currency/own-supplier grouping, and scoping) and
`test/fraud-segregation-of-duties.test.ts` (15 tests — permission
gate, the core Approve-plus-another-permission rule in both
directions, the pass-through-stage exclusion, one-flag-per-invoice
with ordered stages, and scoping). Two new browser test files:
`test-browser/fraud-statistical-outliers.test.ts` (7 tests) and
`test-browser/fraud-segregation-of-duties.test.ts` (6 tests).
`test-browser/ap-analytics.test.ts` updated: the three-card "Fraud
Prevention renders all three of its own cards" assertion is replaced
by a five-heading assertion in order, and its own independence test
extended from three cards to five (no net new test in this file — same
23 tests, rewritten in place, the same treatment every prior card
addition to this file has had).

**Suite state, full runs:**

| Package | Before (0423) | After (0424) |
|---|---|---|
| `vf-app` | 2151 | **2184** (2151 + 33 new tests, exactly: 18 + 15) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list paths proven by new lines inside an existing test, not a new test) |
| `vf-ui` browser | 837 | **850** (837 + 13 new across the two new files; `ap-analytics.test.ts` unchanged at 23) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Fraud & Risk Detection has five of its own six metrics built now.**
Only vendor banking-detail-change alerts stays unbuilt — the design's
own words: "not currently captured by VibeFinance... noted as a real
gap, not assumed solvable." No field anywhere in this codebase records
a supplier's banking details changing at all, only their current
value; building this metric honestly would need a new change-history
concept this product does not have for any supplier field, the same
class of gap decision 0421 found for hold history.

**Everything else already listed as not built stays not built** —
Executive IQ, and Liabilities & Accruals' and Supplier Performance's
own remaining metrics are unchanged by this decision.
