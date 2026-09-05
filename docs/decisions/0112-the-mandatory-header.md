# 0112 — The rest of the mandatory header

**Status: built.** Eight mandatory header terms added, read by the
parser, and one of them changed what a queue looks like.

---

## The audit decision 0110 asked for

Decision 0110 checked `cac:InvoiceLine` and found **four of six
mandatory elements missing**. It recorded that the header had never been
checked the same way and was *"likely to have similar gaps"*.

It had eight.

| Term | Element | Rule |
| --- | --- | --- |
| **BT-23** Business process type | `cbc:ProfileID` | Mandatory in Peppol BIS |
| **BT-24** Specification identifier | `cbc:CustomizationID` | `BR-01` |
| **BT-27** Seller name | `AccountingSupplierParty/.../PartyLegalEntity/cbc:RegistrationName` | Mandatory |
| **BT-34** Seller electronic address | `AccountingSupplierParty/.../cbc:EndpointID` | `BR-62` |
| **BT-44** Buyer name | `AccountingCustomerParty/.../cbc:RegistrationName` | Mandatory |
| **BT-49** Buyer electronic address | `AccountingCustomerParty/.../cbc:EndpointID` | `PEPPOL-EN16931-R010` |
| **BT-55** Buyer country code | `.../PostalAddress/cac:Country/cbc:IdentificationCode` | `BR-11` |
| **BT-109** Invoice total without VAT | `LegalMonetaryTotal/cbc:TaxExclusiveAmount` | Mandatory |

**Verified rather than recalled** — against the BIS Billing 3.0 tree and
the EN 16931 Schematron, after decision 0110 punished exactly that
mistake. The same sources confirmed 0110's line list independently,
which was a useful check on the previous change.

---

## Three of these were not merely absent

**The seller has had no name.** BT-27 is mandatory, and it is why every
screen showed `DE813799533` where a person expects *Skelettbau Munch
GmbH*. **The task list now names the company**, falling back to the
identifier only when the document gave no name.

That was visible on screen for as long as there has been a screen, and
nobody — including me — connected it to a missing field.

**BT-49 is what Peppol routes on.** Decision 0111 designs an invoice
acquiring its org from a rule the customer writes, and the field they
would most naturally write it against did not exist. That decision is
now buildable.

**BT-109 is the missing middle of the arithmetic.** `BT-109 + BT-110 =
BT-112` is the check, and BT-109 was absent — so validation had only
BT-106, the sum of **lines**, which differs from the total without VAT
whenever a document-level allowance or charge exists. A test asserts
both on one document: 3800 in lines, 3600 excluding VAT.

**And BT-24 is the document-type discriminator** `PROGRESS.md` has
recorded as read by nothing since decision 0082. Reading it does not by
itself make detection use it — but it is now on every parsed invoice and
referenceable by a rule.

---

## The same test forced the work again

`field-coverage.test.ts` refused all eight the moment they were
declared:

> Declared in the vocabulary and populated by no intake path... **A
> field nothing can produce is a rule nobody can write.**

And two existing assertions grew, for the second time in two decisions.
`TaxExclusiveAmount` was **always in the sample document** and was being
discarded. The assertion changed because more of the document is read,
not because the document did — which is worth noticing as a signature:
*an exact-match test growing is what completing a parser looks like.*

---

## Still not the standard

- **BG-23, the VAT breakdown.** Mandatory, and a **repeating** group —
  one entry per combination of VAT category and rate, each with a
  taxable amount and a tax amount whose sum must equal BT-110. The facts
  model is flat key-value per invoice and **cannot hold a repeating
  group**. That is a design question rather than an omission, and
  `peppolvalidator.com` calls getting it wrong *"one of the most common
  causes of validation errors"*.
- **Postal addresses beyond the country code**, seller and buyer
  identifiers (BT-29, BT-30, BT-46, BT-47), contact details, payment
  means and terms, delivery information, and the preceding-invoice
  reference. All real terms; none needed by anything yet.
- **BT-16 Despatch advice reference**, which three-way matching will
  want (0082).

