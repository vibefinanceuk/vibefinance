# 0226 — An invoice bills a company

**Status: built.** The header names the legal entity. The lines carry
the coding.

---

## The correction, with a diagram

> When an invoice is received it typically is billing a legal entity, or
> sub-org. The legal entity has a tax identifier. This is what should be
> specified in the Buyer card... An invoice can include charges incurred
> by one department or cost center, but frequently includes multiple
> where a purchase for stationery is booked across multiple departments
> / cost centers and GL codes. So when we look at sources, and the
> validation UI, I think we just need to determine which company bought
> it, and then the actual internal cross charges, which occurs at line
> level, can happen deeper into the workflow.

**Migration 0036 had this the wrong way up.** Its standing invariant
said an invoice belongs to an **operating unit**, because *"the
operating unit is where payables happen"* — and then matched invoices on
`BT-48` and `BT-49`, which are the **taxable company's**.

Decision 0225 named the three things sharing one word. **This settles
the first**, and the second was always where it belonged:
`invoice_lines.cost_centre`, since migration 0007.

---

## Two failure modes deleted rather than fixed

`ambiguous_unit` — a matched company with several departments.
`no_operating_unit` — a matched company with none.

**Neither was a failure.** Both existed because a match on a company had
to be forced down a level, and a company with three departments was
never ambiguous: **the question is which company bought it, and the
document said.**

Decision 0204 reported them, decision 0219 wrote sentences explaining
them, and decision 0224's card was built around showing both a unit and
its entity. **All of that was scaffolding for a question nobody had
asked.**

---

## A standing invariant, superseded rather than deleted

Migration 0036's `ASSERT ALWAYS` is now a note saying what it said, why
it was wrong, and where the new one lives. The file was edited after
being applied, with `--refresh-checksums` — which the script's own help
calls *"the act of saying so."*

**And the obvious replacement is deliberately absent.** *An invoice's
unit must be a legal entity* would refuse every row placed before today,
and **a customer with no legal entities configured has operating units
and nothing else** — an invoice placed on one is placed as well as it
can be.

**Refusing existing data is how a migration becomes something nobody
dares run.**

---

## So a mailbox belongs to a company

The Sources dropdown demanded an operating unit and now offers
companies first, with departments still available for the customer who
has only those.

**Nobody sends an invoice to *Finance*.** They send it to Acme UK
Limited, and which department bears the cost is decided later.

---

## What is not built

- **Coding.** The stage where a line is charged to a cost centre,
  project or GL code does not exist. `BT-133` and
  `invoice_lines.cost_centre` are read from the document where it
  carries them, and nothing assigns one.
- **Decision 0224's Buyer card still shows a unit and its entity**,
  which is now usually the same row shown twice. Harmless and worth
  simplifying.
- **Configuration scoping is untouched and now means the company.**
  Decisions 0196, 0197, 0199 and 0202 walk up from whatever the invoice
  holds, so they work unchanged — **but a rule set scoped to Acme UK now
  applies to every department of it**, which is coarser than it was and
  may be exactly right. Decision 0225 asked this and it is answered by
  default rather than by decision.
