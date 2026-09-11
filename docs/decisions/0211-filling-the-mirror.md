# 0211 — Filling the mirror

**Status: built.** A supplier master file loads, and invoices that could
not be matched are looked at again.

---

## The table existed and could not be filled

Decision 0209 built the supplier table and the matching. **The only way
to put a supplier in it was an `INSERT`**, which is not a feature a
customer has.

**CSV**, because *Save as CSV* is one menu item in every spreadsheet and
a format nobody has to be taught. A customer exports from their ERP and
sends a file.

**And the column names are theirs, not ours.** *Supplier Number*, *VAT*,
*Peppol ID*, *Terms* — a customer exports what their ERP calls things,
and asking them to rename columns is asking them to edit a file they
should be able to send untouched.

---

## One column is not optional

Decision 0209's argument, enforced at the file level: **without an ERP
identifier a supplier cannot be paid against**, and a load producing
such rows is a master pretending to be a mirror.

**A file with no such column is refused whole**, rather than row by row.
Every row would fail for the same reason, and **a hundred identical
errors tell somebody less than one.**

---

## A load that refuses says which row and why

A hold with no reason, a match option nobody recognises, a row with no
name. Each is reported **with its row number**, because that is what a
person can act on in a spreadsheet.

**Decision 0162's argument**: a customer whose export is half wrong
should learn that from the load, not discover it one invoice at a time.

### And a load that loaded nothing is not a load

Recording it would move the *"last loaded"* date on a mirror that
learned nothing — **the stale-mirror trap of decision 0208 with the
evidence removed.** Refused, and no row written.

---

## Replace, never merge

A load is **the ERP's current truth** (decision 0208), and reconciling
row by row invents a conflict resolution nobody asked for.

**A supplier absent from a later load is inactive, never deleted** — an
invoice already pointing at one must still be able to say who it was.
And one that appears again is active again, because the ERP said so.

---

## Looking again, which is half the point

> An invoice sitting in AP Review because its supplier was unknown stays
> there after the supplier is loaded. The fact that sent it there is no
> longer true, and nothing looks again.

Decision 0208 called this **part of the feature rather than a
refinement**, and a load now re-matches every unmatched invoice and
clears the reason that is no longer true.

**What it does not do is move the invoice.** It corrects the *fact*, not
the queue. Where that invoice now belongs is a process question, and **a
rule that routed it on `supplier.matched` should be what routes it
back** — not a loader reaching into somebody's work.

---

## A teardown with the order wrong

`invoice_headers` references `suppliers`, and the test teardown dropped
suppliers first. **The foreign key refused**, which is the constraint
doing its job on a mistake that would otherwise have been invisible
until data existed.

---

## What is not built

- **No screen.** A load is a `POST` of a file body, and the supplier
  list is invisible — including the load date that an unmatched
  supplier's explanation depends on.
- **Nothing reads the terms, hold, match option or tolerances.** They
  load, they store, and no process consults them. **The fields a
  process should act on, held and not yet acted on.**
- **No XLSX.** A customer with an `.xlsx` must save it as CSV first,
  which is one menu item and still a step.
- **A load is all or nothing per row and total per file.** There is no
  preview, so a customer learns what a file does by doing it.
