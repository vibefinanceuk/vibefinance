# 0065 — Not every profile is a CIUS

**Status: built.** A rename and a corrected description. No behaviour
change and no data migration.

---

## The claim the name made

`CIUS_PROFILES` listed five entries, one of which is not a CIUS.

A **CIUS** is a Core Invoice Usage Specification: a *constraint* on EN
16931 rather than a replacement for it. That is why Peppol BIS Billing
3.0, XRechnung and Factur-X all yield the same Business Term codes and
need no vocabulary of their own (decision 0055 section 3.4).

FatturaPA is Italy's national format, and this file's own description
has always said it *"predates and is distinct from Peppol BIS 3.0"*. So
the constant's name asserted something one of its own entries
contradicted, in the same file, in adjacent lines.

---

## Why it is worth correcting

The distinction is load-bearing, not pedantic.

A genuine CIUS needs no new fields. A national format outside EN 16931
may need an entire vocabulary — `CUFE` in Colombia's DIAN has no Business
Term equivalent at all, which is a vocabulary problem rather than a
mapping one (`docs/design/multi-authority-intake.md`).

A list named for CIUS invites the assumption that every entry is safe to
treat identically. It is not.

---

## What changed

`CIUS_PROFILES` → `INVOICE_PROFILES`, `CiusProfile` → `InvoiceProfile`,
`isKnownCiusProfile` → `isKnownInvoiceProfile`. FatturaPA's description
now ends *"Not a CIUS of EN 16931"*.

**TypeScript only.** The stored values are unchanged, so the migration's
`CHECK` constraint still matches and no customer's stored profile moves.
A test asserts the five strings explicitly, so a future rename cannot
quietly become a data migration.

---

## The fifth of a kind

One layer disagreeing with another, and the fifth found this way:

| Divergence | Found in |
| --- | --- |
| `invoice_lines.cost_centre` — a column with no vocabulary entry | 0031 |
| `extraction.confidence` — set as a fact, never declared | 0054 |
| Settings configured and reaching nothing | 0056, 0057 |
| The UBL parser populating 11 of 21 declared fields | 0059 |
| A constant's name contradicting its own contents | this |

None was found by reading either layer alone. Decision 0067 turns that
observation into a test for the fourth case.
