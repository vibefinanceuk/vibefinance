# 0416 — Spend by supplier, never summed across currencies

**Status: built, committed locally — not yet pushed or deployed.**
This session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415, 0562 and 0566 already
used.

---

## What was asked

With decision 0415's Workload screen shipped and confirmed live, asked
directly which of the Management Dashboard's four remaining screens to
build next: **Supplier Performance**, over Liabilities & Accruals,
Fraud & Risk Detection, and the Multi-Enterprise CFO View (the hardest
of the four — it needs a real multi-org scoping concept that does not
exist yet, best left for last).

The design document lists seven key metrics for Supplier Performance.
Rather than build all seven, the same "one real vertical slice"
discipline decision 0415 established: **"Spend by supplier, with a
top-N ranking"** — the design's own second bullet — because it needed
no new permission (`AP.Supplier`, already gating the Suppliers screen)
and no new scoping concept (the design's own words: scoped exactly the
way that screen already is, `unitsWherePermitted` intersected on
decision 0358's own terms).

**A real conflict surfaced along the way, not decided silently.** The
design's own metric is one number per supplier — a plain top-N
ranking. But this codebase's real invoices are genuinely multi-currency
(GBP, EUR and USD all appear in its own test fixtures) and nothing
here converts between currencies — no base-currency concept, no FX
rate anywhere in the schema. Every existing screen that shows a
monetary figure pairs it with its own currency and never adds two
together (`dashboard-route.ts`'s `onMyClock`, among others). Summing a
supplier's invoices blindly would silently produce a number with no
honest meaning the moment that supplier is billed in more than one
currency — asked directly rather than picked unilaterally, the
operator chose: **group spend by `(supplier, currency)` and rank each
currency separately**, rather than either switching the headline
metric to a currency-safe proxy (invoice count) or shipping the
blended sum with the gap merely noted.

---

## What was built

**`workers/vf-app/src/supplier-performance-route.ts`, new.**
`handleSupplierSpend(db, currentOrg?, userId?, limit = 10)` — one
query grouping `invoice_headers` by `(supplier_id, currency)`, scoped
via `unitClause` against the **supplier's own** org unit
(`s.org_unit_id`), not the invoice's — the design's own instruction to
scope this exactly the way the Suppliers list already does, so a
manager who cannot see a supplier there cannot see what was spent with
them here either.

**Currencies, not suppliers, are the outer grouping of the response.**
Grouping and ranking both happen in application code after one flat
SQL query — the same shape `workload-route.ts`'s own `bucketOf()`
established: one query, then `Map`-based shaping in JS, rather than a
window function this codebase has never used. Each currency present in
the scoped data gets its own top-`limit` list, ordered by spend within
that currency; currencies themselves are ordered by their own total
spend, most significant first — the same "biggest thing first"
ordering `workload-route.ts`'s own buckets already use. For the
ordinary case — a customer whose suppliers all invoice in one currency
— this degrades to exactly the single simple list the design asked
for; nothing more complex renders unless the data genuinely has more
than one currency in it.

**Invoices missing a total or a currency are excluded, not counted as
zero.** An invoice this system cannot price cannot be ranked by price;
folding it in as 0 would understate a supplier's real spend rather
than honestly omitting the figure.

**The real UI.** `workers/vf-ui/public/supplier-performance.js`, new
— one card, fetched from `/api/suppliers/spend`, rendered with
`charts.js`'s existing `barList` (decision 0245's own ranked-rows
primitive, already used by the Dashboard's exceptions-by-supplier
card and already documented as built with supplier names in mind).
One currency's own list gets no wrapper or label at all; more than one
gets each wrapped in a small labelled block (`.spendcurrency`), so the
common single-currency case stays visually identical to a plain
ranked list.

**`barList` gains an optional `display` field, additive.** Rows sort
and size their bars by a plain number (`row.value`), but spend should
read as money (`"GBP 12,400.00"`), which `String(row.value)` alone can
never produce. `display`, when given, replaces that text; it still
joins with the existing `note` field exactly as before
(`"GBP 12,400.00 · 8 invoices"`). No existing caller passes `display`,
so every row `barList` already drew — the Dashboard's own
exceptions-by-supplier card among them — is unchanged.

**Nav, icon, strings.** `tasks.js` gains `NAV_PERMISSIONS.supplierperformance
= "AP.Supplier"` and a `["supplierperformance", "supplierperformance"]`
entry in the "Supplier management" nav group, beside "Suppliers."
`icons.js` gains a `supplierperformance` icon — three ascending bars
and a baseline, a ranking rather than a total, distinct from
`suppliers`' own building and `dashboard`'s own uneven tiles.
`workers/vf-licence/migrations/0128_supplier_performance_strings.sql`
adds `nav.supplierperformance`, `supplierperformance.heading`,
`supplierperformance.sub`, `supplierperformance.spend`,
`supplierperformance.spendsub`, `supplierperformance.nospend`, and
`supplierperformance.invoicecount`, in English and German.

---

## Learning from decision 0415's own mistake, this time confirmed rather than assumed

Decision 0415 shipped a route and a screen without adding the new path
to `vf-ui`'s own `/api/*` allow-list (`PROXIED_TO_INSTANCE`), and the
Workload screen did nothing when clicked as a result — the eighth
instance of a gap that file's own comments already documented seven
times over. Before shipping this decision, the same question was
asked of `/suppliers/spend`: does it need a new entry?

**No — confirmed, not assumed.** `/suppliers/spend` already matches
the existing wildcard `/^\/suppliers\/[^/]+$/` (originally written for
editing a supplier by id, decision 0230), which the `/suppliers/status-counts`
route already relies on the same way, silently, with no explicit test
of its own. Rather than trust that a pattern intended for one purpose
happens to also cover this one, a regression test was added to
`test/index.test.ts`'s own decision-0131 block — *"the proxy carries
every path a screen calls"* — the exact block that exists to catch
this failure mode. `GET /api/suppliers/spend` is now on that list,
proven reachable by a real fetch rather than inferred from which
pattern happens to match it.

---

## Tests

**`workers/vf-app/test/supplier-spend.test.ts`, new — 14 tests.**

- The route's own permission gate: 200 with `AP.Supplier`, 401 with no
  credentials, 403 with the wrong permission (`AP.Review`) — through a
  real `SELF.fetch`.
- **Never summed across currencies**: a single-currency supplier
  produces one figure equal to a plain sum; a supplier billed in GBP
  and EUR produces two separate figures and the combined sum
  (£15,600-equivalent) never appears anywhere in the response;
  currencies are ordered by their own total spend, most significant
  first; an invoice missing a total or a currency is excluded rather
  than counted as zero; empty is `{ currencies: [] }`, not an error.
- Scoping: counts only suppliers within the units `AP.Supplier` is
  held in, counts every supplier when unrestricted, narrows to a
  chosen org, counts nothing when the permission is not held in the
  chosen org at all — the same shape `load-suppliers.test.ts`'s own
  `handleGetSupplierStatusCounts` tests already take.
- Ranking and `limit`: most spend first within a currency; each
  currency's own list capped at the given limit independently.

**`workers/vf-ui/test-browser/supplier-performance.test.ts`, new — 8
tests**, following `workload.test.ts`'s own stub-`fetch`-and-render
pattern: the heading and card title read from the route's own
strings; the empty state says so rather than drawing an empty list;
the chosen org is threaded through to the fetch; a single currency
draws a plain list with no currency wrapper, shows a formatted money
figure and invoice count rather than the raw number, and sizes bars by
spend; more than one currency draws each in its own labelled group, in
the order the route returned them, and never shows one blended figure
for a supplier billed in more than one currency.

**Two pre-existing nav-enumeration tests updated, not just re-passed.**
`test-browser/tasks.test.ts` and `test-browser/rules.test.ts` each
hard-code the full nav item list to catch a screen appearing or
disappearing (their own stated purpose — decision 0213's own comment:
*"this test exists to notice a screen appearing or disappearing, and
it did"*). Both needed `"Performance"` added after `"Suppliers"`, and
`tasks.test.ts`'s own "one permission unlocks one label" loop needed
`AP.Supplier` pulled out into its own two-item assertion — the same
treatment that file already gives `Admin.Configure`, since `AP.Supplier`
now unlocks two nav items together the same way. **Both files' own
`STRINGS` fixtures were already stale for decision 0415** — neither
had ever gained `nav.workload`, so Workload's own absence from these
same enumerations was a pre-existing gap this decision did not
introduce and did not fix, being out of this decision's own scope;
only `nav.supplierperformance` was added, to keep this diff to what
0416 actually changed.

**Suite state, full runs:**

| Package | Before | After |
|---|---|---|
| `vf-app` | 1984 | **1998** (1984 + 14 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite and a `--replay-only` of the whole 128-migration chain both re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged — the new route needed no allow-list change, only a regression-test entry) |
| `vf-ui` browser | 739 | **747** (739 + 8 new) |

The known, pre-existing `vf-ui` browser unhandled-rejection count
(160, unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app` and `vf-ui`, every changed and new
file included.

---

## What is not built

**Supplier Performance's own other six metrics.** Active supplier
count by status, average cycle time (receipt → payment-eligible),
exception rate and exception-type mix, invoice-variance-to-PO ranking,
payment terms held vs. negotiated with on-time-payment rate, and
early-payment/discount capture rate. `po.variance_pct` in particular
is not a stored column — it is computed at match time and written
into the same opaque per-invoice fields table `key-fields-route.ts`
already reads, so ranking suppliers by it will need its own look at
that shape before it gets a route, not an assumption that it is as
simple as `spend`'s own direct column read.

**The other two Management Dashboard screens** (Fraud & Risk
Detection, Liabilities & Accruals) stay exactly what they were: a
Claude Docs design document and Design-canvas mock-ups. The
Multi-Enterprise CFO View still needs a real multi-org scoping concept
this codebase does not have.

**No drill-through**, the same gap Workload left open for the same
reason — not asked for, and a specific filter combination ("this
supplier's own invoices, in this currency") the existing screens do
not obviously support today.

**No FX conversion, anywhere.** This decision worked around that gap
rather than closing it — a genuinely useful "total spend across all
currencies, converted" view would need a real rate source and a real
point-in-time-or-current choice, neither of which exists, and neither
of which this vertical slice invented just to answer one chart's own
question.
