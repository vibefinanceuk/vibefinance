# 0230 — Wiring the hold

**Status: built.** A hold is a fact a rule can test, and a person can
set it.

---

## A flag nothing read

The supplier mirror has carried `on_hold` and `hold_reason` since
decision 0209, and **no process has ever consulted either.** Decisions
0211, 0218 and 0219 each recorded it from a different angle.

**`supplier.onHold` is now a derived field** in the closed vocabulary,
recorded at capture. That is what wiring means here: a rule can say
*"if the supplier is on hold, route this for review"*, using
`route_to` and `assign_task`, which have existed since decision 0031.

**False where nothing matched**, deliberately. An unmatched invoice has
its own field, and **one flag answering two questions is a rule nobody
can reason about.**

---

## Three acts, and they are not the same kind

The operator asked for buttons to hold, activate and deactivate, plus a
way to change details.

**A hold** stops payment while something is disputed.
**Deactivating** stops an arriving invoice matching at all.
**Editing** corrects a record the ERP owns — and is the only one of the
three the next load overwrites.

So the third is separated and warns.

---

## The warning condition could not fire

> A condition could be included to only show this warning message IF the
> ERP Identifier is populated. This in-of-itself indicates that an ERP
> system is integrated with.

**Every supplier had one.** Decision 0209 made it `NOT NULL` with a
standing invariant, so the condition was always true.

**What the question really asks is whether an ERP feeds this list**,
which is a fact about the customer rather than about a row — and **a
load having happened** answers it. Before the first one, every supplier
was typed here, and a warning would be telling somebody off for the only
thing they can do.

*(Decision 0231 then made the identifier optional, which gives the
operator's original condition a meaning it did not have — but a
per-supplier one, and this warning is still a per-customer question.)*

---

## And it says what will happen

> Your ERP is the master for supplier data. Changes made here will be
> overwritten by the next supplier file you load.

**Not *"changes should be made there."*** That invites somebody to
wonder whether it matters. The next load overwriting this answers it.

---

## What is not built

- **Nothing routes on `supplier.onHold`.** It is testable and no rule
  reads it — the field is the wiring, and a customer writing the rule is
  the use.
- **Invoices already in flight keep the flag they were captured with.**
  A supplier held today does not change an invoice assessed yesterday,
  which is decision 0211's re-match argument from the other side and is
  recorded rather than done.
