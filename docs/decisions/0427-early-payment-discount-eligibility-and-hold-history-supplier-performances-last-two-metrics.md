# 0427 — Early-payment discount eligibility and hold history, Supplier Performance's last two metrics

**Status: committed, awaiting the operator's own push/deploy
confirmation.** This session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0426 already used.

---

## What was asked

"Lets finish off Supplier Performance" — the operator's own explicit
instruction, once decision 0426 corrected `docs/PROGRESS.md`'s own
undercount of the design. Supplier Performance was, at that point, the
screen closest to full parity with its own design list: decision 0421
had built six of its own eight key metrics, leaving two — both
genuinely parked, for two different reasons (see `docs/PROGRESS.md`'s
own "Not built" section, now updated) — not merely deferred.

Both were investigated directly, the same discipline this whole arc
has followed, before anything was built:

- **Early-payment/discount capture rate.** Decision 0419's own record
  had already found this blocked: the design's own metric needs to
  know whether an invoice carries a real discount offer, and nothing
  in this codebase captured that in structured form anywhere — free
  text only, on both `BT-20` (per-invoice) and `suppliers.payment_terms`
  (per-supplier).
- **Hold history.** `suppliers.on_hold` and `suppliers.hold_reason`
  are current state only; nothing in this codebase recorded when a
  hold started, ended, or what it replaced.

Investigating further, before building anything, surfaced three real
design decisions, each put to the operator directly rather than
assumed:

1. **How should discount terms be captured?** Offered structured
   supplier fields (recommended — add `discount_pct`/`discount_days`
   to `suppliers`, CSV-loadable like `payment_terms` already is) against
   parsing a discount schedule out of existing free text. The operator
   chose **structured supplier fields**.
2. **How should hold history be captured, given `on_hold` changes via
   both the hold/release route and CSV reloads?** Investigating the
   real write paths into `suppliers` first (see below) surfaced two
   real options: a hold-specific history table (recommended, narrower)
   or a general field-change audit trail covering every write path and
   every editable/settable field (broader). The operator chose the
   **general field-change audit trail** — explicitly the broader,
   non-recommended option.
3. **With only structured discount fields, and no payment-execution
   data anywhere in this codebase, how should the discount metric be
   scoped?** Building the structured fields did not, on its own, reach
   "capture rate" — that needs to know whether a discount was actually
   *taken*, which nothing here records. Surfaced directly once found,
   mid-build: build the literal (but overclaiming) capture rate,
   or an honestly narrower eligibility metric. The operator chose
   **eligibility, not capture rate** (recommended).

---

## What was built

### The real write paths into `suppliers`, investigated before designing the audit trail

Three separate routes write to `suppliers`, confirmed by reading each
directly rather than assumed:

