# 0079 — Three derived fields nothing computes

**Status: findings, nothing built.** Found while designing the Matching
and Coding stages.

---

## What is wrong

Three fields are declared in the closed vocabulary and set by nothing:

| Field | A rule a customer could write | What happens |
| --- | --- | --- |
| `po.matched` | *"if the invoice does not match its purchase order, assign a task"* | Compiles, activates, never fires |
| `po.variance_pct` | *"if PO variance is over 5%, require approval"* | Compiles, activates, never fires |
| `party.first_document` | *"if this is the first invoice from this supplier, require review"* | Compiles, activates, never fires |

Each passes `validateRule()`, survives the worked-example gate, appears
correct in every listing, and has no effect on any document.

**The ninth instance of one layer describing something no other layer
provides** — and the second where the vocabulary makes a promise the
system cannot keep. Decision 0054 was the same shape for
`extraction.confidence`, and decision 0074 removed
`require_second_approval` rather than build it.

---

## `po.*` is worse than uncomputed

`extraction.confidence` needed a line of wiring. These need a domain.

**There are no purchase orders in this system at all.** No table, no
ingestion route, no line-level detail, nothing to match against. The
vocabulary describes a capability with no data behind it, not merely no
computation.

Which means these two cannot be closed by a small fix. They need
purchase orders as a real thing: a schema, a way to load them from an
ERP or a file, and a matching routine producing both fields.

---

## `party.first_document` is genuinely close

Unlike the `po.*` pair, the data exists. It is a query:

```sql
SELECT count(*) FROM invoice_headers
WHERE supplier_vat_id = ? AND id != ?
```

The design questions are small but real, and picking wrongly is worse
than not building it:

- **Identify a party by what?** `BT-31` (seller VAT id) is the obvious
  key and is absent on documents nobody could read — the exact
  population where "first document from this supplier" is most worth
  flagging.
- **First ever, or first since when?** A supplier who last invoiced in
  2019 is arguably new again.
- **Computed when?** At capture, it is a fact about the moment the
  document arrived. Computed at evaluation, it changes as more invoices
  land, so re-running a rule set could yield a different answer — which
  breaks the reproducibility property Document 2 section 3 leans on:
  *"reproduces on your laptop from two inputs: their rules and the
  invoice."*

That last point is the substantial one. **It must be computed once, at
capture, and stored** — like `invoice.duplicate_confidence` (decision
0028), which faced the same question and settled it the same way.

---

## Why this was not caught

Decision 0067 built a coverage check: every declared **invoice** field
must be populated by the UBL parser or recorded as deliberately
unmapped.

It covers `INVOICE_FIELDS` — the BT codes. **Derived fields are a
different list and nothing checks them**, which is how three of them sit
here uncomputed.

The check's own record says so: *"only the UBL path, and only invoice
fields"*. Stated as a limitation, and this is what that limitation cost.

Extending it is harder than it sounds. A derived field has no single
producer to grep for; `validation.passed` is set in the workflow engine,
`invoice.duplicate_confidence` at capture, `mandate.channel` in the
capture route. A check would need each field to name where it is
computed — which is the same "state the gap to allow it" discipline that
made 0067 work, applied to a harder case.

---

## What to do

**Nothing today.** Recorded rather than fixed, because the three have
genuinely different answers:

1. **`party.first_document`** is a day's work once the three questions
   above are settled. Worth doing before the `po.*` pair, and it would
   prove the "compute at capture, store as a fact" pattern for the
   others.
2. **`po.matched` and `po.variance_pct`** wait on purchase orders
   existing, which is the first genuinely new domain since intake.
3. **The vocabulary should not keep promising all three** in the
   meantime. Decision 0074 removed an action rather than leave it
   declaring an intention; the same argument applies here, and the
   counter-argument is that these have a real design behind them and a
   plausible date, where `require_second_approval` had neither.

Leaving them is defensible. Leaving them **undocumented** was not.
