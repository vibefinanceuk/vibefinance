# 0422 — Unapproved-supplier invoices, Fraud Prevention's second real metric

**Status: pushed and deployed, confirmed directly.** `origin/main`
fetched directly reads `30d6e10`, matching this session's own commit
exactly; the operator confirmed with "pushed and deployed." This
session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0421, 0562 and 0566
already used.

---

## What was asked

"Whats next?" — the operator's own open-ended prompt, once decision
0421's own six new Supplier Performance metrics were built, tested,
pushed, deployed, and confirmed directly on the live screen. Offered
four candidates; the operator chose **unapproved-supplier invoices**,
the design's own second bullet under Screen 3 — Fraud & Risk
Detection's key metrics: *"Unapproved-supplier invoices — an invoice
referencing a supplier not on file, or on hold."*

Investigated before building, the same discipline every decision in
this arc has followed.

---

## What was built

### Two risks, one list, never blurred into one flag

`workers/vf-app/src/fraud-unapproved-suppliers-route.ts`, new — `GET
/fraud/unapproved-suppliers`. Returns every invoice that is either
**not on file** or **on hold**, each row carrying its own `reason`
(`"notonfile"` | `"onhold"`) so a reviewer never has to infer which
from which columns happen to be filled in.

**"Not on file" is `invoice_headers.supplier_id IS NULL` — confirmed
reliable by reading the write path directly, not assumed from the
column's name.** `matchSupplier()` (`match-supplier.ts`) is the only
place a supplier is ever named to an invoice, matching on `BT-34` then
`BT-31` against `suppliers WHERE status = 'active'`, and returning one
of three failure reasons when it cannot: `"no_identifier"`,
`"no_match"`, or `"ambiguous_site"`. `source-capture-route.ts` only
writes `supplier_id` when `matchSupplier()` actually returns one
(`UPDATE invoice_headers SET supplier_id = ? WHERE id = ? AND
supplier_id IS NULL`) — so the column stays null on every one of those
three reasons without this route needing to know which. A null column
is a fully sufficient, single proxy for "this invoice names no
supplier we recognise."

**"On hold" is read live from `suppliers.on_hold`, deliberately not
the frozen `supplier.onHold` fact `source-capture-route.ts` writes
once at capture time.** Decision 0231 froze that fact on purpose, for
a specific and different reason: automated rule evaluation, where "an
invoice is assessed against the truth at the moment it arrived." This
route serves a different screen — a reviewer looking at this list
today needs to know whether a supplier is on hold **today**. A hold
placed after an invoice was captured (precisely the case fraud review
exists to catch) would be invisible under the frozen fact; a hold
since lifted would keep flagging an invoice with nothing left to
review. Decision 0421's own hold-history investigation already
established that `on_hold` is current-state-only, with no history
table anywhere in this schema — the live join reads that same current
state honestly, rather than pretending to a history this system
cannot give.

A supplier cannot be both reasons at once — the `LEFT JOIN` only
produces a non-null `sup` row when `supplier_id` matched, so `on_hold`
can only ever be `1` on a matched row. `reason` is derived from that
single column, never stored or tracked twice.

### Gating and scoping — the sibling of decision 0420, not a new rule

**Gated on `AP.FraudReview`, scoped by the invoice's own org unit
(`h.org_unit_id`)** — the identical gate and scoping column
`fraud-duplicates-route.ts` already established for this tab, and the
only one available here: an unmatched invoice has no `supplier_id`, so
Supplier Performance's own supplier-org scoping rule (decision 0416,
`sup.org_unit_id`) cannot cover every row this route returns.

**Supplier name falls back to the document's own printed name**, the
identical `COALESCE(sup.name, BT-27)` pattern `dashboard-route.ts`,
`documents-route.ts`, and `fraud-duplicates-route.ts` already use — an
invoice with no matched supplier has no supplier row to name it from.

### The screen

`workers/vf-ui/public/fraud-unapproved-suppliers.js`, new — a plain
data table, the same `.tablewrap`/`table` shape `fraud-duplicates.js`
already uses, reusing that card's own `fraudprevention.invoicenumber`
/ `.supplier` / `.amount` / `.issuedate` column strings rather than
naming the same columns twice. The new **reason** column is the point
of this card: a plain label ("Not on file" / "On hold"), with the
supplier's own `holdReason` shown beneath it when present — the same
"state has a reason" pattern `suppliers.js` already surfaces for
`on_hold`/`hold_reason`. Styled with the existing `warn`/`muted`
classes `suppliers.js` already uses for the same on-hold distinction,
not a new component.

`workers/vf-ui/public/ap-analytics.js`'s `tabContent()` "fraud" branch
now loads both cards in parallel and returns an array — the same
"each fails independently" shape the `financial` (decision 0419) and
`supplier` (decision 0421) branches already established, extended to
Fraud Prevention. Fraud Prevention now shows two real cards, not one.

**The proxy allow-list — checked directly, not assumed.**
`/fraud/unapproved-suppliers` matched no existing wildcard (it is a
sibling of the literal `/^\/fraud\/duplicates$/` entry, not covered by
any `[^/]+` wildcard) — confirmed with a real fetch in
`test/index.test.ts`'s own `CALLED_BY_A_SCREEN` list, and a new entry
added to `PROXIED_TO_INSTANCE` for it, the same recurring gap
decisions 0418–0420 each found and fixed for their own new paths.

**Strings.**
`workers/vf-licence/migrations/0134_fraud_prevention_unapproved_suppliers_strings.sql`
adds the new card's own strings, English and German, reusing the four
column strings decision 0420's own migration 0132 already defined.

---

## Tests

One new route test file, `test/fraud-unapproved-suppliers.test.ts` (16
tests), mirroring `fraud-duplicates.test.ts`'s own permission-gate /
behaviour / scoping split, plus its own "not on file" and "on hold —
read live" groups. One new browser test file,
`test-browser/fraud-unapproved-suppliers.test.ts` (9 tests).
`test-browser/ap-analytics.test.ts` updated, not just re-passed: the
single-card "Fraud Prevention renders fraud-duplicates.js's own card"
test is replaced by an assertion over both headings in order, and a
new test proves the two cards fail independently, the same shape
Financial Performance's and Supplier Performance's own independence
tests already established (net +1 test in this file).

**Suite state, full runs:**

| Package | Before (0421) | After (0422) |
|---|---|---|
| `vf-app` | 2110 | **2126** (2110 + 16 new tests, exactly) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list path proven by new lines inside an existing test, not a new test) |
| `vf-ui` browser | 818 | **828** (818 + 10 — 9 new in the new file, +1 net new in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Fraud & Risk Detection's own other four metrics stay unbuilt** —
statistical outliers, vendor banking-detail-change alerts (the
design's own words: "not currently captured by VibeFinance... noted
as a real gap, not assumed solvable"), exceptions by type/user/supplier
trended, and segregation-of-duties flags. Unchanged by this decision;
see `docs/PROGRESS.md`'s own "Not built" section for the full list.

**Everything else already listed as not built stays not built** —
Executive IQ, and Liabilities & Accruals' and Supplier Performance's
own remaining metrics are unchanged by this decision.
