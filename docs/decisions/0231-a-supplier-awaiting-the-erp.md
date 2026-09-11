# 0231 — A supplier awaiting the ERP

**Status: built.** A supplier may be recorded before the ERP has one.

---

## The argument was about payment and the column was about existence

> The ERP Identifier needs not to be mandatory. A record might be
> created and details logged before the record is created in the ERP.
> Receipt of an invoice, and supplier record creation here, could be a
> precursor to a New Supplier process, engaging with a team to add the
> information into the ERP.

**Decision 0209 made it `NOT NULL` on a real argument**: without an ERP
identifier an invoice cannot be named to the ERP, and therefore cannot
be paid.

**Which is still true, and is not the same as having no record.** The
ordinary way a new supplier arrives is that an invoice turns up,
somebody writes down who sent it, and a team creates the ERP record
**from exactly those details**.

**Refusing that row forced the work onto paper**, outside the system
that noticed it was needed.

---

## So matched and payable became two claims

Decision 0209 made them one, and this separates them:

**`supplier.matched`** — we recognise this seller.
**`supplier.awaitingErp`** — and the ERP cannot name them yet.

**The argument survives as a field rather than as a constraint**, which
is the better place for it: a rule can route on *awaiting*, and **that
rule is the new-supplier process** the operator described.

**Both false where nothing matched**, deliberately. One flag answering
two questions is a rule nobody can reason about.

---

## Filling in a blank is not overwriting a value

Decision 0218 called the identifier not editable, because changing it
could point our record at a different supplier than the ERP has —
silently, with invoices attached.

**That holds for a row the ERP owns and not for one it does not.** A
supplier awaiting the ERP gains its number when the team creates the
record; one that has a number keeps it, and the route refuses a change
with a reason rather than a constraint error.

---

## And the mirror still holds

Decision 0208 said there is no create here, and decision 0213 put that
on the screen.

**Both stay true.** A supplier the ERP **has** is changed there. What
can be recorded here is one it **does not** — which is **telling the
master what is missing rather than overriding it.**

---

## What is not built

- **Nothing routes on `supplier.awaitingErp`.** The field exists and no
  rule reads it, which is the same gap decision 0230 closed for
  `supplier.onHold` by making it testable and no further.
- **Nothing reconciles a local supplier with a later load.** A row
  created here keeps its `local:` id, and a load naming the same company
  by VAT id will **create a second row** — decision 0217's lookup is by
  ERP identifier, which a local row does not have.

  **That is the largest hole in this**, and it is a real one: a customer
  who records a supplier by hand and then loads the ERP file gets two.
