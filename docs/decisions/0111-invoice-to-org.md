# 0111 — Which part of the enterprise an invoice belongs to

**Status: proposed.** Nothing built. Written first because it makes
`org_units` load-bearing for the first time and touches intake, the
vocabulary, the rule engine and the workflow engine together.

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
