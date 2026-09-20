# 0421 — Supplier Performance, the remaining six metrics

**Status: built, committed locally.** Delivered as a git bundle for
the operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0420, 0562 and 0566 already used. This session still has no
push access to `vibefinanceuk/vibefinance`.

---

## What was asked

"Let's build out all of the supplier performance metrics" — the
operator's own instruction, after decision 0420 shipped Fraud
Prevention's first real metric. Investigated before building, the same
discipline every decision in this arc has followed.

**The design document, read fresh, now lists eight key metrics for
Screen 1 — Supplier Performance, not seven.** Decision 0416 recorded
"one metric of seven" when it built spend by supplier; a fresh read of
the same design document for this decision found an eighth bullet —
*"Active supplier count, by status"* — already there. Whether that
bullet was added to the design document after decision 0416 or simply
missed then is not this session's to say; what matters is that this
decision works from the document as it reads today, all eight bullets:

1. Active supplier count, by status
2. Spend by supplier, with a top-N ranking — **built, decision 0416**
3. Average cycle time by supplier (receipt → payment-eligible)
4. Exception rate by supplier, and exception type mix
5. Invoice variance to order value, ranked by supplier
6. Payment terms held vs. negotiated, and on-time-payment rate
7. Early-payment / discount capture rate by supplier — **parked, decision 0420**
8. Hold history — how often and for how long, and why

**Six of eight are now real.** Bullet 1 turned out to already exist
elsewhere in this product (below); bullets 3–6 are new routes and
cards, built this decision; bullet 7 stays parked exactly as decision
0420 left it; bullet 8 is newly found to be blocked, for a different
and permanent reason — see "What is not built."

---

## What was built

### 1. Active supplier count, by status — reused, not rebuilt

`/api/suppliers/status-counts` (decision 0378) already computes this
exactly, gated on `AP.Supplier` — the same permission the rest of this
screen already checks — and already renders as a ring on the
standalone Suppliers screen. `workers/vf-ui/public/supplier-status.js`
is new, but it is a thin `load()`/`renderCard()` wrapper around that
existing route and `charts.js`'s existing `donutChart()`, not a new
backend metric. Deliberately read-only here — no `onSelect`, unlike
the Suppliers screen's own ring, since this tab has no list of its own
to filter and decision 0420 already noted "no drill-through" as a gap
left open across this whole arc.

### 3. Average cycle time by supplier

`workers/vf-app/src/supplier-cycle-time-route.ts`, new —
`GET /suppliers/cycle-time`. "Payment-eligible" is the same final
stage decision 0418 already defined for accruals
(`MAX(process_stages.sequence)` per process); "receipt" is
`process_instances.created_at`; reaching payment-eligible is the
*first* `stage_visits` row at that stage (`MIN`, since decision 0025's
own revalidation can revisit a stage). Only invoices whose process
instance has actually reached that stage are counted — the same
"a completed thing has a duration, an in-flight one does not yet"
reasoning accruals already applies in reverse. Days are computed in
SQL with `julianday()`, the same idiom `dashboard-route.ts`'s own
`received()` already uses, rather than parsing two differently
formatted timestamp strings in JavaScript.

### 4. Exception rate by supplier, and exception type mix

`workers/vf-app/src/supplier-exceptions-route.ts`, new —
`GET /suppliers/exceptions`. An exception is
`stage_visits.validation_passed = 0` — decision 0021's own persisted
verdict, the same definition `dashboard-route.ts`'s own
`exceptionsBySupplier` card already uses. The rate's own denominator
is visits where validation actually ran (`validation_passed IS NOT
NULL`), not every visit — a stage with nothing to evaluate is neither
a pass nor a fail, decision 0021's own standing invariant, and
counting it as a pass would understate the real rate. Type mix reads
`validation_failures` (decision 0021's own comma-separated named
checks), split and counted across every exception in a 90-day window
— wider than `exceptionsBySupplier`'s own 30, since that card exists
for *recent* attention and this one characterises a supplier's pattern
over a season.

### 5. Invoice variance to order value, ranked by supplier

`workers/vf-app/src/supplier-po-variance-route.ts`, new —
`GET /suppliers/po-variance`. **Recomputed directly, not read from
`po.variance_pct`.** `po-matching.ts`'s own doc comment is explicit
that those facts are "recomputed at every evaluation, never stored" —
a purchase order can arrive after the invoice referencing it. Decision
0419 already made this same call for "spend under management" rather
than trust `po.matched`; this route follows the identical join
(`invoice_headers` to `purchase_orders` on `json_extract(facts_json,
'$."BT-13"') = order_number`) and the identical formula
`po-matching.ts`'s own `variancePct()` uses. Header-level only — line-
level variance would need every invoice line matched to its own PO
line, a real feature this slice does not need. Only invoices that
actually resolve to a real, stored purchase order are counted.

### 6. Payment terms held vs. negotiated, and on-time-payment rate

`workers/vf-app/src/supplier-payment-terms-route.ts`, new —
`GET /suppliers/payment-terms`. Two honesty calls, both made the same
way decision 0420's own investigation was:

