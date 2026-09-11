# 0225 — Three things called a business unit

**Status: evaluation, no code.** What the operator's correction changes,
and the one question it turns on.

---

## The correction

> At this stage I think the invoice needs to identify the Organisation
> and perhaps legal entity in the Buyer card. This is the Taxable
> company. The business unit within that, is typically held at line
> level. Because an invoice may be booked to the general ledger across
> business units / departments. The PO holds this information, and if
> there is no PO then the Coding stage is used to book the invoice line
> information to the correct business unit, via identifying Cost Center,
> or Project, or Commodity Code and General Ledger Code.

**The line-level half is plainly right** and this system already half
has it: `invoice_lines.cost_centre` has existed since decision 0007, and
`BT-133` — *line accounting / cost centre reference* — since decision
0031.

**The header-level half needs care**, because three different things are
being called the same name.

---

## Three things, and only one of them is what decision 0036 built

**The taxable company.** Who the invoice is addressed to, whose VAT
number is `BT-48`, who reclaims the tax and files the return. **One per
invoice**, and never divisible: half an invoice cannot belong to a
different company.

**The charge coding.** Where each line lands in the general ledger —
cost centre, project, commodity, account. **Per line**, and routinely
split across departments, which is the operator's point and is correct.

**The processing organisation.** Whose AP team owns this document, whose
approval rules apply, whose queue it appears in. **Per invoice**, and it
is neither of the above: a shared service centre in Warsaw processing a
German company's invoices is all three being different at once.

**Decision 0036 built the third and called it the first.** Its own
standing invariant says an invoice belongs to an operating unit because
*"the operating unit is where payables happen"* — which is about
**processing**, and then the identifiers it matches on (`BT-48`,
`BT-49`) are the **taxable company's**.

**So the matching and the assignment were never about the same thing**,
and decision 0204's `ambiguous_unit` is the seam showing: a legal entity
with three business units is not ambiguous at all if the header is asking
*"which company"*. It was only ambiguous because the answer had to be
forced down a level.

---

## What that makes wrong, and what it leaves standing

**Wrong:**

- **Decision 0036's standing invariant** — that an invoice's unit must
  be an `operating_unit`. If the header names the taxable company, it
  must be a `legal_entity`.
- **Decision 0204's `ambiguous_unit` and `no_operating_unit`.** Both
  exist only because a match on a company had to be resolved to a
  department. Neither is a real failure; they were artefacts.
- **Decision 0224's Buyer card**, which I built yesterday showing a unit
  and its entity because the model demanded both.

**Still standing:**

- **The tree** (decision 0036), the accounting frame (0195), cost
  centres with owners and limits (0195), and `BT-133`. **The line-level
  story needs all of it** and none of it changes.
- **Decision 0218's pay site**, which is about the supplier's side.

---

## And one question the whole thing turns on

**What scopes the configuration?**

Decisions 0196, 0197, 0199 and 0202 scope rule sets, field visibility,
permissions and queues to a **unit**, and they read the invoice's
`org_unit_id` to do it. If that column becomes the **taxable company**,
then:

- **Configuration scoped to a legal entity** is simple and coarse: every
  department of Acme UK shares one approval rule set.
- **Configuration scoped to a processing unit** needs a **second
  column** — which is the honest model, and the one Oracle has: an AP
  invoice carries a business unit *and* a legal entity, and the
  distributions carry the coding.

**I think the second is right**, and it is more work: a header gains
`legal_entity_id` beside `org_unit_id`, the two are matched differently
— the entity from `BT-48`, the processing unit from the source or a rule
— and every scoped lookup has to say which of them it means.

**Not decided here**, and it should be decided before anything is built,
because it is the difference between adding a column and moving one.

---

## What I would not do

**Put the business unit on the line.** The operator's sentence says
*"the business unit within that is typically held at line level"*, and
the mechanism they then describe is **cost centre, project, commodity,
GL code** — which is the charge coding, not an org unit.

A cost centre already belongs to a **ledger** (decision 0195, from
SAP's controlling area), and that is what lets one be charged by several
companies. **Putting an `org_unit_id` on a line as well would be a
second answer to a question the cost centre already answers**, and the
two would disagree.

**Unless the coding genuinely needs to name a department that is not a
cost centre** — in which case that is worth hearing, because it would
change this.
