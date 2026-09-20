# 0420 — Potential duplicate invoices, Fraud Prevention's first real metric

**Status: built, committed locally — not yet pushed or deployed.**
This session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0419, 0562 and 0566
already used.

---

## What was asked

With decision 0419 confirmed live ("pushed and deployed"), asked
directly which vertical slice to tackle next — another Liabilities &
Accruals metric, Fraud Prevention, Executive IQ, or Supplier
Performance's own other six metrics. **Early-payment / discount
eligibility** was recommended first, on the assumption that it needed
only a look at payment terms — but investigated before being built,
and found genuinely blocked: nothing in this codebase captures a
discount rate or discount window in structured form anywhere, on
either the invoice (`BT-20`, free text, not even extracted from
photographed invoices) or the supplier record
(`suppliers.payment_terms`, also free text). Reported directly rather
than built around. The operator's own instinct — that payment terms
are typically negotiated with a supplier in advance and held on the
supplier record, not read per-invoice — is right in structure (this
codebase already agrees: `supplier.paymentTerms` exists and is
explicitly "what was agreed," distinct from `BT-9`, "what the supplier
claims") but does not by itself unblock the metric, since that field
is still free text. **Parked at the operator's own direction** — "it
needs more thought" — recorded in `docs/PROGRESS.md`'s own "Not
built" section rather than silently dropped.

**Fraud Prevention was chosen next.** Investigated directly: the
design's own first bullet under Screen 3 — Fraud & Risk Detection's
key metrics is explicit that this is not new work — *"Potential
duplicate invoices — same supplier, same amount, same/near invoice
date. VibeFinance already computes this: the Dashboard's
possible_duplicates card reads a real duplicate_confidence column
today: this screen is a fuller, filterable view of data already
captured, not a new detection system."* The same "one real vertical
slice, least new machinery" discipline every prior decision in this
arc has followed.

---

## What was built

**`workers/vf-app/src/fraud-duplicates-route.ts`, new.**
`handlePossibleDuplicates(db, currentOrg?, userId?)` — reads
`invoice_headers.duplicate_confidence` (decision 0028), the same
column and the same `>= 0.5` threshold the Dashboard's own
`possible_duplicates` card already uses (`dashboard-route.ts`) — not a
new or different bar, so the two screens never disagree about "how
many duplicates." Gated on `AP.FraudReview`, scoped via `unitClause`
against the invoice's own org unit, the same shape every other
analysis route in this tab already takes.

**A table, honestly, not a pair.** `duplicate_confidence` is a scalar
stored on the invoice that was scored, computed once at submission
time by weighing invoice number, total, and issue date against every
other invoice on file from the same supplier
(`computeDuplicateConfidence`, `invoice-facts-route.ts`) — the
specific invoice(s) it was scored against are never themselves
persisted (`findSimilarInvoices()` returns candidates for scoring,
not a stored match). So this route answers "which invoices look like
duplicates, and how confident was that scoring" — the design's own
suggested visualization, "Table, sorted by confidence" — not "invoice
A is a duplicate of invoice B," which nothing in this schema can
answer today. Rows are ordered by confidence descending, issue date
as a tiebreaker for determinism.

**Supplier name falls back the same way the rest of this codebase
already does.** `COALESCE(sup.name, BT-27)` — the exact pattern
`dashboard-route.ts`'s own "On my clock" card and `documents-route.ts`
already use — since an invoice flagged as a possible duplicate has not
necessarily matched a known supplier record. The raw
`supplier_vat_id`, as captured, is returned alongside for the case
where even that fallback is absent.

**`AP.FraudReview`'s first real consumer.** Reserved since decision
0417 ("added now, ahead of the screen itself... nobody is granted this
by any migration"), the same "described as unused" precedent
`AP.Analysis` itself set before decision 0415 gave it something real
to gate. `permissions.ts`'s own description string updated from
"reserved, no screen shows it yet" to match.

**The real UI.** `workers/vf-ui/public/fraud-duplicates.js`, new —
built straight as `load()`/`renderCard()`, the same shape every prior
Financial Performance card was built with. **A plain data table**,
reusing `.tablewrap`/`table`, the same shape `purchase-orders.js`,
`documents.js`, and `suppliers.js` each already build — not `barList`
or a chart, since the design's own suggested visualization here is
literally a sorted table, not a proportion or a trend.
`duplicate_confidence` (a 0–1 score) is rendered as a rounded
percentage.

**Wired into the Fraud Prevention tab, replacing its placeholder.**
`ap-analytics.js`'s `tabContent()` gains a `fraud` branch calling this
module's own `load()`/`renderCard()`, the same shape every other real
tab already uses. Fraud Prevention is now the fourth of AP Analytics'
five tabs to be real; only Executive IQ remains a permission-gated
placeholder.

**The proxy allow-list — checked directly again, immediately.**
`/fraud/duplicates` matches no existing wildcard on `vf-ui`'s
`PROXIED_TO_INSTANCE`, so it needed — and got — a real new entry,
added in the same change as the route itself, the same discipline
decisions 0418 and 0419 already established. A regression test
(`["GET", "/api/fraud/duplicates"]` in `test/index.test.ts`'s own
`CALLED_BY_A_SCREEN` list) proves it reachable by a real fetch.

**Strings.**
`workers/vf-licence/migrations/0132_fraud_prevention_duplicates_strings.sql`
adds `fraudprevention.duplicates`, `.duplicatessub`, `.noduplicates`,
`.invoicenumber`, `.supplier`, `.amount`, `.issuedate`, and
`.confidence`, in English and German.

---

## Tests

**`workers/vf-app/test/fraud-duplicates.test.ts`, new — 16 tests.**

- The route's own permission gate: 200 with `AP.FraudReview`, 401 with
  no credentials, 403 with the wrong permission (`AP.Review`), and
  403 with `AP.Analysis` alone — proving this rides on its own gate,
  not `AP.Analysis` — through a real `SELF.fetch`.
- **Reads the stored score, not a new detection system**: an invoice
  at or above the same 0.5 threshold the Dashboard already uses is
  included; one below is excluded; empty is `{ invoices: [] }`, not an
  error; sorted by confidence, most confident first; carries the
  invoice's own amount, currency, issue date and confidence through
  unchanged.
- **Supplier name fallback**: shows the matched supplier's own name
  when there is one; falls back to the document's own printed name
  (`BT-27`) when there is no matched supplier; still returns the raw
  supplier VAT id alongside either way.
- Scoping: counts only invoices within the units `AP.FraudReview` is
  held in, counts everywhere for somebody unrestricted, narrows to a
  chosen org, counts nothing when the permission is not held in the
  chosen org at all — the same shape every other analysis route's own
  scoping block already takes.

**`workers/vf-ui/test-browser/fraud-duplicates.test.ts`, new — 6
tests**: the heading reads from the route's own strings; the empty
state says so rather than drawing an empty table; the chosen org is
threaded through to the fetch; rows draw in the order the route
returned them; a row shows the invoice number, supplier, formatted
money, issue date, and confidence as a percentage; the supplier-VAT
fallback renders when there is no supplier name.

**`workers/vf-ui/test-browser/ap-analytics.test.ts`, updated, not
just re-passed.** The test asserting Executive IQ *and* Fraud
Prevention both said "not built yet" no longer holds for the latter —
split into "Executive IQ says not built yet" (still accurate) and a
new "Fraud Prevention renders fraud-duplicates.js's own card" wiring
test. A new test proves Fraud Prevention's own load-failure path
renders the same real error every other real tab already gives. The
"switching tabs" test's own Fraud Prevention assertion updated from
"Not built yet" to the real card heading. `STRINGS` and
`openApAnalytics`'s own default route stubs both gained
`/api/fraud/duplicates` and its strings.

**Suite state, full runs:**

| Package | Before (0419) | After (0420) |
|---|---|---|
| `vf-app` | 2032 | **2048** (2032 + 16 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list entry is proven by a new line inside an existing test, not a new test) |
| `vf-ui` browser | 782 | **790** (782 + 6 new in `fraud-duplicates.test.ts`, + 2 net new in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Five of Fraud & Risk Detection's own six metrics.**
Unapproved-supplier invoices (an invoice referencing a supplier not on
file, or on hold — `supplier.matched` and `suppliers.on_hold` already
exist, a real next slice), statistical outliers (an amount well
outside a supplier's own historical range — needs a real definition of
"well outside" before it gets a route), vendor banking-detail-change
alerts (the design's own words: "not currently captured by
VibeFinance... noted as a real gap, not assumed solvable" —
`suppliers` has no field tracking when payment details last changed),
exceptions by type/user/supplier trended, and segregation-of-duties
flags (same person claiming and approving) all stay unbuilt.

**Early-payment / discount eligibility is parked, not ruled out** —
see `docs/PROGRESS.md`'s own "Not built" section for the full
reasoning: nothing in this codebase captures a structured discount
rate or window, on the invoice or the supplier record, and fixing that
is its own decision.

**Executive IQ still has no route or real screen.** Unchanged since
decision 0417 — needs the real multi-org scoping concept this
codebase does not have.

**No drill-through**, the same gap every real tab in this arc has left
open — clicking a row here does not yet open that invoice's own
document.
