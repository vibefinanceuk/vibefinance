# 0238 — What the supplier record says

**Status: built.** Terms, match option and tolerances are facts a rule
can test.

---

## Loaded, displayed, and read by nothing

They have loaded since decision 0209 and shown on a screen since
decision 0213, and **no process has ever consulted any of them.**
Decisions 0211, 0218 and 0219 each recorded it from a different angle,
and decision 0230 closed the same gap for the hold.

**Four fields, and each answers a question a rule should be able to
ask:**

| | |
| --- | --- |
| `supplier.paymentTerms` | what was **agreed** — where `BT-9` is what the supplier **claims** |
| `supplier.matchOption` | two-way, three-way or none, which **decides which stages an invoice visits** |
| `supplier.amountTolerancePct` | how far the money may differ before a match fails |
| `supplier.quantityTolerancePct` | the same for quantity |

**The two tolerances are separate on purpose.** A supplier who may
over-deliver by five percent has not thereby agreed to over-charge by
five percent, and one column would have made them one agreement.

---

## Facts at capture, not lookups at evaluation

Decision 0231's argument about the hold, applied to all four: **an
invoice is assessed against the truth at the moment it arrived.** A
supplier whose terms change next week did not change what was agreed for
this one.

---

## `none` and absent are different answers

`supplier.matchOption` is **`none`** where a supplier matched and
declared nothing, and **absent** where no supplier matched at all.

**A null would mean *no supplier*.** A rule testing *"is the match
option two-way"* should not fire on an invoice that has no supplier, and
one value cannot answer both questions.

---

## And nothing had asserted the hold either

Decision 0230 wired `supplier.onHold` and **no test drove the capture
path to check it.** The tests written here do, and they cover it too —
found by writing a test that only re-checked `matchSupplier` and
noticing it did not test what its name said.

**Which took a helper nobody used and a test that asserted the wrong
layer**, both of which are gone.

---

## What is not built

- **No rule reads any of them**, which is the same shape as decision
  0230: the field is the wiring, and a customer writing the sentence is
  the use.
- **Nothing compares `supplier.paymentTerms` with `BT-9`.** A rule
  could, and the terms are free text (Peppol BIS 3.0 defines no code
  list), so the comparison a customer wants is theirs to write.
- **`match_option` does not route anything.** It says two-way or
  three-way and no stage consults it — the thing it was described as
  deciding is still decided by a process definition.
