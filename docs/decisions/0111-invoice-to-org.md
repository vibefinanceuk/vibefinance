# 0111 — Which part of the enterprise an invoice belongs to

**Status: built**, including the routes to configure and use it.
`org_units` is load-bearing for the first time since decision 0003
created it. **Not built:** the supplier master, and any *screen* —
placing an invoice is an API call.

---

## The concept, and where it comes from

Every serious accounts-payable system has it. Oracle EBS calls it the
**Operating Unit** — the level that *"links subledger transactions like
Payables and Purchasing to a legal entity"*, and the level a user works
within to enter an invoice. SAP calls it a Company Code. The shape is
the same: a part of the enterprise with its own suppliers, its own
ledger, its own books.

The operator's statement of why it matters:

> The Org needs to be settled upon entry into the system, because it
> impacts everything downstream — user groups, GL structure, etc.

An invoice processed under the wrong org is posted to the wrong books
and approved by the wrong people. It is not a routing preference.

---

## What exists, and what does not

`org_units` has **`id`, `name`, `parent_unit_id`** and nothing else.
Created in decision 0003, listed in `PROGRESS.md` as built, and
**referenced by no invoice, process, source or user**. A declared thing
nothing uses — this project's recurring pattern, at table scale.

There is also **no supplier master**. `/suppliers/:vatId/history`
queries invoices by the VAT id printed on them; a supplier is a string
that appears on documents, not a record.

---

## Two ways to know, and the answer is both

The operator put both on the table:

> Either we identify it from the invoice during Intake and create a
> business rule to default it, or we tell the customer they need to
> define sources per Org — a different email address, for example.

**They are not exclusive, and offering both is better than choosing.**

- A customer with **one mailbox per org** needs no rule and gets a
  deterministic answer from the transport.
- A customer with **one shared mailbox** writes a rule against the
  buyer identifiers on the document.
- Most will do both, with the source as the fallback when a document
  says nothing.

This is also consistent with everything else here: a closed vocabulary
and a rule the customer wrote, rather than platform logic making a
business decision on their behalf.

### Order of resolution

1. **A rule that fires** — the customer's own decision, most specific.
2. **The source's default org** — deterministic, and the answer when a
   document says nothing readable.
3. **Unresolved** — which is not a failure but a **task**.

---

## The standard already answers this

BIS Billing 3.0 carries three discriminators, and the first is
unambiguous about its purpose:

| Term | Element | Purpose |
| --- | --- | --- |
| **BT-10** Buyer reference | `cbc:BuyerReference` | *"An identifier assigned by the Buyer used for **internal routing purposes**"* |
| **Buyer electronic address** | `cac:AccountingCustomerParty/.../cbc:EndpointID` | What Peppol itself routes on |
| **BT-48** Buyer VAT identifier | `.../cac:PartyTaxScheme/cbc:CompanyID` | The legal entity being invoiced |

BT-10 and BT-48 are already in the vocabulary. **The buyer electronic
address is not**, nor is BT-49 (buyer name) — so two of the three things
a customer would most naturally write a rule against cannot be
referenced.

That is the same shape as decision 0110: the document says it, and we
discard it.

---

## `assign_org`, a new action

A rule can `route_to`, `flag`, `assign_task`, `assign_cost_centre` — and
nothing that sets an org.

```json
{ "action": "assign_org", "params": { "org": "<org unit id>" } }
```

**More than one distinct org fired in the same evaluation is refused
outright**, exactly as `route_to` already refuses two targets (decision
0019). An invoice belongs to one part of the enterprise, and a rule set
that cannot decide should say so rather than pick.

---

## Validation is the guarantee point, and must be able to refuse

> Upon entering Validation the Org should be known.

That gives Intake a stage to resolve in and a place to fail. But *known
at Validation* is a hope unless something enforces it — so a stage needs
to be able to **require** an org before advancing.

An invoice reaching Validation with no org becomes a task for a person,
not a silent default. Which is the same principle as decision 0063: a
document nothing could read is captured and put in front of somebody,
never rejected and never guessed at.

---

## The document is a check, not only a router

If an invoice arrives at the **French** source naming the **UK**
entity's VAT identifier, that is not a routing decision to make. It is
an exception for a person.

Deriving the org silently from either side would mean processing a
misdirected invoice under the wrong books without anybody noticing.
Once both the source default and the document's buyer are known, their
disagreement is a fact a validation rule can test — and should be.

---

## What this needs, in order

1. **Vocabulary**: the buyer electronic address, and BT-49 buyer name.
   Both are in the standard; neither is here.
2. **`org_units` gains a `kind`** — it already has `parent_unit_id`, so
   `legal_entity` above `operating_unit` expresses the hierarchy without
   a new table. Plus the identifiers it can be matched against.
