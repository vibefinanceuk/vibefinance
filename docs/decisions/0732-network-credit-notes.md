# 0732: Credit notes in the supplier network

**Status: live** at `d930f84`, pushed and deployed 11 October 2026, migration 0335 applied. vf-app (`network-submission.ts`, `portal-route.ts`),
vf-portal (`bis3.js`, `create.js`, `view.js`, `portal.js`, `portal.css`), vf-licence
(strings migration 0335).

## What was asked

Dan, 11 October 2026: *"push ahead with step 3"* — the network side of the credit note
design (`docs/design/supplier-portal.md`), against the mock-ups he approved: *Credit note* on
an invoice, Create as a credit note, and on Documents *"a Document Type field, which becomes
Invoice, or Credit Note. Also can the Invoice header become Document No."* — *"looks good"*.
Steps 1 (0730, reading) and 2 (0731, AP Setup) are live.

## What changed

- **Credit note** in the invoice's top bar (0729), on an invoice the customer returned or
  rejected, where the customer allows credit notes from the network (AP Setup › Credit
  Notes) and nothing has credited it yet.
- **Create, as a credit note** (`startCreditNote`): the invoice it credits (number, date,
  total, its status at the customer), **Why** (duplicate, price or quantity wrong, goods
  returned, order cancelled, other) and a **Note to the customer**; its lines, each with a
  **Credit** tick; the company fixed to the invoice's; Payment says it is not paid; the
  header reads Credit note number, Due date (none), Total credit, Credit note (381);
  **Send credit note to …**. Checked against BIS 3.0 as invoices are; a credit note must name
  its invoice (BR-55) and needs no due date, terms or account.
- **The document** (`bis3.js`): a UBL `CreditNote` (CreditNoteTypeCode 381,
  `CreditNoteLine`/`CreditedQuantity`), the invoice as `BillingReference`, Why and the note as
  `Note` (BT-22).
- **vf-app takes it** (`bis3Kind`): only where the customer allows network credit notes,
  only against an invoice of this supplier's in a company the person is invited for, and not
  one already credited. Then it is read (0730) and settled (0731): an invoice already returned
  or rejected is **Credited**.
- **Documents:** a **Type** column (Invoice / Credit note), **Document No.** in place of
  Invoice, an **All types** filter, a credit note's amount negative, *Search by document or PO
  number*. Opening a credit note shows it as one, with the invoice it credits.

## Tests

vf-portal `bis3.test.ts`: the credit note's rules and its XML in UBL order; the words test
(every key used, en and de). vf-app `network-submission.test.ts`: a credit note made by
`bis3.js` against a returned invoice is taken, read (BT-3 381, BT-25) and credits it; a
second is refused; none for an invoice not theirs, nor where the customer does not allow it.
Checked in Chromium, Day and Night: Documents, the invoice's Credit note, Create as a credit
note with a line unticked (the document sent: a CreditNote, its BillingReference, three
lines, 312.60).

## To deploy

Migration: vf-licence `0335_network_credit_notes_strings.sql`. Deploy vf-app, vf-licence
and vf-portal.
