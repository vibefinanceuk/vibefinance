# 0184 — Cost object approval

**Status: designed, not built.** How an invoice line finds its
approvers, and how many it needs.

---

## What was asked for

> Ultimately an invoice will need to be evaluated for approval based on
> the cost centre on the line, and lookup of whether approval is needed,
> based on a hierarchy. It might require 1, 2 or none or 6 approvals
> based on the hierarchy.

This has a name and two established shapes. **SAP Concur calls it Cost
Object Approval**; Oracle Fusion calls it Cost Center Approval. Both
describe the same thing and the vocabulary is worth borrowing rather
than inventing.

---

## The two modes, and they are mutually exclusive

Concur is unusually clear that a step is **one or the other, never
both**:

**Level.** Each approver has a **sequential position** — junior manager,
then senior manager, then the CFO. The document moves from one level to
the next **all the way to the end**. Six levels means six approvals,
regardless of amount.

**Limit.** Each approver has a **signing authority** — an amount they
may approve. The document starts at the first approver and moves up, and
**stops at the first person whose limit covers the amount.** A £500 line
stops at a manager; a £50,000 line carries on upward.

**And a third option worth knowing:** *Cost Object Direct Approval* goes
**straight to** the approver whose limit covers it, with no stops in
between. One approval rather than a chain.

This is what *"1, 2, none or 6"* means. **Limit** gives one or two;
**Level** gives six; a cost centre with no approver configured gives
none.

---

## Parallel across cost objects, serial within one

The other half, and it resolves what *"serial"* meant:

> Each affected cost center is reviewing the invoice at the same time.
> This can save a tremendous amount of time.

So an invoice touching three cost centres raises **three chains at
once**, and each chain is walked **in order**. Decision 0183's per-line
tasks are the parallel half, already working. The serial half — walking
up a chain — is not built.

And each cost centre approves **its own portion**: *"approve, partially
approve, or reject the portion allocated to its budget."* The amount
that matters is **the lines charged to that cost centre**, not the
invoice total.

---

## What this project already has

**`org_units`** is a real hierarchy — `parent_unit_id` referencing
itself, so it walks upward. This is the chain **Level** mode needs.

**`org_authority_limits`** holds `(user_id, currency, max_amount)`. This
is precisely **Limit** mode's signing authority. It can be written
through a route today and **nothing reads it** — declared and never
consulted.

**`BT-133`** is the line's cost centre, and decision 0031 kept it
deliberately separate from `org_units`: *"a financial construct, not an
organizational one."*

**Decision 0183's per-line tasks** already raise one task per line, each
naming its line.

---

## What is missing, and it is the join

**A cost centre has no approver.** Nothing maps `BT-133` to a person or
an org unit, and decision 0031's separation means this is a real
decision rather than a lookup: a cost centre is not an org unit, so
either it points at one or it carries approvers of its own.

**Concur's own answer is the second**: a *cost object approver* is
configured against a node in a hierarchy, with a currency, an amount,
and a level. The cost object is the thing approved; the approver is
attached to it.

**Nothing walks a chain.** `assign_task` names one team or one person.
Producing *"this line needs Alice, then Mo, then the CFO"* requires
something that reads a limit or a level and decides who is next.

**And nothing advances on completion** (decision 0183). Completing a
task marks it done; a rule moves the process. A chain needs the
opposite: finishing approval **n** raises approval **n+1**, and finishing
the last one releases the line.

---

## Two things both sources insist on

**A change re-enters the process.** Concur: *"if an approver makes
certain changes, the invoice re-enters the approval process"*, so every
approver sees the amended version. Decision 0144 already makes Approval
read-only, which sidesteps this — and the moment an approver may change
a cost centre, it applies.

**Delegation and absence.** Oracle: rules should define what happens
*"when a cost center owner changes role, delegates authority, or becomes
unavailable"*. Nothing in this project has a delegate, and a chain that
stops at somebody on holiday is a chain that stops.

---

## What would need building

- **A cost object approver table**: cost centre, approver, currency,
  amount, level — Concur's own shape.
- **A mode per stage**, level or limit, never both.
- **A chain walker** that decides who is next, and stops when the limit
  is covered or the levels run out.
- **Completion advancing the chain**, which is new behaviour in a system
  where completing a task does nothing.
- **What happens when the chain runs out** with the amount uncovered.

---

## Deliberately not decided here

- **Whether a cost centre points at an org unit or carries its own
  approvers.** Decision 0031 kept them apart on purpose, and this is
  where that separation is tested.
- **Whether partial approval exists.** Concur has it — approve part of
  what is charged to you — and it multiplies the state a line can be in.
- **Whether the amount is the line, the sum of a cost centre's lines, or
  the invoice.** Concur says the portion; the difference decides which
  approvals a split invoice needs.
