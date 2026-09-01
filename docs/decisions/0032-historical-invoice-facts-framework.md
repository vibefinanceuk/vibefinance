# 0032 — The historical, queryable invoice-facts framework

Status: settled, 1 September 2026. Decision 0015's own last remaining
original gap — named alongside line-item facts and duplicate
detection back when this whole design conversation started, and the
only one of the three left unbuilt until now. Decision 0015 also
named the exact reason it had to wait: it's coupled to line-item
facts ("matching on 'same line item description' means this framework
cannot be fully built without per-line facts already being
resolved"). Decision 0027 resolved that; this is genuinely the first
moment this gap was buildable at all.

## Carried decision 0015's own design through directly, not re-decided

`invoice_runs` has only ever logged evaluation *outcomes* — never the
actual field values that were evaluated. Decision 0015 already fully
specified the shape this needed: *"one shared query interface, with
multiple purpose-built methods per real consumer — not one generic
query capability every consumer builds on top of directly, and not
separate ad-hoc implementations of 'search past invoices.'"* Two
confirmed consumers beyond duplicate detection were already named: a
future operator UI, and a future analytics/reporting page. This
bundle gives both a real method rather than leaving them theoretical.

## A real, careful refactor of a live, deployed feature

Decision 0028's duplicate-confidence scoring had already built a
real, targeted query against `invoice_headers` — but as a standalone
function, not a method on any shared interface, which is exactly the
"separate ad-hoc implementation" decision 0015 explicitly declined.
`findSimilarInvoices` extracts that lookup into `invoice-history.ts`;
`computeDuplicateConfidence` now calls it rather than running its own
inline query, keeping its own weighted-scoring logic as the caller's
job, not baked into the shared lookup — a general lookup shouldn't
carry one consumer's own comparison logic.

Treated with real care given it touches production: every existing
duplicate-detection test (18 of them, including the weighted
scoring's own critical properties — the supplier gate, max-not-sum,
no-self-match, no-retroactive-rescore) was run and confirmed passing
**unmodified** immediately after the refactor, before anything else
was built on top of it.

## Two new methods, each serving one of decision 0015's own named use cases

- **`getSupplierHistory`** — a supplier's own invoice history,
  ordered by `created_at` (guaranteed, unlike the optional
  `issue_date`) — the operator-UI use case: someone reviewing one
  invoice naturally wants to see what else this supplier has sent.
  Exposed as a real endpoint, `GET /suppliers/:supplierVatId/history`
  — the second `GET` route in this system, and the first genuinely
  read-oriented one rather than an analytics-count summary.
- **`getMonthlyTotals`** — aggregate totals by month, optionally
  filtered to one supplier — the analytics-page use case, "totals by
  month," decision 0015's own example. A genuinely different access
  pattern from the two lookups (broad aggregate vs. narrow, targeted
  lookup), kept as its own method rather than forced through the same
  shape, matching the distinction decision 0015 itself drew. A real,
  honest limitation stated rather than hidden: an invoice with no
  `issue_date` at all is excluded, since there's no month to
  meaningfully group it into.

A real SQL edge case caught and fixed, the same class already found
once in `intake-stats` (decision 0029): `SUM()` over a genuine `NULL`
value (an invoice with a real `issue_date` but no `total_with_vat`)
returns `NULL`, not `0`, without `COALESCE`. Proven directly — the
`COALESCE` was deliberately removed and the exact `null` (rather than
`0`) result reproduced before being restored.

## Deliberately not a closed set

Decision 0015's own framing — "multiple methods *per real consumer*"
— implies this interface is meant to grow as new real consumers
emerge, not stay fixed at three methods forever. Confirmed explicitly
in conversation before building: there may be other use cases later,
and adding them doesn't require redesigning this module, only adding
another method to it, the same way `findSimilarInvoices` and
`getSupplierHistory` sit alongside each other now.

## What's still open

- `getMonthlyTotals` has no HTTP endpoint yet — built and tested at
  the function level, deliberately not exposed until a real analytics
  consumer needs it, matching the "start narrow" discipline used
  throughout this project.
- No authentication on the new `/suppliers/:id/history` route —
  matching `intake-stats`'s own administrative-visibility reasoning,
  worth revisiting together whenever that gets revisited.
- Genuinely new query patterns (date-range filtering, cross-supplier
  aggregation, line-item-level history) remain unbuilt until a real
  consumer needs them specifically.
