# 0025 — Intake channel in the real routes, and Expense gets storage for the first time

Status: settled, 1 September 2026. A direct follow-up to decision
0024: "the intake channel could be included in AP, and Expense
routes." Two genuinely different-sized pieces resolved before
building, per the person's own explicit choice to do both.

## Part 1: `mandate_channel` promoted to a real column — small, cheap

`mandate.channel` could already flow through `POST /invoices` before
this — `facts` is free-form JSON, so nothing stopped a caller from
including it. But it sat buried in an opaque blob rather than being
queryable, unlike `supplier_vat_id` or `currency`, which earned real
columns specifically because they're the kind of thing worth
searching or filtering on. Promoted the same way: `invoice_headers`
gains a `mandate_channel` column, `handleUpsertInvoice` accepts
`mandateChannel` as a real, structured parameter. Fully backward
compatible — every existing caller that never supplies it continues
working exactly as before, confirmed by the full existing invoice
facts test suite passing unmodified before the new test was added.

## Part 2: Expense storage — the gap decision 0017 closed for invoices, never closed for Expense

Every prior expense test (decision 0022's `expense-process.test.ts`)
proved the vocabulary and workflow engine work using facts supplied
*inline* — nothing about expense data had ever actually been
persisted anywhere. `expense_reports` and `POST /expenses` close that
gap, mirroring `invoice-facts-route.ts`'s own `handleUpsertInvoice`
almost exactly: same upsert semantics (mutable, not versioned — an
expense report may be corrected or enriched over its lifecycle, the
same reasoning `invoice_headers` already gives for its own
mutability), same narrow scope boundary (accepts already-extracted
facts as JSON; does not parse a receipt image or a mobile app's own
submission format — that remains a separate, unbuilt ingestion
concern, the exact same boundary invoice-facts-route.ts already
states for PDFs and XML).

**A genuine, deliberate structural difference from invoices, not an
oversight**: `expense_reports` is a single flat table, with no
lines-table equivalent to `invoice_lines`. Decision 0022's own
`EXPENSE_FIELDS` never modeled a header-with-multiple-lines document
the way an EN 16931 invoice genuinely is — each expense submission
was always a flat record (`category`, `amount`, `receipt_attached`,
and so on), and the storage layer follows that shape rather than
imposing an invoice-shaped structure onto a domain that never had one.

`receipt_attached` is stored as `0`/`1`, the same boolean convention
`stage_visit_steps.matched` already established — not a new one
invented here. Proven, not assumed: the boolean mapping was
deliberately broken (hardcoded to always store `0`) and confirmed to
fail a real test before being restored.

## `POST /expenses` reuses `Expense.Submit`, the same reasoning `/invoices` already established

`/invoices` reuses `AP.Validate` rather than a new permission, since
storing an invoice's facts is naturally part of the same "an invoice
enters the system" capability. `/expenses` follows the identical
reasoning with `Expense.Submit` (decision 0022's own placeholder
category, previously unbacked by any route) — its first real use
anywhere in this codebase. Licence-gated the same way `/invoices`
already is, confirmed directly with a real `402` test.

## Proven end to end through the real router, not just the unit tests

Both new capabilities confirmed live through `SELF.fetch`, including
the permission-specific case: a real, authenticated user holding
`AP.Validate` but not `Expense.Submit` is correctly refused with a
`403` when posting to `/expenses` — proving the dynamic permission
check is genuinely per-route, not just "any valid key works." The
`/expenses` route's own reachability was confirmed by deliberately
disabling it and watching the test fail with a `404` before
restoring it.

## What's still open

- **Auto-loading expense facts by id**, mirroring how `/rules/
  evaluate` can already load persisted invoice facts when none are
  supplied inline (decision 0017) — not built here, matching
  decision 0019's own deliberate scope boundary against quietly
  special-casing one subject type inside the otherwise generic
  workflow engine.
- No `expense_lines` equivalent — genuinely not needed given how
  Expense's own fields were modeled, but worth revisiting if a real
  multi-line expense report (a single trip report covering several
  distinct charges) ever needs representing.
- The document/receipt ingestion path itself remains unbuilt
  (decisions 0013/0015/0019's long-standing gap) — this bundle is
  what happens once facts exist, not how a photographed receipt or a
  mobile app's own submission becomes structured facts in the first
  place.
- Closed-value enforcement — decision 0023's own still-open item,
  untouched by this bundle.