3. **`sources` gains a default org**, and every invoice gains an org.
4. **`assign_org`**, with the one-target discipline.
5. **A stage may require an org**, so Validation can enforce rather than
   hope.

---

## Built

**Two levels, not Oracle's five.** `org_units` gains a `kind` —
`legal_entity` or `operating_unit` — using the `parent_unit_id` it
already had. Business Group, Ledger and Inventory Organization serve
payroll, general ledger and stock, and **adding four concepts nothing
consumes is precisely the mistake `org_units` itself has been**.

**`assign_org`**, with the same single-target discipline as `route_to`:
more than one distinct org fired in one evaluation is refused outright.
An invoice belongs to one part of the enterprise, and a rule set that
cannot decide should say so rather than pick.

**The source's default**, applied at capture and guarded by
`org_unit_id IS NULL` — so a rule, being the customer's more specific
decision, wins.

**And `org_assigned_by`**, recording *how* it was placed: `rule`,
`source` or `manual`. Which is what lets a disagreement be investigated
rather than argued about.

### The guard runs where a stage is LEFT, not entered

This was wrong twice before it was right.

Placed **after** evaluation, it never ran on an automatic stage — one
with no rule set advances without evaluating anything, and that is
exactly the stage nobody configured rules for. Placed **before**, it
refused an invoice a rule at that very stage was about to place.

So `orgGuard` is called on both paths out of a stage. The question is
*may this invoice leave*, and there are two ways to leave.

### Three invariants the schema enforces

- An invoice is assigned to an **operating unit**, never a legal
  entity. A legal entity is a tax and reporting boundary; the operating
  unit is where payables happen.
- An org and its provenance **travel together**. One without the other
  is worse than neither: an org nobody can explain, or a provenance
  pointing at nothing.
- An operating unit's parent, where it has one, is a **legal entity**.
  A hierarchy that nests arbitrarily is one nobody can reason about.

Watched to fail: removing the automatic-path guard, and letting an
invoice be posted to a legal entity.

---

## Managing it

**`POST /org/units` knew nothing about any of this.** A unit could be
created without saying what it was, silently defaulting to an operating
unit. It now takes `kind` and the identifiers an invoice is matched
against, and refuses an operating unit under another operating unit
with a reason rather than a constraint error.

**That narrows an existing endpoint**, and an existing test caught it:
one that nested *"Germany"* under *"EU Division"*, both of no particular
kind. Worth stating plainly rather than filing as a test fix — a
customer nesting operating units would now be refused.

**`GET /org/units` did not exist.** Units could be created and never
listed, so a customer writing an `assign_org` rule had to guess the id
they were naming.

**And `PUT /invoices/:id/org` places one by hand.** `'manual'` has been
in `org_assigned_by`'s `CHECK` since the migration and **nothing could
produce it** — a value declared and unreachable, which is this project's
most frequent finding, appearing inside the very decision that added it.

It reports what it replaced, so a **correction** is distinguishable from
a **placement**: overriding a rule's decision and filling an empty one
are different acts and an audit should be able to tell them apart.

A test walks the whole loop — a stage refuses the invoice, a person
places it, the invoice moves.

---

## Two things this cost, worth recording

**A trailing comment silently disabled a migration.** The test harness
strips only lines that *start* with `--`, then collapses whitespace to
one line — so `ALTER TABLE ...;   -- BT-49` comments out **every
statement after it**. The replay runner accepted it; 713 tests failed.
Comments go on their own line, which is what every other migration
already does.

**And I wrote a test fixture against a schema I had not read.** Four
wrong assumptions in a row: `rules` and `rule_versions` are separate
tables; `rule_versions` has a composite key rather than an `id`; the
function is `visitCurrentStage`; and the engine evaluates the facts it
is **given** rather than the ones stored. Each fix revealed the next.

The fifth would have been `effective_from`, which the loader requires —
a rule version with a null one never loads, however approved it looks.
**Read the schema before writing the fixture.**

---

## Deliberately not in this

- **Oracle's other levels.** Business Group, Ledger and Inventory
  Organization serve payroll, general ledger and stock — **none of which
  exists here**. Copying a hierarchy for its own sake would add four
  concepts nothing consumes, which is the mistake `org_units` itself
  already represents.
- **The supplier master, and supplier sites.** Real and needed: a site
  assigned to an operating unit is how a supplier's invoices reach the
  right part of the enterprise, and it is also what *"supplier groups"*
  in `PROGRESS.md` has always been waiting for. **Downstream of an
  invoice having an org at all**, so it follows rather than leads.
- **Per-org GL structure.** Named as a consequence by the operator and
  not designed here. Nothing in this system posts to a ledger yet.
- **Backfilling existing invoices.** One customer, and every invoice
  currently belongs to no org. Whether they are assigned retrospectively
  or left null is a decision for when there is somewhere to put them.
