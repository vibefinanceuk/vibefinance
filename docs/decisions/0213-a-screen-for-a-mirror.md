# 0213 — A screen for a mirror

**Status: built.** A supplier screen with a file picker, a freshness
line, and no way to add a supplier.

---

## What a mirror's screen does not have

**There is no *Add supplier* and no *Edit*.** A person looking at this
cannot change it, because changing it here would make this the master
and the ERP wrong — decision 0208.

**And the screen says so**, in a line beneath the heading:

> Loaded from your ERP. Suppliers are created and changed there, not
> here.

A person who does not know this is a mirror will look for the button
and conclude the product is missing one. **An absence needs explaining
where a presence does not.**

---

## How old the list is, said before anything else

Decision 0208's trap, given a place on a screen: **a stale mirror lies
confidently.**

- **Never loaded** — *"no supplier file has ever been loaded, so every
  invoice will arrive without a supplier."*
- **Loaded, with a date** — and the line turns to a warning past thirty
  days.
- **Loaded with refusals** — which stays visible, because a customer
  whose export was half wrong has long since closed the response that
  told them.

**Never loaded and loaded-long-ago are different sentences**, because
one is fixed by asking for a file and the other by asking for a newer
one.

---

## What a load did, in the places a person can act

**Row numbers, not *"some rows failed"*** — decision 0211 refuses per
row and this shows which, because that is what a person can find in a
spreadsheet.

**And the count that clears somebody's queue**: *"{n} invoices which had
no supplier now have one."* Decision 0208 called re-matching part of the
feature, and this is where it becomes visible.

**A hold shows its reason rather than a tick.** A hold is *why* an
invoice routes differently, so the reason is the useful part.

---

## Two lists nobody ties to anything

This screen was unreachable twice before it worked, in the same way:

**The proxy allow-list** — decision 0212, an hour earlier, for two other
routes.

**And the browser tests' alias map**, which names every `public/*.js`
module by hand. A new module resolves nowhere and **175 tests fail at
once**, which is at least loud.

**Both lists are right to exist** and both are maintained by
remembering. That is now three of them — the proxy, the aliases, and the
string fixtures in six test files, each of which needed `nav.suppliers`
adding separately.

**A screen is not finished when it renders.**

---

## What is not built

- **No pagination or search.** A customer with four thousand suppliers
  gets four thousand rows.
- **Nothing filters by status**, so inactive suppliers sit among the
  active ones — visible, which decision 0208 wanted, and not separable.
- **No XLSX**, so a customer saves as CSV first.
- **Nothing reads the terms, hold, match option or tolerances** — they
  load, they display, and no process consults them. **Decision 0211's
  gap, now visible on a screen rather than only in a table.**