- **Negotiated terms, parsed narrowly.** `suppliers.payment_terms` is
  free text (decision 0420's own finding, still true). This route
  reads the one pattern this project's own supplier data actually uses
  consistently — `"Net <N>"` — and **excludes a supplier entirely**
  when its text does not match, rather than guessing a number. A
  supplier excluded here is one whose negotiated term this system
  cannot honestly compare against anything.
- **"On-time" means reaching payment-eligible on or before the
  invoice's own due date (`BT-9`) — not literal ERP payment
  execution.** VibeFinance is AP automation feeding an ERP (decision
  0231); it has no record of when a payment actually left the bank,
  only of when an invoice became ready to pay. This reuses decision
  0418's own "payment-eligible = readiness to pay" definition rather
  than claiming knowledge this system does not have. Only invoices
  that have actually reached payment-eligible count toward the rate —
  one still in flight is not yet late or on time, merely not there.

"Held" terms are the invoice's own due date minus its own issue date
(`BT-9` − `BT-2`), averaged per supplier, set against the negotiated
number above.

### The screen, assembled

`workers/vf-ui/public/ap-analytics.js`'s `tabContent()` "supplier"
branch now loads all six cards in parallel and returns an array — the
same "each fails independently" shape the `financial` branch already
established at two cards (decision 0419), extended to six. Every new
route is gated on `AP.Supplier` and scoped via `unitClause` against
the **supplier's** own org unit (`sup.org_unit_id`), the identical
scoping rule decision 0416 established for the whole screen — one rule
for six metrics, not six different ones.

**The proxy allow-list — checked directly, the discipline every prior
decision has kept.** All four new paths (`/suppliers/cycle-time`,
`/suppliers/exceptions`, `/suppliers/po-variance`,
`/suppliers/payment-terms`) already match `vf-ui`'s existing
`/^\/suppliers\/[^/]+$/` wildcard — confirmed with a real fetch in
`test/index.test.ts`'s own `CALLED_BY_A_SCREEN` list, not assumed from
the pattern.

**Strings.**
`workers/vf-licence/migrations/0133_supplier_performance_remaining_metrics_strings.sql`
adds the four new cards' own strings, English and German. Active
supplier status reuses `suppliers.*` strings already in place
(migration 0088); spend by supplier already had its own.

---

## Tests

Four new route test files, mirroring every prior decision's own
permission-gate / behaviour / scoping split:
`supplier-cycle-time.test.ts` (14 tests), `supplier-exceptions.test.ts`
(17), `supplier-po-variance.test.ts` (14), `supplier-payment-terms.test.ts`
(17) — 62 new `vf-app` tests in total. Five new browser test files —
`supplier-status.test.ts` (4), `supplier-cycle-time.test.ts` (5),
`supplier-exceptions.test.ts` (7), `supplier-po-variance.test.ts` (5),
`supplier-payment-terms.test.ts` (6) — 27 new `vf-ui` browser tests,
plus `ap-analytics.test.ts` updated (not just re-passed): the old
single-card "Supplier Performance renders supplier-performance.js's
own card" test is replaced by an assertion over all six headings in
order, and a new test proves the six cards fail independently, the
same shape Financial Performance's own two-card independence test
(decision 0419) already established.

**Suite state, full runs:**

| Package | Before (0420) | After (0421) |
|---|---|---|
| `vf-app` | 2048 | **2110** (2048 + 62 new tests, exactly) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — four new allow-list paths proven by new lines inside an existing test, not new tests) |
| `vf-ui` browser | 790 | **818** (790 + 28 — 27 new tests, +1 net new in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Early-payment / discount capture rate — still parked, unchanged
from decision 0420.** See `docs/PROGRESS.md`'s own "Not built" section
for the full reasoning: nothing in this codebase captures a structured
discount rate or window, on the invoice or the supplier record.

**Hold history — newly found blocked, for a different and permanent
reason.** The design's own bullet asks *"how often and for how long a
supplier has been placed on hold, and why"* — a history of *changes*
over time. `suppliers.on_hold` and `suppliers.hold_reason` (migration
0049) are **current state only**: a plain `UPDATE` overwrites them
(`load-suppliers.ts`'s own PATCH path), and nothing in this codebase —
checked directly, no `audit_log`, `supplier_history`, `hold_history` or
`status_history` table exists anywhere — records when a hold started,
when it ended, or what it replaced. This is not the same shape of gap
as early-payment/discount (a per-invoice or per-supplier field that
could in principle be parsed or added): it needs a genuinely new
capability, an audit trail on supplier field changes, which does not
exist for any field on this record, not only `on_hold`. Recorded here
as its own gap rather than folded into the early-payment paragraph,
since the fix is a different shape of work — a history table and
something that writes to it on every change, not a parsing or
schema-field decision.

**Everything else already listed as not built stays not built** —
Executive IQ, the rest of Fraud & Risk Detection, and Liabilities &
Accruals' own remaining metrics are unchanged by this decision.