- **CSV mirror-load** (`load-suppliers.ts`'s `handleLoadSuppliers`) —
  "replace rather than merge" (decision 0208's own choice). A supplier
  omitted from a header the second load doesn't include has that field
  cleared, and **a reload can silently flip `on_hold`** if the CSV's
  own `Hold` column disagrees with today's state — a fact a
  hold-specific mechanism watching only the hold/release route would
  have missed entirely.
- **The hand-edit route** (`handleUpdateSupplier`) — string fields
  only (`erp_identifier`, `name`, `vat_id`, `electronic_address`,
  `email`, `phone`, `address_line`, `city`, `postal_code`, `country`,
  `payment_terms`).
- **The hold/release route** (`handleSetSupplierState`, decision
  0230's own "four acts, one route" — hold, release, activate,
  deactivate).

All three now call `diffSupplierFields()`/`recordSupplierFieldChanges()`,
new in `workers/vf-app/src/supplier-audit.ts`. `AUDITED_FIELDS` names
23 fields across all three paths (not only `on_hold`/`hold_reason` —
the general mechanism the operator chose covers every editable/
settable field on the record); `diffSupplierFields(before, after)`
compares only fields present in `after` (a write path that never
touches a field never manufactures a change for it), treats
`null`/`undefined`/`''` as the same absent value, normalizes booleans
to `'1'`/`'0'` matching how D1 reads a boolean column back, and does
not treat a real zero as absent (`discount_pct: 0` is a fact, not a
gap). `recordSupplierFieldChanges()` writes one row per real change,
insert-only, via `db.batch()` — the same idiom `activate-route.ts`,
`compile-route.ts` and `field-visibility-route.ts` already use.

**Deliberately separate from decision 0350's own pre-existing
`detectSupplierChanges`/`spawnSupplierMaintenanceInstance`
mechanism**, left completely untouched. That mechanism watches a
narrower `WATCHED_FIELDS` set (`name`, `vat_id`, `electronic_address`,
`payment_terms` — deliberately not `on_hold`) to spawn a Supplier
Maintenance workflow review task, a different purpose from a general
history. Repurposing or extending it would have risked its own tested,
narrow-purpose behavior for a job it was never designed to do; building
a second, parallel mechanism keeps both honest about what they're for.

### Migration 0072 — structured discount fields and the general audit table

`migrations/0072_supplier_discount_terms_and_field_change_history.sql`
— two new nullable columns on `suppliers` (`discount_pct`, checked
0–100; `discount_days`, checked non-negative), and a new
`supplier_field_changes` table (`supplier_id`, `field`, `old_value`,
`new_value`, `changed_by`, `changed_at`), indexed on `(supplier_id,
field, changed_at)`.

### `GET /suppliers/discount-eligibility`

`supplier-discount-eligibility-route.ts` — open invoices whose
supplier carries discount terms (`discount_pct`/`discount_days` both
set) and whose invoice date is still inside that supplier's own
discount window, grouped by currency (never summed across them — the
same discipline every monetary route on this screen already follows),
then ranked by supplier within each currency. A supplier with no
discount terms is excluded from this report entirely, not guessed at
0%. Scoped with `unitClause`/`unitsWherePermitted` on
`sup.org_unit_id`, matching `supplier-payment-terms-route.ts`'s own
established pattern for this screen — a deliberate contrast with
Executive IQ's own enterprise-wide, unscoped design (decision 0425).

Rendered by `supplier-discount-eligibility.js`, reusing `charts.js`'s
own `barList()`, first built for and proven by decision 0416's "Spend
by supplier" card — a ranked-list shape, one currency group per
currency actually present, or none at all when nothing is currently
eligible.

**This is eligibility, not the design's own literal "capture rate."**
The design's own metric asks what share of available discounts a
supplier actually captures — this route answers what's available
right now. Reporting "capture" honestly needs payment-execution data
(when and on what terms an invoice was actually paid), which this
codebase has never captured anywhere — the same gap that blocks
Liabilities & Accruals' own "payment history." Building capture rate
around that gap would have meant silently guessing or omitting the
"actually paid" half of the metric; the operator chose the honestly
narrower framing instead.

### `GET /suppliers/hold-history`

`supplier-hold-history-route.ts` — reads every `on_hold` transition
recorded in `supplier_field_changes` for suppliers in scope, and pairs
each 0→1 with its next 1→0 into one discrete period, carrying whatever
`hold_reason` change was recorded closest to that period's own start.
An unresolved hold (no closing transition yet) is reported as ongoing
(`endedAt: null`, duration measured through now), not dropped. **A
supplier held since its very first-ever load has no recorded period at
all** — forward-looking only, honestly, since there is no prior row to
diff against and no way to know when that hold actually began. Same
org-unit scoping as the eligibility route above.

Rendered by `supplier-hold-history.js` as a plain table (matching
`fraud-duplicates.js`/`supplier-payment-terms.js`'s own precedent),
since the design's own Report Catalog table gives no visualization
suggestion for this metric at all, and it carries more than one fact
per row (dates, duration, reason) that a bar list can't show cleanly.

### Wiring

`workers/vf-app/src/index.ts` — two new routes, both gated
`AP.Supplier`, matching every other route on this screen.
`ap-analytics.js`'s `tabContent()` now loads all eight of this
screen's own cards in one `Promise.all` (`statusOk, spendOk, cycleOk,
exceptionsOk, varianceOk, termsOk, discountOk, holdOk`), each card
failing independently — the same discipline `financial` and `supplier`
already established, extended from six cards to eight.
`test/index.test.ts`'s own `CALLED_BY_A_SCREEN` — both new paths match
the pre-existing `/^\/suppliers\/[^/]+$/` proxy wildcard, no new
`PROXIED_TO_INSTANCE` entry needed.

**Strings.** `workers/vf-licence/migrations/0138_supplier_performance_
discount_eligibility_and_hold_history_strings.sql` — 12 keys, English
and German (24 rows): both cards' titles, subtitles, empty states, and
the hold-history table's own column headers.

---

## Tests

Three new backend test files: `test/supplier-audit.test.ts` (the pure
diffing and write-helper logic directly — 10 tests),
`test/supplier-hold-history.test.ts` (the route's own permission gate,
pairing transitions into periods, the ongoing case, the no-history-
since-first-load case, more than one period per supplier, and org-unit
scoping — 8 tests), `test/supplier-discount-eligibility.test.ts` (the
route's own eligibility filtering and currency grouping — 9 tests).
`test/load-suppliers.test.ts` extended with a new "the general
field-change history — decision 0427" block covering all three write
paths recording real changes.

Two new browser test files: `test-browser/supplier-hold-history.test.ts`
(7 tests — the card the route returned, one row per period with its
own dates/duration/reason, ongoing holds shown as such rather than a
blank cell, a missing reason shown as an em dash, more than one period
across more than one supplier) and `test-browser/supplier-discount-
eligibility.test.ts` (6 tests — the card the route returned, a single
currency reading as the plain simple list with no currency wrapper,
more than one currency splitting into its own labelled group each) —
13 combined.
`test-browser/ap-analytics.test.ts` updated: the "Supplier Performance
renders all six of its own cards" test extended to eight cards and
renamed; two new default route stubs added to `openApAnalytics()`; the
two new cards' strings added.

**Suite state, full runs:**

| Package | Before (0426) | After (0427) |
|---|---|---|
| `vf-app` | 2196 | **2233** (2196 + 37 new: 10 in `supplier-audit.test.ts`, 8 in `supplier-hold-history.test.ts`, 9 in `supplier-discount-eligibility.test.ts`, 10 in `load-suppliers.test.ts`'s own new block) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged — both new paths match an existing proxy wildcard) |
| `vf-ui` browser | 860 | **873** (860 + 13 new across the two new files) |

The known, pre-existing `vf-ui` browser unhandled-rejection count
(160, unchanged since at least decision 0414 — `document-window.test.ts`/
`documents.test.ts`, an async-cleanup quirk unrelated to any file this
decision touches) is unchanged; confirmed by running those two files
in isolation, outside the full suite, with the same result.

`eslint .` clean across every new and changed file in `vf-app`,
`vf-ui`, and `vf-licence`. `tsc --noEmit` clean on every file this
decision touches (pre-existing, unrelated noise elsewhere in the test
suite — `cloudflare:test` module resolution and test-file type
narrowing — untouched by this decision).

---

## What is not built

**Supplier Performance now has all eight of its own key metrics
built** — the first of the design's six dashboard screens to reach
full parity with its own design list.

**The design's own literal "early-payment/discount capture rate"
remains unbuilt**, for the same structural reason Liabilities &
Accruals' own "payment history" remains unbuilt: no payment-execution
data anywhere in this codebase. Eligibility is a deliberately
different, honestly-labeled metric, not that one finished.

**A note for whoever picks up Liabilities & Accruals next**: its own
"invoices eligible for early payment / dynamic discount, by volume and
by amount" is close kin to what this decision built for Supplier
Performance — the same underlying discount fields and open-invoice
query, aggregated by supplier rather than by volume/amount. Not built
here, and not assumed equivalent without checking, but the data behind
it already exists — unlike the other three of that screen's own
metrics.

**Decision 0350's own Supplier Maintenance change-detection mechanism
stays exactly as it was** — narrower, purpose-built for spawning a
review task, and untouched by this decision's own, separate general
audit trail.
