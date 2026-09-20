# 0419 — Spend under management (with PO) vs. total spend

**Status: built, committed locally — not yet pushed or deployed.**
This session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415, 0416, 0417, 0418, 0562
and 0566 already used.

---

## What was asked

With decision 0418's accruals report confirmed live ("deployed and
pushed - I see the accruals now"), asked directly which vertical slice
to tackle next — another of Liabilities & Accruals' own remaining
metrics, Fraud Prevention, Executive IQ, or Supplier Performance's own
other six metrics. **Spend under management (with PO) vs. total
spend** was chosen, recommended for the same reason 0415–0418 each
recommended themselves: no new scoping concept, and it needed only a
first look at how PO matching's own fields identify a matched invoice
before it gets a route — the same caution decision 0416 already gave
`po.variance_pct` — rather than the payment-execution data (when an
invoice was actually paid, and on what terms) that three of the
remaining metrics need and this codebase does not capture anywhere.

**Its own listed primary screen is not this one, and that is
addressed directly rather than glossed over.** The design's own
consolidated catalog lists this report's primary screen as Screen 5,
the Multi-Enterprise CFO View ("Stat tile, % of total spend") — but it
is also the design's own fifth bullet under Screen 4's ("Liabilities &
Accruals") key metrics, and the design is explicit that such
cross-references are deliberate: several reports "legitimately belong
on more than one screen... each is listed once here, on the screen
where it is the primary view, but the design assumes cross-linking."
Screen 5 does not exist yet — it needs a real multi-org scoping
concept this codebase does not have, unchanged since decision 0417's
own "What is not built" — so this is built on Screen 4's own listing
instead, the same "one real vertical slice" discipline every Financial
Performance metric so far has followed. When Executive IQ is
eventually built, the design's own cross-linking assumption would put
this metric there too.

---

## What was built

**`workers/vf-app/src/spend-under-management-route.ts`, new.**
`handleSpendUnderManagement(db, currentOrg?, userId?)` — one query
over `invoice_headers`, left-joined to `purchase_orders` on the
invoice's own BT-13 (purchase order reference, read from `facts_json`
via `json_extract` — never a new column, the same pattern
`purchase-order-route.ts`'s own `INVOICED_AMOUNTS_JOIN` already
established for this exact field), scoped via `unitClause` against the
invoice's own org unit and `AP.Analysis` — the same permission the
rest of this tab already checks.

**What "with PO" means, decided directly rather than assumed.** Not
`po.matched` (`po-matching.ts`) — that is a price/quantity-tolerance
verdict, recomputed fresh at rule evaluation, answering "does this
invoice's amount agree with its order." "Spend under management" is a
procurement-governance question instead: was this invoice backed by a
real purchase order at all — did it go through the controlled PO
process — regardless of whether the amounts later agree within
tolerance. So "with PO" here means the invoice's own BT-13 resolves to
a real row in `purchase_orders`. **An order named but never stored
here does not count** — the same "nothing to check this invoice
against yet" reasoning `po-matching.ts`'s own header-level match
already gives for a different question, applied by analogy: an order
can land after the invoice that references it (decision 0081), so an
invoice naming an order this system has not yet stored is, as far as
this report is concerned, not yet under management — the same way it
is not yet matched. Proven directly: a test names an order that never
arrives and confirms it is not counted.

**Scoped by the invoice's own org unit**, the same choice
`accruals-route.ts` already made for this tab — this is a report about
invoiced spend, not about orders, so the purchase order's own org
(always set, decision 0374) does not gate visibility here.

**Never summed across currencies**, the same discipline every
Financial Performance metric so far has followed: total spend, with-PO
spend, and the percentage between them are each computed per currency,
never blended. **Invoices missing a total or a currency are
excluded**, not counted as zero, for the same reason 0416's own route
already gives.

**The real UI.** `workers/vf-ui/public/spend-under-management.js`,
new — built straight as `load()`/`renderCard()`, no `open()` of its
own, the same shape `accruals.js` was already built with. **Reuses
`charts.js`'s own `donut()`** — the single-proportion ring ("one
proportion, not a pie," that function's own comment) — rather than
`barList` or the multi-segment `donutChart()`, because the design's
own suggested visualization for this metric is specifically "Stat
tile, % of total spend," a genuinely different shape from Accruals'
own "stat tile + table broken out by stage." One ring per currency,
each with its own total spend, spend-with-a-PO, and invoice-count
detail lines beside it. **A new class, `.spendundermanagementtile`,
not a bare `.donutwrap`** — `.dashflow > .panel > .donutwrap` (decision
0261) pins a *single* chart to the bottom of its card, a rule written
for `donutChart()`'s own one-ring-per-card shape; this card can show
several rings, one per currency, so each is nested one level deeper to
opt out of that rule rather than fight it per currency.

