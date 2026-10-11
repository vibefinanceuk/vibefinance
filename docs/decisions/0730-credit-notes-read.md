# 0730: Credit notes are read, in every route, and exported as credits

**Status: live** at `90a5dfb`, pushed and deployed 11 October 2026, migration 0162 applied. shared (`ubl-parser.ts`, `cii-parser.ts`, `invoice-xml.ts`,
`en16931-rules.ts`, `vocabulary.ts`), vf-app (`erp-export-route.ts`, `destination-delivery.ts`,
`invoice-history.ts`, `invoice-facts-route.ts`, `network-submission.ts`), migration 0162.

## What was asked

Dan, 11 October 2026, after the network's invoice view (0729): *"can we examine the Credit
Note functionality next?"* The examination found credit notes refused in every route
("credit notes are not read yet", 0030, 0560), with two gaps where one got in as an
ordinary invoice: a UBL `<Invoice>` carrying a credit note's type code, and a supplier
mapping setting BT-3 to 381. Either would be approved and exported to be **paid**. Dan
agreed the plan and the mock-ups (Raise credit note in the network, a Credited status,
Type and Document No. on Documents, and the handling as an option in AP Setup). This is
the first of three steps; the reading comes first, because everything else stands on it.

## What changed

- **Read, not refused.** A UBL `<CreditNote>` (CreditNoteTypeCode, CreditNoteLine,
  CreditedQuantity) is read by the UBL parser into the same business terms as an invoice;
  a CII credit note (same root, a credit type code) by the CII parser. Email, the API,
  upload, Peppol and the batch preview all take them, as they take invoices.
- **What a credit note credits:** BT-25 and BT-26 (BillingReference /
  InvoiceReferencedDocument), now in the rule vocabulary.
- **Invoice or credit note is the type code**, BT-3, whichever root or route: the codes
  EN 16931 treats as credit notes (81, 83, 261, 262, 296, 308, 381, 396, 420, 458, 532).
  `isCreditNote(facts)` in shared; `invoice_headers.document_kind` (`invoice` /
  `credit_note`), generated from the facts as the 0148 columns are. So the two gaps close by
  construction: a 381 that arrives any way is a credit note.
- **Exported as a credit.** The ERP export's amounts (`invoice_net`, `invoice_vat`,
  `invoice_total`, `net_amount`) go out **negative** for a credit note, quantities as given,
  with two columns added at the end (so nothing an import reads moves): `document_type`
  and `credited_invoice`. The JSON delivery carries `documentType` and `creditedInvoice`.
- **Duplicates by kind.** An invoice is compared with invoices and a credit note with
  credit notes: a full credit of an invoice is not that invoice's duplicate.
- **BR-CO-25** (a due date or payment terms where an amount is due) applies to invoices
  only: a credit note's amount is owed the other way, and CEN's own example credit note
  gives neither. Checked against CEN's examples, which all pass, the credit note included.
- **Not yet through the network:** the network still sends invoices only; a BIS document
  with a credit note's type code is refused there as before (step 3).

## Not in this

- **What happens to the credited invoice** (taken out of payment, held for AP, Credited),
  and finding it by BT-25: step 2, with the AP Setup › Credit Notes tab.
- **Raise credit note in the network**, the Type column and Document No.: step 3.
- A PDF read by AI does not yet say which it is (the reader does not extract BT-3); it
  arrives as an invoice, as before.

## Tests

shared: a UBL credit note and a CII one read, with BT-25/26, credited quantities and no
rule broken; `isCreditNote` by code; CEN's examples (with `EN16931_ARTEFACTS`) all pass.
vf-app: a credit note by email is captured as one; `document_kind`; the export's negative
amounts and new columns; duplicates by kind; the network gate. Migration replay held.

## To deploy

Migration: `0162_document_kind.sql` (vf-app's database). Deploy vf-app.

**Note for ERP imports:** two columns are added at the end of the CSV export, and a credit
note's amounts are negative. An import that maps columns by position is unaffected; one
that rejects unknown columns will need them added.
