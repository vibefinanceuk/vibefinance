# 0080 — The live AP process had three stages

**Status: applied.** `docs/operations/ap-live-process-definition.sql`,
dry-run against a replica and then run once against `vf-app-poc`.

Confirmed afterwards: seven stages in order, six rules on
`ap-live-validation`, and a fresh capture of the Morrison PDF stopping
at **Validation** rather than Approval — an unreadable document now
waits for whoever validates rather than landing on an approver's queue
for a problem they cannot solve.

---

## What was found

The live `ap-live` process:

| Sequence | Stage | Rule set |
| --- | --- | --- |
| 1 | Received | — |
| 2 | Approval | `ap-live-approval` (7 approved rules) |
| 3 | Payment-eligible | — |

Against a real AP flow of Intake, Validation, Matching, Coding,
Approval and Review.

**All seven rules were on Approval**, and only one is an approval rule.
The other six are validation work — three `set_field` conflict
resolutions, a conflict task, and the validation-failed task. They fired
at Approval because it was the only stage with a rule set.

That is why an unreadable document landed in front of approvers, and why
~35 instances are parked there.

---

## How it went unnoticed

Nobody had looked at the live definition since it was created. Every
test this week used it and every test passed, because the engine was
behaving correctly against the definition it was given.

**A process definition is configuration, and nothing validates
configuration against intent.** The rule engine checks a rule against
the vocabulary; the migrations check the schema against its invariants;
nothing checks that a process has the stages its business actually has.

It surfaced only because decision 0075 constrained returns to stages the
instance had visited, and a return from Approval could reach exactly one
place: `received`. The constraint was working correctly against a
process that did not model the workflow.

---

## Not a migration

`ap-live` is one customer's configuration. Migrations run against every
customer's database, and inserting a stage named `Coding` would assert
that every customer's AP process has one.

Decision 0061's seeding worked as a migration because it **derived**
from whatever data was there — three structural channels per process
that already had a channel. Named business stages cannot be derived.

So: operator SQL, in `docs/operations/`, run once. That folder is new
and is the right home for this class of thing — one-off configuration
against a named database, reviewed like code and not part of the chain.

---

## The stages carry no rules yet, and still matter

Matching, Coding and Review have no rule set. A stage without one
cascades straight through, so an invoice passes without stopping and
they cost nothing today.

They are not decoration. **A stage that exists is a valid return
target** (decision 0075), and returning to one that does not exist is
refused. Their existence is what makes "return this to Coding" possible
at all.

Matching and Coding also encode the operator's own design, which needs
no branching: both invoices pass through both stages, and each stage
does something only when the facts warrant it. An invoice with a
purchase order has matching work; one without passes Matching untouched
and needs coding. That is rules over facts, not routing — and it is why
decision 0079's uncomputed `po.*` fields are what actually block
Matching from doing anything.

---

## Renumbering, and what it does to work in flight

`sequence` is unique per process, so the existing stages move first, in
descending order.

**Instances reference `current_stage_id` by id, never by sequence**, so
the ~35 parked at Approval stay exactly where they are. On completion
they advance to Review rather than Payment-eligible — the new definition
applying to documents already in flight.

That is correct rather than merely acceptable: a document mid-flow
should follow the process as it now stands, not the one it entered
under. But it is a behaviour change to live work and is stated here
rather than discovered.

---

## Verified before running

The SQL was dry-run against a replica built from the migration chain and
seeded with the live state exactly as queried — same stages, same rule
set, same seven rule ids, an instance parked at Approval.

Afterwards: seven stages in order, six rules on Validation and one on
Approval, the parked instance untouched, no duplicate sequences.

Rules are moved **by id, named individually**, not by a pattern. A rule
set is what a customer's rules are evaluated against, and moving one by
accident changes when it fires.

---

## A near miss worth recording

The rule survey used `WHERE v.approved_by IS NOT NULL` and returned
seven rules. The rule-set count in the same output said **eight**, and
that discrepancy was read past.

The eighth turned out to be an unapproved **duplicate** of the
over-1000 rule — the same sentence compiled twice during earlier
testing, with only one taken through the activation gate. It belongs on
`ap-live-approval` anyway and fires nowhere, since evaluation loads only
rules that are enabled, approved and within their effective window.

So no harm. But the reasoning that led there was wrong: **had the eighth
been a different rule, one that should have moved, it would have been
left firing at the wrong stage.**

The correct question for "what rules does this set contain" does not
filter by approval — an unapproved rule is still in the set, it just
does not run. Filtering by what is *active* answers a different
question, and answering it while believing it was the first is how
survey errors happen.

---

## What this does not do

- **No rules for Matching, Coding or Review.** Matching waits on
  purchase orders existing at all (decision 0079). Coding could have a
  manual-coding task rule today.
- **`AP.Match` and `AP.Code` remain unbacked permissions**, as
  `permissions.ts` already says.
- **Nothing surfaces a stale process definition.** This was found by
  accident, through a constraint in an unrelated feature. A process with
  one stage and forty rules would look exactly as healthy.
