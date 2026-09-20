# 0418 — The accruals report excludes the payment-eligible stage

**Status: pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `ea47035`, matching this session's own commit
exactly; the operator confirmed the live screen itself: "deployed and
pushed - I see the accruals now." This session still has no push
access to `vibefinanceuk/vibefinance`; delivered as a git bundle for
the operator's own pull/push/deploy sequence, the same path decisions
0391, 0415, 0416, 0417, 0562 and 0566 already used.

---

## What was asked

With decision 0417's AP Analytics tab shell shipped, confirmed live
("I have the new AP Analytics dash now"), asked directly which of the
three remaining vertical slices to build next — Financial Performance
(Liabilities & Accruals), Fraud Prevention (Fraud & Risk Detection),
Executive IQ (the Multi-Enterprise CFO View) — or extend Supplier
Performance's own other six metrics instead. **Financial Performance**
was chosen, recommended for the same reason 0415 and 0416 each
recommended themselves: no new scoping concept, and the tab it lands
in is already reachable by anyone who reaches Operational Performance
(`AP.Analysis`).

The design document lists six key metrics for Liabilities & Accruals.
The same "one real vertical slice" discipline decisions 0415–0417 each
already followed: the design's own first bullet — **"Accruals
report — invoices received but not yet at the payment-eligible stage
(the final stage of VibeFinance's real 7-stage AP process), the
natural definition of a liability not yet settled"** — because it
needed no payment-execution data this codebase does not capture (three
of the other five metrics do: payment history, payment terms held vs.
actual, and the DPO trend it feeds all depend on knowing when and on
what terms an invoice was actually paid, which nothing here records)
and reuses exactly the stage/sequence machinery `workload-route.ts`
already established for a different reason.

---

## What was built

**`workers/vf-app/src/accruals-route.ts`, new.** `handleAccruals(db,
currentOrg?, userId?)` — one query joining `process_instances` (status
`'in_progress'`, the same filter `dashboard-route.ts`'s own
`whereThingsAre()` already uses) to its `current_stage_id` and the
invoice behind it, scoped via `unitClause` against the invoice's own
org unit and `AP.Analysis` — the same permission the rest of this tab
already checks.

**The final stage is excluded, computed per process, never assumed.**
A second query gets `MAX(sequence)` per `process_id` seen in the first
result set — the same shape `workload-route.ts`'s own
`totalStagesByProcess` already reads, for a different reason — and any
row sitting at that stage is dropped before grouping. An invoice at
its own process's last stage has reached payment-eligibility, so by
the design's own definition it has stopped being merely accrued.
Proven per-process rather than hardcoded: a test seeds a 2-stage
process alongside data, confirming the "final" stage excluded there is
stage 2, not a number borrowed from `ap-live`'s own 7.

**Never summed across currencies, the same discipline decision 0416
established.** Grouped by `(currency, stage)`; each currency gets its
own total and its own stage breakdown. **Invoices missing a total or a
currency are excluded**, not counted as zero, for the same reason
0416's own route already gives.

**Broken out by stage, in process order — not ranked by size.** The
design's own suggested visualization, "Stat tile + table broken out by
stage," reads naturally as the money's own path through the process,
earliest stage first. This is a real, deliberate difference from
Supplier Performance's own biggest-first ranking, proven directly: a
test puts the largest amount at a later stage and confirms the smaller,
earlier-stage amount still lists first.

**The real UI.** `workers/vf-ui/public/accruals.js`, new — built
straight as `load()`/`renderCard()` from the start, never a standalone
screen with its own `open()`, unlike Workload and Supplier Performance
before decision 0417 folded them in. Reuses `charts.js`'s existing
`barList`, the same component Supplier Performance already uses.
**Always shows its own currency total, even in the ordinary
single-currency case** — a real difference from
`supplier-performance.js`'s own bare currency-code label, which that
screen's common case hides entirely: here the accrued total is the
report's own headline figure (the design's own "stat tile"), not
merely a disambiguation between currencies. A new, honestly-named CSS
class, `.accrualcurrency`, carries this — not `.spendcurrency` reused,
whose own header is deliberately bare for a different reason.

**Wired into the Financial Performance tab.** `ap-analytics.js`'s
`tabContent()` gains a `financial` case calling `accruals.js`'s own
`load()`/`renderCard()`, the same shape `operational` and `supplier`
already use. Financial Performance is now the third of AP Analytics'
five tabs to be real; Executive IQ and Fraud Prevention remain
permission-gated placeholders.

**The proxy allow-list — checked directly this time, immediately, not
after a live report.** `/accruals` matches no existing wildcard on
`vf-ui`'s `PROXIED_TO_INSTANCE` (unlike `/suppliers/spend`, decision
0416's own case), so it needed — and got — a real new entry, added in
the same change as the route itself. A regression test
(`["GET", "/api/accruals"]` in `test/index.test.ts`'s own decision-
0131 block) proves it reachable by a real fetch.

