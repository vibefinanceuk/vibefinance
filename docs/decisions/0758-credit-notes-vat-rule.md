# 0758: A credit note finds its invoice by the one VAT rule

**Status: built.**

- vf-app: `credit-notes.ts`.

## What was asked

Left open by 0757: a credit note looking for the invoice it credits (0731) still compared VAT
numbers with the country prefix always dropped. So a British supplier's credit note
(GB333444555) could find a German supplier's invoice of the same number (DE333444555). Dan,
13 October 2026: *"Please fix Credit notes"*.

## What changed

`findCreditedInvoice` compares the credit note's seller VAT number (BT-31) by 0756's rule,
`SAME_VAT_SQL`. It does so with both the invoice's seller VAT number and the VAT number of the
supplier the invoice is matched to.

- Spaces, dots and hyphens are ignored.
- The country prefix is dropped only where one side leaves it off. The live case 0731 was built
  for, GB111350965 against 111350965, still finds its invoice.
- Two numbers that both name their country must name the same one.

The seller's name and the matched supplier still find it as before. The local copies of the old
comparison are gone. Every VAT comparison of this kind now goes through `order-supplier.ts`.

## Tests

- **vf-app** `credit-notes.test.ts`:
  - a credit note from GB 333-444-555 does not find the German supplier's invoice INV-88
    (DE333444555), and fails on the previous rule;
  - one from 333.444.555 does find it;
  - the existing GB111350965 / 111350965 test passes unchanged.
- Related suites pass (5 files, 59 tests): credit notes, network, portal and submissions.

## To deploy

No migration. Deploy vf-app.
