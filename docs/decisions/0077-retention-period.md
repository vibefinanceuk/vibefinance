# 0077 — A configurable retention period

**Status: built.** Answers the open question Document 1 section 6.4 has
carried since the R2 design, and decision 0068 made pressing.

---

## The question it answers

Nothing expired anything, so the answer was **"forever"** — a decision
by default rather than by choice. Decision 0068 sharpened it by
retaining every captured document rather than discarding it: the volume
now grows with every invoice.

---

## A benchmark, not a purge schedule

**Nothing here deletes anything.** The number says how long documents
should be kept; a report says what has passed it. Whether to export and
purge is then a decision somebody takes with the list in front of them.

That split is the operator's own framing and it is the right one.
Deleting a customer's invoices on a timer is irreversible, and a
retention period is the kind of setting whose first configuration is
often wrong. **A wrong number that produces a report is an afternoon's
confusion; a wrong number wired to a delete is a compliance incident.**

The `GET` payload says `enforcement: "none"` in as many words, because
an operator reading a retention period could reasonably assume it was
enforced.

---

## In the customer's own database

`org_settings`, a singleton table. Each customer has their own D1
database (Document 1 section 5), so "the organisation" *is* the
deployment.

**A singleton with typed columns, not a key-value store.** Settings as
strings would mean every reader parsing and every writer trusting;
`retention_years INTEGER CHECK (BETWEEN 1 AND 50)` refuses a typo at
write time. A period of 500 years is not a policy.

The row is created by the migration rather than on first write, so no
reader carries a fallback — and fallbacks drift from the defaults they
shadow.

**The control plane was the alternative** and was rejected: the eventual
purge runs in the customer's database and needs local access to
`invoice_documents` and the R2 keys. If fleet-wide visibility of
retention is later wanted, that is a read from `vf-licence` across
customers, not a reason to move the setting.

### Default 7

The common EU and UK requirement for VAT records. The same reasoning as
decision 0053's extraction settings: **a default asserts "this is
usually true, and here is where to change it"**, where a hardcoded value
asserts "this is always true" and cannot be inspected.

---

## The anchor: issue date, falling back to capture

Regulations are written about the document's own date rather than the
day a system happened to read it, so `issue_date` is the anchor where
there is one.

**An undetectable document has no issue date at all** (decision 0063).
Excluding those would leave exactly the documents nobody could read
sitting outside the retention report forever — the population most
likely to need reviewing.

So the fallback is the capture date, and **which anchor was used is
reported per row**. The two can differ by months, and somebody deciding
whether to purge should not have to guess which applied.

---

## The report is the half that makes the number real

A stored number nothing reads is the pattern this codebase has now
found eight times — most recently a migration checksum written on every
apply and compared to nothing (decision 0076).

`GET /settings/retention/beyond` lists what has passed, with each
invoice's anchor, which anchor it was, and its R2 key.

**Invoices with no retained original are listed rather than hidden.**
Captured before decision 0068, or retention failed — there is nothing in
R2 to purge for them, and that is itself a finding.

A test watches the report against a hardcoded period rather than the
setting, and fails: the exact divergence decisions 0056 and 0057 were
both about.

---

## What this does not do

- **No export, and no purge.** The next step, and deliberately separate
  — export must come first, and be verified, before anything deletes.
- **One period for the whole organisation.** Document 1's R2
  jurisdiction support (`eu`, `fedramp`, `us`) exists because rules
  differ by jurisdiction, and a single number cannot express "seven
  years in Germany, five in the UK". Right for a customer operating in
  one jurisdiction; wrong the moment they do not. Known next step rather
  than an oversight.
- **Nothing acts on the report.** No alert, no scheduled review. The
  cron trigger that already refreshes licences would be the obvious
  home if that is wanted.