**Strings.**
`workers/vf-licence/migrations/0130_financial_performance_accruals_strings.sql`
adds `financialperformance.accruals`, `financialperformance.accrualssub`,
`financialperformance.noaccruals`, `financialperformance.accrued`, and
`financialperformance.invoicecount`, in English and German.

---

## Tests

**`workers/vf-app/test/accruals.test.ts`, new — 18 tests.**

- The route's own permission gate: 200 with `AP.Analysis`, 401 with no
  credentials, 403 with the wrong permission (`AP.Review`), through a
  real `SELF.fetch`.
- **What counts as an accrual**: an invoice at an earlier stage
  counts; one sitting at its own process's final, payment-eligible
  stage is excluded; the final stage is computed per process (a
  2-stage process's own final stage is stage 2, proven directly rather
  than assumed from `ap-live`'s own 7); a process instance already
  `'completed'` is excluded regardless of stage; empty is `{
  currencies: [] }`, not an error.
- **Never summed across currencies**: a single currency produces one
  total equal to a plain sum; a multi-currency accrual splits into one
  figure per currency, with the combined total asserted absent from
  the response anywhere; currencies ordered by their own total, most
  significant first; an invoice missing a total or a currency is
  excluded rather than counted as zero.
- **Broken out by stage, in process order**: stages within a currency
  list earliest-first even when a later stage carries the larger
  amount, proven directly by putting the bigger figure at the later
  stage and checking order did not follow size; every invoice at the
  same stage sums and counts together.
- Scoping: counts only invoices within the units `AP.Analysis` is held
  in, counts everywhere for somebody unrestricted, narrows to a chosen
  org, counts nothing when the permission is not held in the chosen
  org at all — the same shape `workload.test.ts`'s and
  `supplier-spend.test.ts`'s own scoping blocks already take.

**`workers/vf-ui/test-browser/accruals.test.ts`, new — 7 tests**,
following `supplier-performance.test.ts`'s own stub-`fetch`-and-render
pattern: the heading and card title read from the route's own
strings; the empty state says so rather than drawing an empty list;
the chosen org is threaded through to the fetch; a single currency
still shows its own total (the real difference from Supplier
Performance's own single-currency case) and draws its stages in
process order rather than ranked by size; more than one currency
draws each in its own labelled, totalled section, and never shows one
blended figure across currencies.

**`workers/vf-ui/test-browser/ap-analytics.test.ts`, updated, not
just re-passed.** The one test that asserted Financial Performance
said "not built yet" no longer holds — split into a real wiring test
("Financial Performance renders accruals.js's own card") alongside the
still-accurate "Executive IQ and Fraud Prevention each say not built
yet." A new test proves the Financial Performance tab's own
load-failure path renders the same real error `apanalytics.js`
already gives Operational Performance's own failure. The `STRINGS`
fixture and the default route stubs (`openApAnalytics`'s own helper)
both gained `/api/accruals` and its strings, the same treatment
`/api/suppliers/spend` already got when Supplier Performance's own
wiring test was written.

**Suite state, full runs:**

| Package | Before (0417) | After (0418) |
|---|---|---|
| `vf-app` | 1998 | **2016** (1998 + 18 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list entry is proven by a new line inside an existing test, not a new test) |
| `vf-ui` browser | 762 | **772** (762 + 7 new in `accruals.test.ts`, + 3 net new in `ap-analytics.test.ts` after splitting the one stale test into three) |

The known, pre-existing `vf-ui` browser unhandled-rejection count
(160, unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Five of Liabilities & Accruals' own six metrics.** Early-payment/
dynamic-discount eligibility, cash-flow forecast (and by currency),
spend under management (with PO) vs. total spend, payment terms held
vs. actual, and the DPO trend it feeds. The latter two, and payment
history itself, need payment-execution data — when an invoice was
actually paid, and on what terms — that this codebase does not
capture anywhere; spend-under-management needs a look at how PO
matching's own fields identify a matched invoice before it gets a
route, the same "do not assume it is as simple as a direct column
read" caution decision 0416 already gave `po.variance_pct`.

**Executive IQ and Fraud Prevention still have no route or real
screen.** Unchanged since decision 0417 — Executive IQ needs the real
multi-org scoping concept this codebase does not have; Fraud
Prevention needs its own first look at what "fraud/risk data" means in
this schema.

**No drill-through**, the same gap Workload and Supplier Performance
each left open for the same reason — a specific filter combination
("this stage's own accruals, in this currency, as a list of
invoices") the existing screens do not obviously support today.