**Wired into the Financial Performance tab, as its second real card.**
`ap-analytics.js`'s `tabContent()`'s own `financial` branch now loads
both `accruals.js` and this module and returns an array of cards
rather than a single element; `renderActive()` spreads whichever shape
it gets, so every other single-card tab is unaffected. **The two cards
fail independently** — one's own fetch failing renders that one card's
own error state without hiding the other's real content, proven
directly with a test that fails only the accruals fetch and confirms
the spend-under-management card still renders in full.

**The proxy allow-list — checked directly again, immediately.**
`/spend/under-management` matches no existing wildcard on `vf-ui`'s
`PROXIED_TO_INSTANCE`, so it needed — and got — a real new entry,
added in the same change as the route itself, the same discipline
decision 0418 already established for this exact recurring gap. A
regression test (`["GET", "/api/spend/under-management"]` in
`test/index.test.ts`'s own `CALLED_BY_A_SCREEN` list) proves it
reachable by a real fetch.

**Strings.**
`workers/vf-licence/migrations/0131_financial_performance_spend_under_management_strings.sql`
adds `financialperformance.spendundermanagement`,
`.spendundermanagementsub`, `.nospend`, `.totalspend`, `.withpospend`,
and `.invoiceswithpo`, in English and German.

---

## Tests

**`workers/vf-app/test/spend-under-management.test.ts`, new — 16
tests.**

- The route's own permission gate: 200 with `AP.Analysis`, 401 with no
  credentials, 403 with the wrong permission (`AP.Review`), through a
  real `SELF.fetch`.
- **What counts as "with PO"**: an invoice whose BT-13 resolves to a
  real purchase order counts; one with no BT-13 at all does not; one
  naming an order this system has never stored does not either,
  proven directly rather than assumed; empty is `{ currencies: [] }`,
  not an error; `totalCount`/`withPoCount` are proven to be invoice
  counts, not amounts.
- **Never summed across currencies**: a single currency gets its own
  total, with-PO figure, and percentage; a multi-currency report
  splits into one figure per currency each, with the combined total
  asserted absent from the response anywhere; currencies ordered by
  their own total spend, most significant first; an invoice missing a
  total or a currency is excluded rather than counted as zero.
- Scoping: counts only invoices within the units `AP.Analysis` is held
  in, counts everywhere for somebody unrestricted, narrows to a chosen
  org, counts nothing when the permission is not held in the chosen
  org at all — the same shape every other analysis route's own
  scoping block already takes.

**`workers/vf-ui/test-browser/spend-under-management.test.ts`, new —
8 tests**, following `accruals.test.ts`'s own stub-fetch-and-render
pattern: the heading reads from the route's own strings; the empty
state says so rather than drawing an empty ring; the chosen org is
threaded through to the fetch; a single currency draws one ring
labelled with its own currency and rounded percentage, with its total
spend, with-PO spend, and invoice-count lines beside it; more than one
currency draws its own tile and ring each, never one blended total or
percentage.

**`workers/vf-ui/test-browser/ap-analytics.test.ts`, updated, not
just re-passed.** Two new tests: Financial Performance renders *both*
real cards, not just the accruals one; and the two cards' own load
failures are independent — one failing never hides the other's real
content. The `STRINGS` fixture and `openApAnalytics`'s own default
route stubs both gained `/api/spend/under-management` and its
strings, the same treatment `/api/accruals` already got when decision
0417's own wiring test was written.

**Suite state, full runs:**

| Package | Before (0418) | After (0419) |
|---|---|---|
| `vf-app` | 2016 | **2032** (2016 + 16 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list entry is proven by a new line inside an existing test, not a new test) |
| `vf-ui` browser | 772 | **782** (772 + 8 new in `spend-under-management.test.ts`, + 2 net new in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Four of Liabilities & Accruals' own six metrics.** Early-payment/
dynamic-discount eligibility, cash-flow forecast (and by currency),
payment terms held vs. actual, and the DPO trend it feeds. The latter
two, and payment history itself, need payment-execution data — when an
invoice was actually paid, and on what terms — that this codebase does
not capture anywhere.

**Executive IQ and Fraud Prevention still have no route or real
screen.** Unchanged since decision 0417 — Executive IQ needs the real
multi-org scoping concept this codebase does not have; Fraud
Prevention needs its own first look at what "fraud/risk data" means in
this schema. When Executive IQ is eventually built, the design's own
cross-linking assumption suggests surfacing this same metric there
too — a future decision, not assumed here.

**No drill-through**, the same gap every Financial Performance metric
so far has left open — a specific filter ("this currency's own with-PO
invoices, as a list") the existing screens do not obviously support
today.
