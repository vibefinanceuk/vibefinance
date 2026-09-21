# 0429 — Agreed payment means, a supplier-record placeholder; the report dashboard deliberately not built

**Status: built, not yet delivered.** No bundle handed over yet for
this decision. This session still has no push access to
`vibefinanceuk/vibefinance`; will be delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0428 already used.

---

## What was asked

Following on from the operator's own question about Peppol BIS Billing
3.0's payment fields, the operator's own reasoning:

> In order to establish a gap I think these fields would also need to
> be held on the supplier record, in order to establish a difference
> between agreed payment means and invoiced payment means. I would say
> at this point, add the fields to the supplier record, as a
> placeholder - but we should hide the report dashboard at this point.

Two things in one instruction: add the fields, and explicitly do not
build anything that reports on them yet. Both are followed literally
below.

## What was built

**Three new nullable columns on `suppliers`** (migration `0073`),
mirroring the standard's own `BG-16`/`BG-17` Credit Transfer group —
`BT-81` (payment means, kept as one free-text field rather than
policing the standard's own UNTDID 4461 code list, the same treatment
`payment_terms` already gets), `BT-84` (IBAN/account identifier),
`BT-85` (account name):

- `agreed_payment_means`
- `agreed_account_identifier`
- `agreed_account_name`

**Loaded exactly like `discount_pct`/`discount_days` (decision 0427)**
— a customer's own CSV mirror-load export, under several header
spellings (`Payment Means`, `IBAN`, `Account Name`, and their
`db_style` equivalents), never invented or backfilled. A supplier
loaded before these columns existed carries `NULL` in all three until
its own next reload. Wired into all three places a CSV-loaded field
needs to reach — `load-suppliers.ts`'s `COLUMNS` map, its upsert
`INSERT ... ON CONFLICT`, and the general field-change audit
(`supplier-audit.ts`'s `AUDITED_FIELDS`, decision 0427's own mechanism)
— for free, since that diff is written generically over whatever
`AUDITED_FIELDS` lists.

**Left out of every other surface, on purpose:**

- **Not in `EDITABLE`.** `handleUpdateSupplier` (the hand-edit route)
  does not recognise these keys — the same treatment `discount_pct`/
  `discount_days` already get. A placeholder loaded from the ERP
  export is not something a person types in by hand.
- **Not in the suppliers list screen's edit form or table** —
  `workers/vf-ui/public/suppliers.js` is untouched.
- **Not in any route's `SELECT` list** beyond the load itself — checked
  directly rather than assumed: every other query against `suppliers`
  (the list/search API, the invoice viewer's matched-supplier block,
  the dashboard, the performance/discount-eligibility reports) names
  its columns explicitly rather than `SELECT *`, so nothing leaks these
  three into a response nobody asked for. A test locks this in — the
  list API's own JSON is asserted not to mention them at all.
- **No comparison route, no dashboard card, no screen.** The "hide the
  report dashboard" half of the instruction, honoured by never having
  built one — there is nothing live to hide.

## Why the report stays unbuilt — investigated, not assumed

Two independent reasons, both checked directly against the codebase
rather than taken on faith:

1. **There is no "invoiced payment means" yet to compare against.**
   Answering the operator's own prior question about Peppol BIS 3.0
   required reading `shared/ingestion/ubl-parser.ts` and
   `shared/interpreter/vocabulary.ts` directly. They capture `BT-9`
   (due date) and `BT-20` (payment terms text) from an inbound
   invoice, and nothing from its `BG-16` payment-instructions group —
   no payment means type, no IBAN, no account name. A comparison built
   today would be comparing a real agreed value against a column that
   is always empty, which is not a comparison; it is the agreed value
   with extra steps.
2. **A report over a mostly-`NULL` column is exactly the shape of
   thing this project has already pulled a live one for.** Decision
   0428's second addendum removed "Exceptions by user" because a
   number that looks like a finding was actually reporting on which
   rows happened to be in the data. Most suppliers' CSV exports were
   never asked for a payment means, an IBAN, or an account name — these
   three columns will be `NULL` for the overwhelming majority of
   supplier records for a long time, possibly permanently for
   customers whose ERP export never carried banking detail at all. A
   "mismatch" card built over that data would mostly report on which
   suppliers' exports happened to include banking detail, not on
   which invoices' payment means changed — the same category of
   mistake, not a new one.

Closing the gap for real needs a further decision this one deliberately
does not make: adding `BG-16`/`BG-17` ingestion to `ubl-parser.ts` and
`vocabulary.ts` (the invoice side), and then a genuine comparison —
almost certainly gated behind the same kind of access question decision
0428's second addendum raised for "Exceptions by user", since a
mismatch flag naming a specific invoice and a specific expected bank
account is exactly the kind of individually-identifying, high-stakes
data that gate was written for.

## Tests

Six new tests in `workers/vf-app/test/load-suppliers.test.ts`
(`describe("the agreed side of a payment-means comparison — decision
0429, a placeholder")`), full suite otherwise unchanged:

- Loads all three fields from a real export's own column names
  (`Payment Means`, `IBAN`, `Account Name`).
- Also recognises the columns' own db-style names, mirroring
  `discount_pct`'s own aliases.
- Leaves all three `NULL` when an export never mentions them.
- Confirms `handleUpdateSupplier` does not recognise these keys — an
  attempted hand-edit changes nothing, the route returns 400 "nothing
  to change".
- Confirms a second load with a different value is recorded by
  decision 0427's own field-change history, the same mechanism every
  other CSV-loaded field already gets.
- Confirms the list API's JSON response does not mention any of the
  three fields or their values at all.

vf-app: 2281 → **2287** tests, full suite run directly, all passing.
`eslint` clean on every changed file. `migrations/test_apply_migrations.py`
— 27 passed, migration `0073` applies cleanly with the rest.

## What is not built

- **`BG-16`/`BG-17` ingestion from an inbound invoice.** The other half
  of the comparison this decision is preparing for. A further decision,
  not started here.
- **Any comparison, mismatch flag, or dashboard card.** Explicitly
  out of scope per the operator's own instruction, and blocked in any
  case by the gap immediately above.
- **`BG-18` (card) / `BG-19` (direct debit) fields.** Left out of the
  supplier record entirely for now — this table mirrors how
  VibeFinance's own customers actually pay suppliers, and credit
  transfer is the normal case for B2B AP. Card and direct-debit mandate
  detail can be added the same way, later, if a real customer's export
  ever carries them.
- **Any hand-edit or UI surface for these three fields.** Deliberately
  CSV-load-only, matching `discount_pct`/`discount_days`.
